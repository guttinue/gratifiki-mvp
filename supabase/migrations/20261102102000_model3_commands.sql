begin;

-- Model-3 competences reuse the model-2 position commands. Every replaced body
-- is restated from its latest definition; the model-2 paths are unchanged.
-- Model 3 adds: meta/weight rule pinned to the set item, value limits of the
-- rule, scoring through private.calcular_pontos, and the nao_aplicavel state.

-- Discovery: model 3 follows the model-2 link rules and emits its model.
drop function private.authorized_context_rows();
create function private.authorized_context_rows()
returns table(vinculo_id uuid,actor_id uuid,papel text,competencia_id uuid,indicador_id uuid,
 escopo_id uuid,escopo_codigo text,competencia_codigo text,mode text,modelo integer)
language sql stable security definer set search_path='' as $$
 select v.id,v.actor_id,v.papel,c.id,i.id,s.id,s.codigo,c.codigo,
  case when c.modelo=1 then 'legacy' else 'academic' end,c.modelo
 from public.vinculos v
 join public.escopos s on s.id=v.escopo_id
 cross join public.competencias c
 join public.indicadores i on (v.indicador_id=i.id or v.indicador_id is null)
 where auth.uid() is not null and v.actor_id=auth.uid() and v.ativo
  and (v.vigencia_inicio is null or v.vigencia_inicio<=current_date)
  and (v.vigencia_fim is null or v.vigencia_fim>=current_date)
  and (
   (c.modelo=1 and v.indicador_id is null and s.tipo is null and v.papel in ('area_tecnica','cam')
    and exists(select 1 from public.regras r where r.indicador_id=i.id and not exists(select 1 from public.ativacoes_regra a where a.regra_id=r.id) and c.referencia>=r.vigencia_inicio
     and (r.vigencia_fim is null or c.referencia<=r.vigencia_fim)))
   or
   (c.modelo in (2,3) and v.indicador_id=i.id and v.vigencia_inicio is not null
    and exists(select 1 from public.contas_demo a where a.ator_id=auth.uid() and a.ativo)
    and (
     (v.papel='administrador')
     or (v.papel in ('area_tecnica','revisor_tecnico','cam','gestor_unidade')
      and (v.papel<>'gestor_unidade' or s.tipo='unidade')
      and exists(select 1 from public.posicoes_esperadas p where p.competencia_id=c.id and p.indicador_id=i.id and p.alvo_id=s.id
       and (v.papel<>'area_tecnica' or p.informante_id=auth.uid())
       and (v.papel<>'revisor_tecnico' or (p.revisor_id=auth.uid() and p.informante_id<>auth.uid()))))
     or (v.papel in ('gestor_distrital','lideranca') and s.tipo='distrito'
      and exists(select 1 from public.posicoes_esperadas p where p.competencia_id=c.id and p.indicador_id=i.id
       and ((v.papel='gestor_distrital' and p.alvo_id=s.id) or exists(select 1 from public.territorios_competencia t
        join public.escopos unit_scope on unit_scope.id=t.unidade_id and unit_scope.tipo='unidade'
        where t.competencia_id=c.id and t.distrito_id=s.id and t.unidade_id=p.alvo_id))))
    ))
  );
$$;
revoke all on function private.authorized_context_rows() from public,anon,authenticated,service_role;

create or replace function public.get_authorized_contexts() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('contexts',coalesce(jsonb_agg(jsonb_build_object(
  'key',r.vinculo_id::text||':'||r.competencia_id::text||':'||r.indicador_id::text,
  'actorId',r.actor_id,'role',r.papel,'vinculoId',r.vinculo_id,'competenciaId',r.competencia_id,
  'indicadorId',r.indicador_id,'escopoId',r.escopo_id,'escopoCodigo',r.escopo_codigo,
  'competenciaCodigo',r.competencia_codigo,'mode',r.mode,'modelo',r.modelo,'competenciaEstado',c.estado)
  order by r.competencia_codigo,r.papel,r.escopo_codigo,r.vinculo_id,r.indicador_id),'[]'::jsonb))
 from private.authorized_context_rows() r join public.competencias c on c.id=r.competencia_id;
$$;

-- A meta/weight value is within the rule maximum and its decimal places.
-- Trailing zeros are not places: 16.0 is the integer 16. Factor rules pass.
create function private.check_rule_value(p_regra public.regras,p_valor numeric) returns void
language plpgsql immutable set search_path='' as $$
begin
 if p_regra.metodo='meta_peso' and p_valor is not null
  and (p_valor<0 or p_valor>p_regra.valor_maximo or scale(trim_scale(p_valor))>p_regra.casas_decimais) then
  raise exception using errcode='22023',message='invalid_input';
 end if;
end;$$;
revoke all on function private.check_rule_value(public.regras,numeric) from public,anon,authenticated,service_role;

-- From 20261019105000_academic_configuration.sql. Adds nao_aplicavel (model 3
-- only, never with a value) and the meta/weight value limits.
create or replace function private.save_academic_draft(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_context jsonb; v_position public.posicoes_esperadas%rowtype; v_competence public.competencias%rowtype;
 v_entry public.entradas%rowtype; v_revision public.revisoes_entrada%rowtype; v_existing public.operacoes_dominio%rowtype;
 v_input jsonb; v_value numeric; v_text text; v_source text; v_period text; v_reason text;
 v_canonical jsonb; v_response jsonb; v_expected integer; v_id uuid; v_rule public.regras%rowtype;
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
  jsonb_typeof(v_input->'estadoDado') is distinct from 'string' or v_input->>'estadoDado' not in ('valor','indisponivel','nao_aplicavel') or
  (v_input->>'estadoDado'='nao_aplicavel' and v_competence.modelo<>3) or
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
 if v_input->>'estadoDado' in ('indisponivel','nao_aplicavel') and v_value is not null then raise exception using errcode='22023',message='invalid_input'; end if;
 select * into v_rule from public.regras where id=v_position.regra_id and indicador_id=v_position.indicador_id;
 perform private.check_rule_value(v_rule,v_value);
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
  (v_entry.id is not null and (v_entry.estado<>'rascunho' or v_revision.enviada_em is not null)) then
  raise exception using errcode='55000',message='invalid_state';
 end if;
 if v_entry.id is null then
  insert into public.entradas(competencia_id,indicador_id,escopo_id,autor_id,valor,estado,revisao,operation_id,posicao_id)
   values(v_position.competencia_id,v_position.indicador_id,v_position.alvo_id,auth.uid(),null,'rascunho',1,p_operation_id,v_id) returning * into v_entry;
 end if;
 if v_revision.id is null or v_revision.autor_id<>auth.uid() then
  insert into public.revisoes_entrada(entrada_id,numero,autor_id,estado_dado,valor,origem,periodo_fonte,motivo)
   values(v_entry.id,(select coalesce(max(numero),0)+1 from public.revisoes_entrada where entrada_id=v_entry.id),auth.uid(),v_input->>'estadoDado',v_value,v_source,v_period,v_reason) returning * into v_revision;
 else
  update public.revisoes_entrada set estado_dado=v_input->>'estadoDado',valor=v_value,origem=v_source,periodo_fonte=v_period,motivo=v_reason where id=v_revision.id;
 end if;
 update public.entradas set revisao_atual_id=v_revision.id,revisao=v_revision.numero,lock_version=lock_version+1 where id=v_entry.id;
 update public.posicoes_esperadas set lock_version=lock_version+1 where id=v_id returning * into v_position;
 update public.competencias set lock_version=lock_version+1 where id=v_competence.id;
 v_response:=jsonb_build_object('resourceId',v_id,'version',v_position.lock_version,'revisionId',v_revision.id,'status','rascunho','resultValue',null);
 insert into public.eventos_auditoria(actor_id,acao,recurso_tipo,recurso_id,detalhes,correlacao_id)
  values(auth.uid(),'rascunho_salvo','posicao',v_id,jsonb_build_object('version',v_position.lock_version,'revisionId',v_revision.id),p_operation_id);
 insert into public.operacoes_dominio(ator_id,operation_id,comando,payload,resposta) values(auth.uid(),p_operation_id,p_command,v_canonical,v_response);
 return v_response;
end;
$$;

-- From 20261019100000_academic_correction.sql. Adds nao_aplicavel, the set
-- item check for meta/weight rules and the meta/weight result memory.
create or replace function private.run_academic_submission(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_context jsonb; v_capability text; v_id uuid; v_expected integer;
 v_competence public.competencias%rowtype; v_position public.posicoes_esperadas%rowtype;
 v_entry public.entradas%rowtype; v_revision public.revisoes_entrada%rowtype;
 v_rule public.regras%rowtype; v_existing public.operacoes_dominio%rowtype;
 v_item public.itens_conjunto%rowtype; v_set public.conjuntos_regra%rowtype;
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
  (v_revision.estado_dado in ('indisponivel','nao_aplicavel') and (v_revision.valor is not null or v_revision.motivo='')) or
  (v_revision.estado_dado='nao_aplicavel' and v_competence.modelo<>3) then
  raise exception using errcode='22023',message='invalid_input';
 end if;
 begin
  if (v_revision.periodo_fonte::date)::text<>v_revision.periodo_fonte then raise exception using errcode='22023',message='invalid_input'; end if;
 exception when datetime_field_overflow or invalid_datetime_format then raise exception using errcode='22023',message='invalid_input'; end;
 select * into v_rule from public.regras where id=v_position.regra_id and indicador_id=v_position.indicador_id;
 -- A meta/weight rule, and any model-3 rule, must be the rule of the
 -- competence's set item for this indicator.
 select * into v_item from public.itens_conjunto where conjunto_id=v_competence.conjunto_id and indicador_id=v_position.indicador_id and regra_id=v_rule.id;
 if v_rule.id is null or (v_rule.metodo='fator' and (v_rule.fator<=0 or v_rule.fator>1))
  or ((v_rule.metodo='meta_peso' or v_competence.modelo=3) and v_item.regra_id is null) then raise exception using errcode='22023',message='rule_unavailable'; end if;
 perform private.check_rule_value(v_rule,v_revision.valor);
 -- No temporal lookup, floating point or institutional formula. The position
 -- pins its immutable synthetic rule. Unavailability never becomes zero.
 if v_revision.estado_dado='valor' and v_rule.metodo='meta_peso' then
  -- Effective weight is the item weight here; redistribution happens at read and close.
  select * into v_set from public.conjuntos_regra where id=v_competence.conjunto_id;
  v_memory:=private.calcular_pontos(v_rule,v_item.peso,v_revision.valor)||jsonb_build_object('revisionId',v_revision.id,
   'ruleSetId',v_set.id,'ruleSetVersion',v_set.versao,'mode',v_set.modo_ausencia,'effectiveWeight',trim_scale(v_item.peso)::text);
  v_result:=(v_memory->>'points')::numeric;
 elsif v_revision.estado_dado='valor' then
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

-- From 20261019100000_academic_correction.sql. Adds nao_aplicavel, which like
-- indisponivel has no value and needs a reason. The model check is the caller's.
create or replace function private.correction_input(p_input jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare v_source text;v_period text;v_reason text;v_text text;v_value numeric;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or
  (select count(*) from jsonb_object_keys(p_input))<>5 or
  exists(select 1 from jsonb_object_keys(p_input) k where k not in ('estadoDado','valor','fonte','periodoFonte','motivo')) or
  jsonb_typeof(p_input->'estadoDado') is distinct from 'string' or p_input->>'estadoDado' not in ('valor','indisponivel','nao_aplicavel') or
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
  (p_input->>'estadoDado' in ('indisponivel','nao_aplicavel') and (v_value is not null or v_reason='')) then raise exception using errcode='22023',message='invalid_input';end if;
 return jsonb_build_object('estadoDado',p_input->>'estadoDado','valor',trim_scale(v_value)::text,'fonte',v_source,'periodoFonte',v_period,'motivo',v_reason);
end;
$$;

-- From 20261019100000_academic_correction.sql. Correction gains the model-3
-- rule, value and memory rules of submission; the CAM decision also covers
-- nao_aplicavel on model 3. Acceptance segregation is unchanged.
create or replace function private.correct_academic_position(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_context jsonb;v_capability text;v_id uuid;v_expected integer;
 v_competence public.competencias%rowtype;v_position public.posicoes_esperadas%rowtype;
 v_entry public.entradas%rowtype;v_revision public.revisoes_entrada%rowtype;v_new public.revisoes_entrada%rowtype;
 v_existing public.operacoes_dominio%rowtype;v_rule public.regras%rowtype;
 v_item public.itens_conjunto%rowtype;v_set public.conjuntos_regra%rowtype;
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
  v_input:=private.correction_input(p_payload->'input');
  if v_input->>'estadoDado'='nao_aplicavel' and v_competence.modelo<>3 then raise exception using errcode='22023',message='invalid_input';end if;
  v_canonical:=v_canonical||jsonb_build_object('input',v_input);
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
  select * into v_item from public.itens_conjunto where conjunto_id=v_competence.conjunto_id and indicador_id=v_position.indicador_id and regra_id=v_rule.id;
  if v_rule.id is null or (v_rule.metodo='fator' and (v_rule.fator<=0 or v_rule.fator>1))
   or ((v_rule.metodo='meta_peso' or v_competence.modelo=3) and v_item.regra_id is null) then raise exception using errcode='22023',message='rule_unavailable';end if;
  perform private.check_rule_value(v_rule,(v_input->>'valor')::numeric);
  insert into public.revisoes_entrada(entrada_id,numero,autor_id,estado_dado,valor,origem,periodo_fonte,motivo,enviada_em)
   values(v_entry.id,v_revision.numero+1,auth.uid(),v_input->>'estadoDado',(v_input->>'valor')::numeric,v_input->>'fonte',v_input->>'periodoFonte',v_input->>'motivo',clock_timestamp()) returning * into v_new;
  if v_new.estado_dado='valor' and v_rule.metodo='meta_peso' then
   select * into v_set from public.conjuntos_regra where id=v_competence.conjunto_id;
   v_memory:=private.calcular_pontos(v_rule,v_item.peso,v_new.valor)||jsonb_build_object('revisionId',v_new.id,
    'ruleSetId',v_set.id,'ruleSetVersion',v_set.versao,'mode',v_set.modo_ausencia,'effectiveWeight',trim_scale(v_item.peso)::text);
   v_result:=(v_memory->>'points')::numeric;
   insert into public.resultados(entrada_id,regra_id,valor,memoria,revisao_id) values(v_entry.id,v_rule.id,v_result,v_memory,v_new.id);
  elsif v_new.estado_dado='valor' then
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
   if v_revision.estado_dado not in ('indisponivel','nao_aplicavel') or (v_revision.estado_dado='nao_aplicavel' and v_competence.modelo<>3)
    or exists(select 1 from public.decisoes_entrada where revisao_id=v_revision.id and tipo='decidir_indisponibilidade') then raise exception using errcode='55000',message='invalid_state';end if;
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

commit;
