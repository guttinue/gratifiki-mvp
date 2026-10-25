begin;
-- PostgreSQL replaces a stored function body as a whole. Restate ONLY the
-- accepted private T05/T06 handlers, changing text edge normalization and the
-- unsent payload normalization at submission. Prior migrations/sent rows stay
-- untouched; ordinary save operation payloads/retries keep the same protocol.
create function private.trim_academic_text(value text) returns text
language sql immutable set search_path='' as $$ select btrim(value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'); $$;
create or replace function private.save_academic_draft(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_context jsonb; v_position public.posicoes_esperadas%rowtype; v_competence public.competencias%rowtype;
 v_entry public.entradas%rowtype; v_revision public.revisoes_entrada%rowtype; v_existing public.operacoes_dominio%rowtype;
 v_input jsonb; v_value numeric; v_text text; v_source text; v_period text; v_reason text;
 v_canonical jsonb; v_response jsonb; v_expected integer; v_id uuid;
begin
 if p_command is distinct from 'save_draft' then raise exception using errcode='42501',message='access_denied'; end if;
 v_context:=private.require_academic_context(p_contexto,'draft');
 if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='22023',message='invalid_input'; end if;
 begin
  v_id:=(p_payload->>'positionId')::uuid;
  v_expected:=(p_payload->>'expectedVersion')::integer;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='invalid_input'; end;
 if v_id is null or v_expected is null or v_expected<1 then raise exception using errcode='22023',message='invalid_input'; end if;
 -- All writes lock competence, position/header, then revision. Re-authorize inside.
 select * into v_competence from public.competencias where id=(v_context->>'competenciaId')::uuid for update;
 select * into v_position from public.posicoes_esperadas where id=v_id and competencia_id=v_competence.id and indicador_id=(v_context->>'indicadorId')::uuid for update;
 v_context:=private.require_academic_context(p_contexto,'draft');
 if v_position.id is null or not(v_context->'positionIds' ? v_id::text) then raise exception using errcode='42501',message='access_denied'; end if;
 select * into v_entry from public.entradas where posicao_id=v_id for update;
 select * into v_revision from public.revisoes_entrada where id=v_entry.revisao_atual_id for update;
 v_input:=p_payload->'input';
 if jsonb_typeof(v_input) is distinct from 'object' or
  (select count(*) from jsonb_object_keys(v_input))<>5 or
  exists(select 1 from jsonb_object_keys(v_input) k where k not in ('estadoDado','valor','fonte','periodoFonte','motivo')) or
  jsonb_typeof(v_input->'estadoDado') is distinct from 'string' or v_input->>'estadoDado' not in ('valor','indisponivel') or
  jsonb_typeof(v_input->'fonte') is distinct from 'string' or jsonb_typeof(v_input->'periodoFonte') is distinct from 'string' or
  jsonb_typeof(v_input->'motivo') is distinct from 'string' or not(v_input ? 'valor') then
  raise exception using errcode='22023',message='invalid_input';
 end if;
 v_source:=private.trim_academic_text(v_input->>'fonte');v_period:=private.trim_academic_text(v_input->>'periodoFonte');v_reason:=private.trim_academic_text(v_input->>'motivo');
 if char_length(v_source)>500 or char_length(v_reason)>1000 then raise exception using errcode='22023',message='invalid_input'; end if;
 if v_period<>'' then
  if v_period !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='22023',message='invalid_input'; end if;
  begin
   if (v_period::date)::text<>v_period then raise exception using errcode='22023',message='invalid_input'; end if;
  exception when datetime_field_overflow or invalid_datetime_format then raise exception using errcode='22023',message='invalid_input'; end;
 end if;
 if v_input->'valor'<>'null'::jsonb then
  if jsonb_typeof(v_input->'valor') is distinct from 'string' then raise exception using errcode='22023',message='invalid_input'; end if;
  v_text:=replace(private.trim_academic_text(v_input->>'valor'),',','.');
  if v_text !~ '^[0-9]+(\.[0-9]{1,4})?$' or char_length(v_text)>100 then raise exception using errcode='22023',message='invalid_input'; end if;
  v_value:=v_text::numeric;
  if v_value>99999999.9999 then raise exception using errcode='22023',message='invalid_input'; end if;
 end if;
 if v_input->>'estadoDado'='indisponivel' and v_value is not null then raise exception using errcode='22023',message='invalid_input'; end if;
 v_canonical:=jsonb_build_object('context',p_contexto,'positionId',v_id,'expectedVersion',v_expected,'input',
  jsonb_build_object('estadoDado',v_input->>'estadoDado','valor',trim_scale(v_value)::text,'fonte',v_source,'periodoFonte',v_period,'motivo',v_reason));
 -- Serializes actor/key even if concurrent retries target different competences.
 perform pg_advisory_xact_lock(hashtextextended((auth.uid())::text||':'||p_operation_id::text,0));
 select * into v_existing from public.operacoes_dominio where ator_id=auth.uid() and operation_id=p_operation_id;
 if v_existing.id is not null then
  if v_existing.comando<>p_command or v_existing.payload<>v_canonical then raise exception using errcode='22023',message='operation_payload_mismatch'; end if;
  return v_existing.resposta;
 end if;
 if v_position.lock_version<>v_expected then raise exception using errcode='40001',message='version_conflict'; end if;
 if v_competence.estado<>'aberta' or not v_position.aplicavel or
  (v_entry.id is not null and (v_entry.estado<>'rascunho' or v_revision.enviada_em is not null or v_revision.autor_id<>auth.uid())) then
  raise exception using errcode='55000',message='invalid_state';
 end if;
 if v_entry.id is null then
  insert into public.entradas(competencia_id,indicador_id,escopo_id,autor_id,valor,estado,revisao,operation_id,posicao_id)
   values(v_position.competencia_id,v_position.indicador_id,v_position.alvo_id,auth.uid(),null,'rascunho',1,p_operation_id,v_id) returning * into v_entry;
 end if;
 if v_revision.id is null then
  insert into public.revisoes_entrada(entrada_id,numero,autor_id,estado_dado,valor,origem,periodo_fonte,motivo)
   values(v_entry.id,1,auth.uid(),v_input->>'estadoDado',v_value,v_source,v_period,v_reason) returning * into v_revision;
 else
  update public.revisoes_entrada set estado_dado=v_input->>'estadoDado',valor=v_value,origem=v_source,periodo_fonte=v_period,motivo=v_reason where id=v_revision.id;
 end if;
 update public.entradas set revisao_atual_id=v_revision.id,lock_version=lock_version+1 where id=v_entry.id;
 update public.posicoes_esperadas set lock_version=lock_version+1 where id=v_id returning * into v_position;
 update public.competencias set lock_version=lock_version+1 where id=v_competence.id;
 v_response:=jsonb_build_object('resourceId',v_id,'version',v_position.lock_version,'revisionId',v_revision.id,'status','rascunho','resultValue',null);
 insert into public.eventos_auditoria(actor_id,acao,recurso_tipo,recurso_id,detalhes,correlacao_id)
  values(auth.uid(),'rascunho_salvo','posicao',v_id,jsonb_build_object('version',v_position.lock_version,'revisionId',v_revision.id),p_operation_id);
 insert into public.operacoes_dominio(ator_id,operation_id,comando,payload,resposta) values(auth.uid(),p_operation_id,p_command,v_canonical,v_response);
 return v_response;
end;
$$;
create or replace function private.run_academic_submission(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_context jsonb; v_capability text; v_id uuid; v_expected integer;
 v_competence public.competencias%rowtype; v_position public.posicoes_esperadas%rowtype;
 v_entry public.entradas%rowtype; v_revision public.revisoes_entrada%rowtype;
 v_rule public.regras%rowtype; v_existing public.operacoes_dominio%rowtype;
 v_canonical jsonb; v_response jsonb; v_result numeric(18,10); v_memory jsonb;
begin
 if p_command='save_draft' then v_capability:='draft';
 elsif p_command='submit' then v_capability:='submit';
 else raise exception using errcode='42501',message='access_denied'; end if;
 v_context:=private.require_academic_context(p_contexto,v_capability);
 if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='22023',message='invalid_input'; end if;
 begin
  v_id:=(p_payload->>'positionId')::uuid;v_expected:=(p_payload->>'expectedVersion')::integer;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='invalid_input'; end;
 if v_id is null or v_expected is null or v_expected<1 then raise exception using errcode='22023',message='invalid_input'; end if;
 select * into v_competence from public.competencias where id=(v_context->>'competenciaId')::uuid for update;
 select * into v_position from public.posicoes_esperadas where id=v_id and competencia_id=v_competence.id and indicador_id=(v_context->>'indicadorId')::uuid for update;
 if v_position.id is null or not(v_context->'positionIds' ? v_id::text) then raise exception using errcode='42501',message='access_denied'; end if;
 select * into v_entry from public.entradas where posicao_id=v_id for update;
 select * into v_revision from public.revisoes_entrada where id=v_entry.revisao_atual_id for update;
 -- Acquire actor/key serialization before the last current-access check too:
 -- a wait on another competence must not make a prior check authorize replay.
 perform pg_advisory_xact_lock(hashtextextended((auth.uid())::text||':'||p_operation_id::text,0));
 -- Never recover a cached response without current authorization under all
 -- domain locks. Actor and assignment are resolved on the server, not payload.
 v_context:=private.require_academic_context(p_contexto,v_capability);
 if v_position.id is null or not(v_context->'positionIds' ? v_id::text) then raise exception using errcode='42501',message='access_denied'; end if;
 if p_command='save_draft' then
  return private.save_academic_draft(p_contexto,'save_draft',p_payload,p_operation_id);
 end if;
 if (select count(*) from jsonb_object_keys(p_payload))<>2 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('positionId','expectedVersion')) then raise exception using errcode='22023',message='invalid_input'; end if;
 v_canonical:=jsonb_build_object('context',p_contexto,'positionId',v_id,'expectedVersion',v_expected);
 select * into v_existing from public.operacoes_dominio where ator_id=auth.uid() and operation_id=p_operation_id;
 if v_existing.id is not null then
  if v_existing.comando<>p_command or v_existing.payload<>v_canonical then raise exception using errcode='22023',message='operation_payload_mismatch'; end if;
  return v_existing.resposta;
 end if;
 if v_position.lock_version<>v_expected then raise exception using errcode='40001',message='version_conflict'; end if;
 if v_competence.estado<>'aberta' or not v_position.aplicavel or v_entry.id is null or v_entry.estado<>'rascunho' or v_revision.id is null or v_revision.enviada_em is not null or v_revision.autor_id<>auth.uid() then
  raise exception using errcode='55000',message='invalid_state';
 end if;
 v_revision.origem:=private.trim_academic_text(v_revision.origem);
 v_revision.periodo_fonte:=private.trim_academic_text(v_revision.periodo_fonte);
 v_revision.motivo:=private.trim_academic_text(v_revision.motivo);
 if v_revision.origem='' or v_revision.periodo_fonte !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or
  (v_revision.estado_dado='valor' and v_revision.valor is null) or
  (v_revision.estado_dado='indisponivel' and (v_revision.valor is not null or v_revision.motivo='')) then
  raise exception using errcode='22023',message='invalid_input';
 end if;
 begin
  if (v_revision.periodo_fonte::date)::text<>v_revision.periodo_fonte then raise exception using errcode='22023',message='invalid_input'; end if;
 exception when datetime_field_overflow or invalid_datetime_format then raise exception using errcode='22023',message='invalid_input'; end;
 select * into v_rule from public.regras where id=v_position.regra_id and indicador_id=v_position.indicador_id;
 if v_rule.id is null or v_rule.fator<=0 or v_rule.fator>1 then raise exception using errcode='22023',message='rule_unavailable'; end if;
 -- No temporal lookup, floating point or institutional formula. The position
 -- pins its immutable synthetic rule. Unavailability never becomes zero.
 if v_revision.estado_dado='valor' then
  v_result:=v_revision.valor*v_rule.fator;
  v_memory:=jsonb_build_object('synthetic',true,'revisionId',v_revision.id,'ruleId',v_rule.id,'ruleVersion',v_rule.versao,
   'factor',trim_scale(v_rule.fator)::text,'inputValue',trim_scale(v_revision.valor)::text,'resultValue',trim_scale(v_result)::text);
 end if;
 update public.revisoes_entrada set origem=v_revision.origem,periodo_fonte=v_revision.periodo_fonte,motivo=v_revision.motivo,enviada_em=clock_timestamp() where id=v_revision.id;
 update public.entradas set estado='enviada',lock_version=lock_version+1 where id=v_entry.id;
 if v_revision.estado_dado='valor' then
  insert into public.resultados(entrada_id,regra_id,valor,memoria,revisao_id) values(v_entry.id,v_rule.id,v_result,v_memory,v_revision.id);
 end if;
 update public.posicoes_esperadas set lock_version=lock_version+1 where id=v_id returning * into v_position;
 update public.competencias set lock_version=lock_version+1 where id=v_competence.id;
 v_response:=jsonb_build_object('resourceId',v_id,'version',v_position.lock_version,'revisionId',v_revision.id,'status','enviada','resultValue',trim_scale(v_result)::text);
 insert into public.eventos_auditoria(actor_id,acao,recurso_tipo,recurso_id,detalhes,correlacao_id)
  values(auth.uid(),'posicao_enviada','posicao',v_id,jsonb_build_object('version',v_position.lock_version,'revisionId',v_revision.id,'estadoDado',v_revision.estado_dado,'ruleVersion',v_rule.versao),p_operation_id);
 insert into public.operacoes_dominio(ator_id,operation_id,comando,payload,resposta) values(auth.uid(),p_operation_id,p_command,v_canonical,v_response);
 return v_response;
end;
$$;

-- Complete correction input uses the same edge and decimal policy as drafts,
-- but rejects incomplete evidence before reserving an operation or mutating.
create function private.correction_input(p_input jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare v_source text;v_period text;v_reason text;v_text text;v_value numeric;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or
  (select count(*) from jsonb_object_keys(p_input))<>5 or
  exists(select 1 from jsonb_object_keys(p_input) k where k not in ('estadoDado','valor','fonte','periodoFonte','motivo')) or
  jsonb_typeof(p_input->'estadoDado') is distinct from 'string' or p_input->>'estadoDado' not in ('valor','indisponivel') or
  jsonb_typeof(p_input->'fonte') is distinct from 'string' or jsonb_typeof(p_input->'periodoFonte') is distinct from 'string' or
  jsonb_typeof(p_input->'motivo') is distinct from 'string' or not(p_input ? 'valor') then
  raise exception using errcode='22023',message='invalid_input';
 end if;
 v_source:=private.trim_academic_text(p_input->>'fonte');v_period:=private.trim_academic_text(p_input->>'periodoFonte');v_reason:=private.trim_academic_text(p_input->>'motivo');
 if v_source='' or length(v_source)>500 or length(v_reason)>1000 or v_period !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='22023',message='invalid_input';end if;
 begin
  if (v_period::date)::text<>v_period then raise exception using errcode='22023',message='invalid_input';end if;
 exception when datetime_field_overflow or invalid_datetime_format then raise exception using errcode='22023',message='invalid_input';end;
 if p_input->'valor'<>'null'::jsonb then
  if jsonb_typeof(p_input->'valor') is distinct from 'string' then raise exception using errcode='22023',message='invalid_input';end if;
  v_text:=replace(private.trim_academic_text(p_input->>'valor'),',','.');
  if length(v_text)>100 or v_text !~ '^[0-9]+(\.[0-9]{1,4})?$' then raise exception using errcode='22023',message='invalid_input';end if;
  v_value:=v_text::numeric;
  if v_value>99999999.9999 then raise exception using errcode='22023',message='invalid_input';end if;
 end if;
 if (p_input->>'estadoDado'='valor' and v_value is null) or
  (p_input->>'estadoDado'='indisponivel' and (v_value is not null or v_reason='')) then raise exception using errcode='22023',message='invalid_input';end if;
 return jsonb_build_object('estadoDado',p_input->>'estadoDado','valor',trim_scale(v_value)::text,'fonte',v_source,'periodoFonte',v_period,'motivo',v_reason);
end;
$$;
create function private.correct_academic_position(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_context jsonb;v_capability text;v_id uuid;v_expected integer;
 v_competence public.competencias%rowtype;v_position public.posicoes_esperadas%rowtype;
 v_entry public.entradas%rowtype;v_revision public.revisoes_entrada%rowtype;v_new public.revisoes_entrada%rowtype;
 v_existing public.operacoes_dominio%rowtype;v_rule public.regras%rowtype;
 v_input jsonb;v_canonical jsonb;v_response jsonb;v_memory jsonb;
 v_reason text;v_reference text;v_status text;v_type text;v_action text;v_result numeric(18,10);
begin
 if p_command='correct' then v_capability:='correct';
 elsif p_command='authorize_correction' then v_capability:='authorize_correction';
 elsif p_command='decide_unavailability' then v_capability:='decide_unavailability';
 else raise exception using errcode='42501',message='access_denied';end if;
 v_context:=private.require_academic_context(p_contexto,v_capability);
 if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='22023',message='invalid_input';end if;
 begin
  v_id:=(p_payload->>'positionId')::uuid;v_expected:=(p_payload->>'expectedVersion')::integer;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='invalid_input';end;
 if v_id is null or v_expected is null or v_expected<1 then raise exception using errcode='22023',message='invalid_input';end if;
 select * into v_competence from public.competencias where id=(v_context->>'competenciaId')::uuid for update;
 select * into v_position from public.posicoes_esperadas where id=v_id and competencia_id=v_competence.id and indicador_id=(v_context->>'indicadorId')::uuid for update;
 if v_position.id is null or not(v_context->'positionIds' ? v_id::text) then raise exception using errcode='42501',message='access_denied';end if;
 select * into v_entry from public.entradas where posicao_id=v_id for update;
 select * into v_revision from public.revisoes_entrada where id=v_entry.revisao_atual_id for update;
 perform pg_advisory_xact_lock(hashtextextended((auth.uid())::text||':'||p_operation_id::text,0));
 -- CAM reads may union explicit links, but these capabilities never do.
 v_context:=private.require_academic_context(p_contexto,v_capability);
 if not(v_context->'positionIds' ? v_id::text) or (p_command='correct' and v_position.informante_id<>auth.uid()) then raise exception using errcode='42501',message='access_denied';end if;
 v_canonical:=jsonb_build_object('context',p_contexto,'positionId',v_id,'expectedVersion',v_expected);
 if p_command='correct' then
  if (select count(*) from jsonb_object_keys(p_payload))<>3 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('positionId','expectedVersion','input')) then raise exception using errcode='22023',message='invalid_input';end if;
  v_input:=private.correction_input(p_payload->'input');v_canonical:=v_canonical||jsonb_build_object('input',v_input);
 else
  if jsonb_typeof(p_payload->'reason') is distinct from 'string' then raise exception using errcode='22023',message='invalid_input';end if;
  v_reason:=private.trim_academic_text(p_payload->>'reason');
  if v_reason='' or length(v_reason)>1000 then raise exception using errcode='22023',message='invalid_input';end if;
  v_canonical:=v_canonical||jsonb_build_object('reason',v_reason);
  if p_command='authorize_correction' then
   if (select count(*) from jsonb_object_keys(p_payload))<>3 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('positionId','expectedVersion','reason')) then raise exception using errcode='22023',message='invalid_input';end if;
  else
   if (select count(*) from jsonb_object_keys(p_payload))<>4 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('positionId','expectedVersion','reason','reference')) or jsonb_typeof(p_payload->'reference') is distinct from 'string' then raise exception using errcode='22023',message='invalid_input';end if;
   v_reference:=private.trim_academic_text(p_payload->>'reference');
   if v_reference='' or length(v_reference)>500 then raise exception using errcode='22023',message='invalid_input';end if;
   v_canonical:=v_canonical||jsonb_build_object('reference',v_reference);
  end if;
 end if;
 select * into v_existing from public.operacoes_dominio where ator_id=auth.uid() and operation_id=p_operation_id;
 if v_existing.id is not null then
  if v_existing.comando<>p_command or v_existing.payload<>v_canonical then raise exception using errcode='22023',message='operation_payload_mismatch';end if;
  return v_existing.resposta;
 end if;
 if v_position.lock_version<>v_expected then raise exception using errcode='40001',message='version_conflict';end if;
 if v_competence.estado<>'aberta' or not v_position.aplicavel or v_entry.id is null or v_revision.id is null or v_revision.enviada_em is null then raise exception using errcode='55000',message='invalid_state';end if;
 if p_command='correct' then
  if v_entry.estado<>'devolvida' then raise exception using errcode='55000',message='invalid_state';end if;
  select * into v_rule from public.regras where id=v_position.regra_id and indicador_id=v_position.indicador_id;
  if v_rule.id is null or v_rule.fator<=0 or v_rule.fator>1 then raise exception using errcode='22023',message='rule_unavailable';end if;
  insert into public.revisoes_entrada(entrada_id,numero,autor_id,estado_dado,valor,origem,periodo_fonte,motivo,enviada_em)
   values(v_entry.id,v_revision.numero+1,auth.uid(),v_input->>'estadoDado',(v_input->>'valor')::numeric,v_input->>'fonte',v_input->>'periodoFonte',v_input->>'motivo',clock_timestamp()) returning * into v_new;
  if v_new.estado_dado='valor' then
   v_result:=v_new.valor*v_rule.fator;
   v_memory:=jsonb_build_object('synthetic',true,'revisionId',v_new.id,'ruleId',v_rule.id,'ruleVersion',v_rule.versao,'factor',trim_scale(v_rule.fator)::text,'inputValue',trim_scale(v_new.valor)::text,'resultValue',trim_scale(v_result)::text);
   insert into public.resultados(entrada_id,regra_id,valor,memoria,revisao_id) values(v_entry.id,v_rule.id,v_result,v_memory,v_new.id);
  end if;
  v_revision:=v_new;v_status:='enviada';v_action:='posicao_corrigida';
  update public.entradas set revisao_atual_id=v_new.id,revisao=v_new.numero,estado=v_status,lock_version=lock_version+1 where id=v_entry.id;
 else
  -- An old acceptance never qualifies a different/current returned revision.
  if v_entry.estado<>'validada' or not exists(select 1 from public.decisoes_entrada where revisao_id=v_revision.id and tipo='validar' and ator_id<>v_revision.autor_id) then raise exception using errcode='55000',message='invalid_state';end if;
  if p_command='authorize_correction' then v_status:='devolvida';v_type:='autorizar_retificacao';v_action:='retificacao_autorizada';
  else
   if v_revision.estado_dado<>'indisponivel' or exists(select 1 from public.decisoes_entrada where revisao_id=v_revision.id and tipo='decidir_indisponibilidade') then raise exception using errcode='55000',message='invalid_state';end if;
   v_status:='validada';v_type:='decidir_indisponibilidade';v_action:='indisponibilidade_decidida';
  end if;
  select valor into v_result from public.resultados where revisao_id=v_revision.id;
  insert into public.decisoes_entrada(revisao_id,ator_id,tipo,motivo,referencia,ocorrido_em) values(v_revision.id,auth.uid(),v_type,v_reason,v_reference,clock_timestamp());
  update public.entradas set estado=v_status,lock_version=lock_version+1 where id=v_entry.id;
 end if;
 update public.posicoes_esperadas set lock_version=lock_version+1 where id=v_id returning * into v_position;
 update public.competencias set lock_version=lock_version+1 where id=v_competence.id;
 v_response:=jsonb_build_object('resourceId',v_id,'version',v_position.lock_version,'revisionId',v_revision.id,'status',v_status,'resultValue',trim_scale(v_result)::text);
 insert into public.eventos_auditoria(actor_id,acao,recurso_tipo,recurso_id,detalhes,correlacao_id)
  values(auth.uid(),v_action,'posicao',v_id,jsonb_strip_nulls(jsonb_build_object('version',v_position.lock_version,'revisionId',v_revision.id,'estadoDado',v_revision.estado_dado,'reason',v_reason,'reference',v_reference)),p_operation_id);
 insert into public.operacoes_dominio(ator_id,operation_id,comando,payload,resposta) values(auth.uid(),p_operation_id,p_command,v_canonical,v_response);
 return v_response;
end;
$$;
create or replace function private.run_academic_command(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_command in ('save_draft','submit') then return private.run_academic_submission(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command in ('start_review','review') then return private.review_academic_position(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command in ('correct','authorize_correction','decide_unavailability') then return private.correct_academic_position(p_contexto,p_command,p_payload,p_operation_id);
 else raise exception using errcode='42501',message='access_denied';end if;
end;
$$;
create function public.correct_position(p_contexto jsonb,p_position_id uuid,p_expected_version integer,p_input jsonb,p_operation_id uuid)
returns jsonb language sql security definer set search_path='' as $$select private.run_academic_command(p_contexto,'correct',jsonb_build_object('positionId',p_position_id,'expectedVersion',p_expected_version,'input',p_input),p_operation_id);$$;
create function public.authorize_position_correction(p_contexto jsonb,p_position_id uuid,p_expected_version integer,p_reason text,p_operation_id uuid)
returns jsonb language sql security definer set search_path='' as $$select private.run_academic_command(p_contexto,'authorize_correction',jsonb_build_object('positionId',p_position_id,'expectedVersion',p_expected_version,'reason',p_reason),p_operation_id);$$;
create function public.decide_unavailability(p_contexto jsonb,p_position_id uuid,p_expected_version integer,p_reference text,p_reason text,p_operation_id uuid)
returns jsonb language sql security definer set search_path='' as $$select private.run_academic_command(p_contexto,'decide_unavailability',jsonb_build_object('positionId',p_position_id,'expectedVersion',p_expected_version,'reference',p_reference,'reason',p_reason),p_operation_id);$$;
revoke all on function private.trim_academic_text(text),private.correction_input(jsonb),private.correct_academic_position(jsonb,text,jsonb,uuid),private.save_academic_draft(jsonb,text,jsonb,uuid),private.run_academic_submission(jsonb,text,jsonb,uuid),private.run_academic_command(jsonb,text,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.correct_position(jsonb,uuid,integer,jsonb,uuid),public.authorize_position_correction(jsonb,uuid,integer,text,uuid),public.decide_unavailability(jsonb,uuid,integer,text,text,uuid) from public,anon,service_role;
grant execute on function public.correct_position(jsonb,uuid,integer,jsonb,uuid),public.authorize_position_correction(jsonb,uuid,integer,text,uuid),public.decide_unavailability(jsonb,uuid,integer,text,text,uuid) to authenticated;
commit;
