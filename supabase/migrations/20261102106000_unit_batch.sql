begin;

-- Model-3 unit batch: the area técnica reads the positions of one unit and
-- submits them all or nothing through the existing position commands
-- (private.run_academic_command), so every item keeps the single-position
-- validation, locks, versions and idempotency. Model-2 paths are unchanged.

-- R-25: a model-3 correction records what changed apart from the reason
-- (motivo keeps its meaning: why the data is unavailable or not applicable).
alter table public.revisoes_entrada add column explicacao_correcao text
 constraint revisoes_explicacao_check check (explicacao_correcao is null or (char_length(explicacao_correcao) between 1 and 1000 and btrim(explicacao_correcao)<>''));

-- From 20261102102000_model3_commands.sql. On model 3 only, 'correct' requires
-- input.explanation (trimmed, 1..1000), keeps it in the idempotency payload and
-- stores it on the new revision. Model 2 accepts no new key; the rest is unchanged.
create or replace function private.correct_academic_position(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_context jsonb;v_capability text;v_id uuid;v_expected integer;
 v_competence public.competencias%rowtype;v_position public.posicoes_esperadas%rowtype;
 v_entry public.entradas%rowtype;v_revision public.revisoes_entrada%rowtype;v_new public.revisoes_entrada%rowtype;
 v_existing public.operacoes_dominio%rowtype;v_rule public.regras%rowtype;
 v_item public.itens_conjunto%rowtype;v_set public.conjuntos_regra%rowtype;
 v_input jsonb;v_canonical jsonb;v_response jsonb;v_memory jsonb;
 v_reason text;v_reference text;v_status text;v_type text;v_action text;v_result numeric(18,10);v_explanation text;
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
  -- R-25: a model-3 correction says what changed, in the input's explanation.
  if v_competence.modelo=3 then
   if jsonb_typeof(p_payload->'input'->'explanation') is distinct from 'string' then raise exception using errcode='22023',message='invalid_input';end if;
   v_explanation:=private.trim_academic_text(p_payload->'input'->>'explanation');
   if v_explanation='' or length(v_explanation)>1000 then raise exception using errcode='22023',message='invalid_input';end if;
   v_input:=private.correction_input((p_payload->'input')-'explanation');
  else
   v_input:=private.correction_input(p_payload->'input');
  end if;
  if v_input->>'estadoDado'='nao_aplicavel' and v_competence.modelo<>3 then raise exception using errcode='22023',message='invalid_input';end if;
  v_canonical:=v_canonical||jsonb_build_object('input',v_input)||jsonb_strip_nulls(jsonb_build_object('explanation',v_explanation));
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
  insert into public.revisoes_entrada(entrada_id,numero,autor_id,estado_dado,valor,origem,periodo_fonte,motivo,enviada_em,explicacao_correcao)
   values(v_entry.id,v_revision.numero+1,auth.uid(),v_input->>'estadoDado',(v_input->>'valor')::numeric,v_input->>'fonte',v_input->>'periodoFonte',v_input->>'motivo',clock_timestamp(),v_explanation) returning * into v_new;
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
-- From 20261102102000_model3_commands.sql. Revisions also carry the correction
-- explanation (null when the revision is not a model-3 correction).
create or replace function public.get_position_detail(p_contexto jsonb,p_position_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_position jsonb; v_entry uuid; v_revisions jsonb; v_decisions jsonb; v_memories jsonb;
begin
 select r.summary into v_position from private.operational_position_rows(p_contexto) r where r.id=p_position_id;
 if v_position is null then raise exception using errcode='42501',message='access_denied'; end if;
 select e.id into v_entry from public.entradas e where e.posicao_id=p_position_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'number',r.numero,'authorId',r.autor_id,
  'estadoDado',r.estado_dado,'value',trim_scale(r.valor)::text,'source',r.origem,'sourcePeriod',r.periodo_fonte,'reason',r.motivo,'submittedAt',r.enviada_em,'correctionExplanation',r.explicacao_correcao) order by r.numero,r.id),'[]'::jsonb)
 into v_revisions from public.revisoes_entrada r where r.entrada_id=v_entry;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'revisionId',d.revisao_id,'actorId',d.ator_id,'type',d.tipo,'reason',d.motivo,'reference',d.referencia,'occurredAt',d.ocorrido_em) order by d.ocorrido_em,d.id),'[]'::jsonb)
 into v_decisions from public.decisoes_entrada d join public.revisoes_entrada r on r.id=d.revisao_id where r.entrada_id=v_entry;
 select coalesce(jsonb_agg(jsonb_build_object('revisionId',r.id,'ruleVersion',rule.versao,'method',rule.metodo,'factor',trim_scale(rule.fator)::text,
  'inputValue',trim_scale(r.valor)::text,'resultValue',trim_scale(result.valor)::text) order by r.numero,r.id),'[]'::jsonb)
 into v_memories from public.resultados result join public.revisoes_entrada r on r.id=result.revisao_id join public.regras rule on rule.id=result.regra_id where r.entrada_id=v_entry;
 return jsonb_build_object('position',v_position,'revisions',v_revisions,'decisions',v_decisions,'memories',v_memories);
end;
$$;
-- Authorizes every batch item against its own link: positions of the caller's
-- area-técnica contexts, all in one model-3 competence and one unit.
create function private.authorize_unit_batch(p_itens jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_item jsonb; v_context jsonb; v_position public.posicoes_esperadas%rowtype; v_competence uuid; v_unit uuid;
begin
 for v_item in select value from jsonb_array_elements(p_itens) loop
  v_context:=private.require_academic_context(v_item->'contexto','draft');
  select * into v_position from public.posicoes_esperadas where id=(v_item->>'positionId')::uuid;
  if v_position.id is null or not(v_context->'positionIds' ? v_position.id::text)
   or (v_competence is not null and (v_position.competencia_id<>v_competence or v_position.alvo_id<>v_unit)) then
   raise exception using errcode='42501',message='access_denied';
  end if;
  v_competence:=v_position.competencia_id; v_unit:=v_position.alvo_id;
 end loop;
 if not exists(select 1 from public.competencias where id=v_competence and modelo=3) then raise exception using errcode='42501',message='access_denied'; end if;
 return jsonb_build_object('competenciaId',v_competence,'unitId',v_unit);
end;$$;

-- The caller's area-técnica positions of one unit, with their rule and current
-- revision. Contexts that do not include the unit are ignored; none is 42501.
create function public.get_unit_batch(p_contextos jsonb,p_unidade_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_ctx jsonb; v_context jsonb; v_competence uuid; v_positions uuid[]:='{}'; v_unit public.escopos%rowtype; v_items jsonb;
begin
 if jsonb_typeof(p_contextos) is distinct from 'array' or jsonb_array_length(p_contextos) not between 1 and 8 then
  raise exception using errcode='22023',message='invalid_input';
 end if;
 for v_ctx in select value from jsonb_array_elements(p_contextos) loop
  v_context:=private.require_academic_context(v_ctx,'draft');
  if v_competence is not null and v_competence<>(v_context->>'competenciaId')::uuid then raise exception using errcode='42501',message='access_denied'; end if;
  v_competence:=(v_context->>'competenciaId')::uuid;
  v_positions:=v_positions||array(select p.id from public.posicoes_esperadas p
   where p.alvo_id=p_unidade_id and p.id in (select value::uuid from jsonb_array_elements_text(v_context->'positionIds')));
 end loop;
 if cardinality(v_positions)=0 or not exists(select 1 from public.competencias where id=v_competence and modelo=3) then
  raise exception using errcode='42501',message='access_denied';
 end if;
 select * into v_unit from public.escopos where id=p_unidade_id;
 select jsonb_agg(jsonb_build_object('positionId',p.id,'indicatorCode',i.codigo,'name',r.nome,'meta',trim_scale(r.meta)::text,'direction',r.direcao,
  'weight',trim_scale(it.peso)::text,'decimals',r.casas_decimais,'max',trim_scale(r.valor_maximo)::text,'unit',r.unidade_medida,
  'status',coalesce(e.estado,'ausente'),'version',p.lock_version,'estadoDado',v.estado_dado,'valor',trim_scale(v.valor)::text,'fonte',v.origem,'motivo',v.motivo,
  -- Why the current revision came back: the reviewer's return or the CAM's rectification.
  'returnReason',case when e.estado='devolvida' then (select d.motivo from public.decisoes_entrada d where d.revisao_id=v.id
    and d.tipo in ('devolver','autorizar_retificacao') order by d.ocorrido_em desc,d.id desc limit 1) end,
  'revisionNumber',v.numero) order by i.codigo,p.id)
 into v_items
 from public.posicoes_esperadas p join public.indicadores i on i.id=p.indicador_id join public.regras r on r.id=p.regra_id
 join public.competencias c on c.id=p.competencia_id join public.itens_conjunto it on it.conjunto_id=c.conjunto_id and it.indicador_id=p.indicador_id
 left join public.entradas e on e.posicao_id=p.id left join public.revisoes_entrada v on v.id=e.revisao_atual_id
 where p.id=any(v_positions);
 return jsonb_build_object('unitId',v_unit.id,'unitCode',v_unit.codigo,'items',v_items);
end;$$;

-- All or nothing: 1..8 items of one unit, each through the single-position
-- path (draft + submit, or correct when returned) under an operation id derived
-- from the batch one. An item failure aborts the batch as 22023 with
-- DETAIL {"positionId","code"}; 42501 and 40001 pass through unchanged.
create function public.submit_unit_batch(p_itens jsonb,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_item jsonb; v_id uuid; v_status text; v_correction jsonb; v_receipt jsonb; v_receipts jsonb:='[]'; v_response jsonb;
 v_canonical jsonb; v_existing public.operacoes_dominio%rowtype; v_state text; v_message text;
begin
 if p_operation_id is null or jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) not between 1 and 8 then
  raise exception using errcode='22023',message='invalid_input';
 end if;
 for v_item in select value from jsonb_array_elements(p_itens) loop
  if jsonb_typeof(v_item) is distinct from 'object' then raise exception using errcode='22023',message='invalid_input'; end if;
  if (select count(*) from jsonb_object_keys(v_item))<>5 or not v_item ?& array['contexto','positionId','expectedVersion','input','correction']
   or jsonb_typeof(v_item->'positionId') is distinct from 'string'
   or v_item->>'positionId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise exception using errcode='22023',message='invalid_input';
  end if;
 end loop;
 if (select count(distinct (value->>'positionId')::uuid) from jsonb_array_elements(p_itens))<>jsonb_array_length(p_itens) then
  raise exception using errcode='22023',message='invalid_input';
 end if;
 perform private.authorize_unit_batch(p_itens);
 -- Same lock order as every position command: competence, then positions (by
 -- id here, so concurrent batches cannot deadlock), then entries inside each.
 perform 1 from public.competencias where id=(select p.competencia_id from public.posicoes_esperadas p where p.id=(p_itens->0->>'positionId')::uuid) for update;
 perform 1 from public.posicoes_esperadas where id in (select (value->>'positionId')::uuid from jsonb_array_elements(p_itens)) order by id for update;
 perform pg_advisory_xact_lock(hashtextextended((auth.uid())::text||':'||p_operation_id::text,0));
 -- Never recover a cached response without current authorization under the locks.
 perform private.authorize_unit_batch(p_itens);
 v_canonical:=jsonb_build_object('items',p_itens);
 select * into v_existing from public.operacoes_dominio where ator_id=auth.uid() and operation_id=p_operation_id;
 if v_existing.id is not null then
  if v_existing.comando<>'submit_unit_batch' or v_existing.payload<>v_canonical then raise exception using errcode='22023',message='operation_payload_mismatch'; end if;
  return v_existing.resposta;
 end if;
 for v_item in select value from jsonb_array_elements(p_itens) order by (value->>'positionId')::uuid loop
  v_id:=(v_item->>'positionId')::uuid; v_correction:=v_item->'correction';
  begin
   select estado into v_status from public.entradas where posicao_id=v_id;
   -- A correction is null, or {"explanation"} on a returned position only.
   if v_correction<>'null'::jsonb and (v_status is distinct from 'devolvida'
    or case when jsonb_typeof(v_correction)='object' then v_correction-'explanation'<>'{}'::jsonb else true end) then
    raise exception using errcode='22023',message='invalid_input';
   end if;
   if v_status='devolvida' then
    v_receipt:=private.run_academic_command(v_item->'contexto','correct',jsonb_build_object('positionId',v_id,'expectedVersion',v_item->'expectedVersion',
     'input',case when jsonb_typeof(v_item->'input')='object' and v_correction<>'null'::jsonb then v_item->'input'||jsonb_build_object('explanation',v_correction->'explanation') else v_item->'input' end),
     extensions.uuid_generate_v5(p_operation_id,v_id::text||':correct'));
   else
    v_receipt:=private.run_academic_command(v_item->'contexto','save_draft',jsonb_build_object('positionId',v_id,'expectedVersion',v_item->'expectedVersion','input',v_item->'input'),
     extensions.uuid_generate_v5(p_operation_id,v_id::text||':save_draft'));
    v_receipt:=private.run_academic_command(v_item->'contexto','submit',jsonb_build_object('positionId',v_id,'expectedVersion',v_receipt->'version'),
     extensions.uuid_generate_v5(p_operation_id,v_id::text||':submit'));
   end if;
  exception when sqlstate '22023' or sqlstate '55000' then
   get stacked diagnostics v_state=returned_sqlstate,v_message=message_text;
   raise exception using errcode='22023',message='invalid_input',detail=jsonb_build_object('positionId',v_id,'code',
    case when v_state='55000' then 'invalid_state' when v_message in ('rule_unavailable','operation_payload_mismatch') then v_message else 'invalid_input' end)::text;
  end;
  v_receipts:=v_receipts||jsonb_build_array(v_receipt);
 end loop;
 v_response:=jsonb_build_object('items',v_receipts);
 insert into public.operacoes_dominio(ator_id,operation_id,comando,payload,resposta) values(auth.uid(),p_operation_id,'submit_unit_batch',v_canonical,v_response);
 return v_response;
end;$$;

revoke all on function private.authorize_unit_batch(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.get_unit_batch(jsonb,uuid),public.submit_unit_batch(jsonb,uuid) from public,anon,service_role;
grant execute on function public.get_unit_batch(jsonb,uuid),public.submit_unit_batch(jsonb,uuid) to authenticated;

commit;
