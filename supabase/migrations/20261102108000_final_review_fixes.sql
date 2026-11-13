begin;

-- Final review fixes (V3). Every function is restated from its latest
-- definition with the same signature, security definer and search_path;
-- create or replace keeps the existing ACLs. Model-2 paths are unchanged.

-- From 20261102106000_unit_batch.sql. I-2: each item carries its current
-- revision's source period ("periodoFonte", null when none was saved). I-3: the
-- batch carries the absence mode of the competence's rule set ("mode").
create or replace function public.get_unit_batch(p_contextos jsonb,p_unidade_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_ctx jsonb; v_context jsonb; v_competence uuid; v_positions uuid[]:='{}'; v_unit public.escopos%rowtype; v_items jsonb; v_mode text;
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
 select s.modo_ausencia into v_mode from public.competencias c join public.conjuntos_regra s on s.id=c.conjunto_id where c.id=v_competence;
 select jsonb_agg(jsonb_build_object('positionId',p.id,'indicatorCode',i.codigo,'name',r.nome,'meta',trim_scale(r.meta)::text,'direction',r.direcao,
  'weight',trim_scale(it.peso)::text,'decimals',r.casas_decimais,'max',trim_scale(r.valor_maximo)::text,'unit',r.unidade_medida,
  'status',coalesce(e.estado,'ausente'),'version',p.lock_version,'estadoDado',v.estado_dado,'valor',trim_scale(v.valor)::text,'fonte',v.origem,'motivo',v.motivo,
  -- The saved source period (YYYY-MM-DD); null when none was saved.
  'periodoFonte',nullif(v.periodo_fonte,''),
  -- Why the current revision came back: the reviewer's return or the CAM's rectification.
  'returnReason',case when e.estado='devolvida' then (select d.motivo from public.decisoes_entrada d where d.revisao_id=v.id
    and d.tipo in ('devolver','autorizar_retificacao') order by d.ocorrido_em desc,d.id desc limit 1) end,
  'revisionNumber',v.numero) order by i.codigo,p.id)
 into v_items
 from public.posicoes_esperadas p join public.indicadores i on i.id=p.indicador_id join public.regras r on r.id=p.regra_id
 join public.competencias c on c.id=p.competencia_id join public.itens_conjunto it on it.conjunto_id=c.conjunto_id and it.indicador_id=p.indicador_id
 left join public.entradas e on e.posicao_id=p.id left join public.revisoes_entrada v on v.id=e.revisao_atual_id
 where p.id=any(v_positions);
 return jsonb_build_object('unitId',v_unit.id,'unitCode',v_unit.codigo,'mode',v_mode,'items',v_items);
end;$$;

-- From 20261102106000_unit_batch.sql. M-d: an item without correction may not
-- carry input.explanation (22023 with the item detail), so an explanation only
-- reaches 'correct' through the correction field.
create or replace function public.submit_unit_batch(p_itens jsonb,p_operation_id uuid) returns jsonb
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
   -- Without a correction the input carries no explanation, so it can never reach 'correct'.
   if v_correction='null'::jsonb and jsonb_typeof(v_item->'input')='object' and v_item->'input' ? 'explanation' then
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

-- From 20261102105000_model3_read_models.sql. I-3: the results carry the
-- absence mode of the competence's rule set (frozen once the set is in use).
create or replace function public.get_unit_results(p_contexto jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ctx jsonb;c public.competencias%rowtype;prev public.competencias%rowtype;prev_closure uuid;published boolean;units jsonb;
begin
 ctx:=private.require_academic_context(p_contexto,'unit_results');
 select * into c from public.competencias where id=(ctx->>'competenciaId')::uuid;
 if c.modelo<>3 then raise exception using errcode='22023',message='invalid_input';end if;
 published:=exists(select 1 from public.fechamentos f join public.publicacoes pub on pub.fechamento_id=f.id where f.competencia_id=c.id);
 select pc.* into prev from public.competencias pc join public.conjuntos_regra ps on ps.id=pc.conjunto_id
 where pc.modelo=3 and pc.referencia<c.referencia and ps.codigo=(select s.codigo from public.conjuntos_regra s where s.id=c.conjunto_id)
  and exists(select 1 from public.fechamentos f join public.publicacoes pub on pub.fechamento_id=f.id where f.competencia_id=pc.id)
 order by pc.referencia desc limit 1;
 select f.id into prev_closure from public.fechamentos f where f.competencia_id=prev.id;
 select jsonb_agg(jsonb_build_object('unitId',u.unit_id,'unitCode',u.unit_code,'districtCode',u.district_code,'points',trim_scale(u.points)::text,
   'complete',u.complete,'noBase',u.no_base,'partial',not u.complete,
   'previous',case when pv.alvo_id is not null then jsonb_build_object('points',trim_scale(pv.pontos)::text,'competencia',prev.codigo) end,
   'delta',case when u.complete and u.points is not null and pv.completo and pv.pontos is not null then round(u.points-pv.pontos,2)::text end,
   'items',u.items) order by u.unit_code collate "C")
 into units
 from private.unit_result_rows(c.id,ctx->>'role',(ctx->>'escopoId')::uuid) u
 left join (select s.alvo_id,s.pontos,s.completo from public.pontuacoes_fechamento s
  join private.result_unit_ids(ctx->>'role',(ctx->>'escopoId')::uuid,prev.id) pu on pu.unidade_id=s.alvo_id
  where s.fechamento_id=prev_closure) pv on pv.alvo_id=u.unit_id;
 if units is null then raise exception using errcode='42501',message='access_denied';end if;
 return jsonb_build_object('competencia',c.codigo,'state',c.estado,'publication',case when published then 'publicada_demo' else 'nao_publicada' end,
  'mode',(select s.modo_ausencia from public.conjuntos_regra s where s.id=c.conjunto_id),'units',units);
end;$$;

-- From 20261102105000_model3_read_models.sql. I-3: the model-3 aggregate
-- carries the absence mode; the model-2 body is unchanged.
create or replace function public.get_leadership_aggregates(p_contexto jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c jsonb;result jsonb;
begin
 c:=private.require_academic_context(p_contexto,'leadership_aggregates');
 if (select modelo from public.competencias where id=(c->>'competenciaId')::uuid)=3 then
  with u as materialized (select * from private.unit_result_rows((c->>'competenciaId')::uuid,'lideranca',(c->>'escopoId')::uuid)),
  it as (select u.unit_code,x->>'reviewStatus' in ('valor','indisponivel','nao_aplicavel') accepted from u cross join jsonb_array_elements(u.items) x)
  select jsonb_build_object(
   'mode',(select s.modo_ausencia from public.competencias comp join public.conjuntos_regra s on s.id=comp.conjunto_id where comp.id=(c->>'competenciaId')::uuid),
   'acceptedPercent',(select round(100.0*count(*) filter(where accepted)/count(*),2)::text from it),
   'districts',(select jsonb_agg(d order by code collate "C") from (
     select u.district_code code,jsonb_build_object('districtCode',u.district_code,'average',round(avg(u.points) filter(where u.complete and u.points is not null),2)::text,
      'completeUnits',count(*) filter(where u.complete)::integer,'totalUnits',count(*)::integer) d
     from u group by u.district_code) g),
   'attention',(select coalesce(jsonb_agg(jsonb_build_object('unitCode',unit_code,'pending',pending) order by unit_code collate "C"),'[]'::jsonb) from (
     select unit_code,count(*) filter(where not accepted)::integer pending from it group by unit_code) a where pending>0))
  into result where exists(select 1 from u);
  if result is null then raise exception using errcode='42501',message='access_denied';end if;
  return result;
 end if;
 select coalesce(jsonb_agg(row),'[]'::jsonb) into result from (
 select jsonb_build_object('competencia',comp.codigo,'distritoCodigo',i.distrito_codigo,'unidadeMedida','pontos sintéticos','publishedUnits',count(*)::integer,
 'calculableUnits',count(*) filter(where i.estado_dado='valor')::integer,'resultSum',trim_scale(sum(i.valor_resultado) filter(where i.estado_dado='valor'))::text) row
 from public.fechamentos f join public.publicacoes pub on pub.fechamento_id=f.id join public.itens_fechamento i on i.fechamento_id=f.id join public.competencias comp on comp.id=f.competencia_id
 join public.posicoes_esperadas p on p.id=i.posicao_id
 where f.competencia_id=(c->>'competenciaId')::uuid and p.indicador_id=(c->>'indicadorId')::uuid and c->'positionIds'?p.id::text and i.alvo_tipo='unidade' and i.distrito_id=(c->>'escopoId')::uuid
 group by comp.codigo,i.distrito_codigo order by comp.codigo,i.distrito_codigo) grouped;
 return result;
end;$$;

-- From 20261019105000_academic_configuration.sql. I-5: schedule_demo_rule and
-- open_demo_competence refuse a model-3 context with 42501; reassign and every
-- model-2 path are unchanged.
create or replace function private.configure_academic_cycle(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctx jsonb;canonical jsonb;response jsonb;old_op public.operacoes_dominio%rowtype;
 c public.competencias%rowtype;p public.posicoes_esperadas%rowtype;e public.entradas%rowtype;
 indicator uuid;sid uuid;informant uuid;reviewer uuid;rid uuid;resource uuid;reference_month date;factor numeric;factor_text text;approval text;reason text;expected integer;new_version integer;event_name text;item jsonb;assignments jsonb;rule_count integer;
begin
 ctx:=private.require_academic_context(p_contexto,'admin_write');indicator:=(ctx->>'indicadorId')::uuid;
 if p_command not in ('open_demo_competence','reassign_demo_position','schedule_demo_rule') then raise exception using errcode='42501',message='access_denied';end if;
 -- Model 3 is configured by migration/seed: opening a competence or scheduling a
 -- factor rule from a model-3 context is refused. Model-2 paths are unchanged.
 if p_command in ('open_demo_competence','schedule_demo_rule') and exists(select 1 from public.competencias where id=(ctx->>'competenciaId')::uuid and modelo=3) then
  raise exception using errcode='42501',message='access_denied';
 end if;
 if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='22023',message='invalid_input';end if;
 if p_command='reassign_demo_position' then
  if (select count(*) from jsonb_object_keys(p_payload))<>4 or not(p_payload?&array['positionId','expectedVersion','input','reason']) or jsonb_typeof(p_payload->'input') is distinct from 'object' or (select count(*) from jsonb_object_keys(p_payload->'input'))<>2 or not((p_payload->'input')?&array['informanteId','revisorId']) or jsonb_typeof(p_payload->'reason') is distinct from 'string' or jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or (p_payload->>'expectedVersion')!~'^[1-9][0-9]*$' then raise exception using errcode='22023',message='invalid_input';end if;
  begin sid:=(p_payload->>'positionId')::uuid;informant:=(p_payload->'input'->>'informanteId')::uuid;reviewer:=(p_payload->'input'->>'revisorId')::uuid;expected:=(p_payload->>'expectedVersion')::integer;exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='invalid_input';end;
  reason:=private.trim_academic_text(p_payload->>'reason');if sid is null or reason='' or length(reason)>1000 then raise exception using errcode='22023',message='invalid_input';end if;
  if informant=auth.uid() or reviewer=auth.uid() then raise exception using errcode='42501',message='access_denied';end if;
  canonical:=jsonb_build_object('context',p_contexto,'positionId',sid,'expectedVersion',expected,'input',jsonb_build_object('informanteId',informant,'revisorId',reviewer),'reason',reason);
 else
  begin reference_month:=(p_payload->>'month')::date;exception when invalid_datetime_format or datetime_field_overflow then raise exception using errcode='22023',message='invalid_input';end;
  if reference_month is null or not isfinite(reference_month) or reference_month<date '0001-01-01' or reference_month>date '9999-12-01' or extract(day from reference_month)<>1 then raise exception using errcode='22023',message='invalid_input';end if;
  if p_command='schedule_demo_rule' then
   if (select count(*) from jsonb_object_keys(p_payload))<>3 or not(p_payload?&array['month','factor','reference']) or jsonb_typeof(p_payload->'factor') is distinct from 'string' or jsonb_typeof(p_payload->'reference') is distinct from 'string' then raise exception using errcode='22023',message='invalid_input';end if;
   factor_text:=replace(private.trim_academic_text(p_payload->>'factor'),',','.');approval:=private.trim_academic_text(p_payload->>'reference');
   if factor_text!~'^[0-9]+(\.[0-9]{1,6})?$' or length(factor_text)>100 or approval='' or length(approval)>500 then raise exception using errcode='22023',message='invalid_input';end if;
   factor:=factor_text::numeric;if factor<=0 or factor>1 then raise exception using errcode='22023',message='invalid_input';end if;
   canonical:=jsonb_build_object('context',p_contexto,'month',reference_month,'factor',trim_scale(factor)::text,'reference',approval);
  else
   if (select count(*) from jsonb_object_keys(p_payload))<>2 or not(p_payload?&array['month','assignments']) or jsonb_typeof(p_payload->'assignments') is distinct from 'array' or jsonb_array_length(p_payload->'assignments')=0 then raise exception using errcode='22023',message='invalid_input';end if;
   assignments:='[]'::jsonb;
   for item in select value from jsonb_array_elements(p_payload->'assignments') loop
    if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>4 or not(item?&array['escopoId','informanteId','revisorId','aplicavel']) or jsonb_typeof(item->'aplicavel') is distinct from 'boolean' then raise exception using errcode='22023',message='invalid_input';end if;
    begin sid:=(item->>'escopoId')::uuid;informant:=(item->>'informanteId')::uuid;reviewer:=(item->>'revisorId')::uuid;exception when invalid_text_representation then raise exception using errcode='22023',message='invalid_input';end;
    if informant=auth.uid() or reviewer=auth.uid() then raise exception using errcode='42501',message='access_denied';end if;
    if sid is null or informant is null or reviewer is null or informant=reviewer then raise exception using errcode='22023',message='invalid_input';end if;
    assignments:=assignments||jsonb_build_array(jsonb_build_object('escopoId',sid,'informanteId',informant,'revisorId',reviewer,'aplicavel',(item->>'aplicavel')::boolean));
   end loop;
   select jsonb_agg(value order by value->>'escopoId') into assignments from jsonb_array_elements(assignments);
   if (select count(distinct value->>'escopoId') from jsonb_array_elements(assignments))<>jsonb_array_length(assignments) then raise exception using errcode='22023',message='invalid_input';end if;
   canonical:=jsonb_build_object('context',p_contexto,'month',reference_month,'assignments',assignments);
  end if;
 end if;
 -- Never acquire another existing competence after the catalogue lock. A
 -- reassign targets ONLY the selected context month; opening inserts a new one.
 select * into c from public.competencias where id=(ctx->>'competenciaId')::uuid for update;
 perform pg_advisory_xact_lock(hashtextextended('academic:admin-catalog',0));
 if p_command='reassign_demo_position' then
  select * into p from public.posicoes_esperadas where id=sid and competencia_id=c.id and indicador_id=indicator for update;
  if p.id is null then raise exception using errcode='42501',message='access_denied';end if;
  select * into e from public.entradas where posicao_id=p.id for update;
  perform id from public.revisoes_entrada where entrada_id=e.id order by id for update;
 else
  perform id from public.escopos where tipo is not null order by id for share;
 end if;
 perform ator_id from public.contas_demo order by ator_id for share;
 perform id from public.vinculos where indicador_id=indicator order by id for share;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_operation_id::text,0));
 ctx:=private.require_academic_context(p_contexto,'admin_write');
 -- Even cached replies require currently active compatible assignees.
 if p_command='reassign_demo_position' then perform private.require_demo_assignment(p.alvo_id,informant,reviewer,indicator);
 elsif p_command='open_demo_competence' then
  for item in select value from jsonb_array_elements(assignments) loop perform private.require_demo_assignment((item->>'escopoId')::uuid,(item->>'informanteId')::uuid,(item->>'revisorId')::uuid,indicator);end loop;
 end if;
 select * into old_op from public.operacoes_dominio where ator_id=auth.uid() and operation_id=p_operation_id;
 if old_op.id is not null then
  if old_op.comando<>p_command or old_op.payload<>canonical then raise exception using errcode='22023',message='operation_payload_mismatch';end if;
  return old_op.resposta;
 end if;
 if p_command='reassign_demo_position' then
  if p.lock_version<>expected then raise exception using errcode='40001',message='version_conflict';end if;
  if c.estado<>'aberta' then raise exception using errcode='55000',message='invalid_state';end if;
  if e.estado='em_revisao' and (p.revisor_id<>reviewer or p.informante_id<>informant) then update public.entradas set estado='enviada',claim_revisao_atual_id=null,lock_version=lock_version+1 where id=e.id;end if;
  update public.posicoes_esperadas set informante_id=informant,revisor_id=reviewer,lock_version=lock_version+1 where id=p.id returning id,lock_version into resource,new_version;
  update public.competencias set lock_version=lock_version+1 where id=c.id;
  event_name:='posicao_demo_reatribuida';
 else
  if exists(select 1 from public.competencias where modelo=2 and referencia>=reference_month) then raise exception using errcode='22023',message='invalid_input';end if;
  if p_command='schedule_demo_rule' then
   if exists(select 1 from public.ativacoes_regra where indicador_id=indicator and primeiro_mes=reference_month) then raise exception using errcode='22023',message='invalid_input';end if;
   select coalesce(max(versao),0)+1 into new_version from public.regras where indicador_id=indicator;
   insert into public.regras(indicador_id,versao,fator,vigencia_inicio) values(indicator,new_version,factor,reference_month) returning id into resource;
   insert into public.ativacoes_regra(indicador_id,regra_id,primeiro_mes,referencia_demo) values(indicator,resource,reference_month,approval);
   event_name:='regra_demo_agendada';
  else
   if exists(select 1 from public.escopos s where s.ativo and s.tipo is not null and not exists(select 1 from jsonb_array_elements(assignments)a where (a->>'escopoId')::uuid=s.id)) or exists(select 1 from jsonb_array_elements(assignments)a where not exists(select 1 from public.escopos s where s.id=(a->>'escopoId')::uuid and s.ativo and s.tipo is not null)) or exists(select 1 from public.escopos u where u.ativo and u.tipo='unidade' and not exists(select 1 from public.escopos d where d.id=u.distrito_id and d.ativo and d.tipo='distrito')) then raise exception using errcode='22023',message='invalid_input';end if;
   select regra_id into rid from public.ativacoes_regra where indicador_id=indicator and primeiro_mes<=reference_month order by primeiro_mes desc limit 1;
   if rid is null then
    select count(*),(array_agg(r.id))[1] into rule_count,rid from public.regras r where r.indicador_id=indicator and r.vigencia_inicio<=reference_month and (r.vigencia_fim is null or r.vigencia_fim>=reference_month) and not exists(select 1 from public.ativacoes_regra a where a.regra_id=r.id);
    if rule_count<>1 then raise exception using errcode='22023',message='rule_unavailable';end if;
   end if;
   if not exists(select 1 from public.regras where id=rid and indicador_id=indicator and fator>0 and fator<=1) then raise exception using errcode='22023',message='rule_unavailable';end if;
   insert into public.competencias(codigo,referencia,estado,modelo) values('ACADEMIC-'||to_char(reference_month,'YYYY-MM'),reference_month,'aberta',2) returning id,lock_version into resource,new_version;
   insert into public.territorios_competencia(competencia_id,unidade_id,distrito_id) select resource,s.id,s.distrito_id from public.escopos s where s.ativo and s.tipo='unidade';
   insert into public.posicoes_esperadas(competencia_id,indicador_id,alvo_id,regra_id,aplicavel,informante_id,revisor_id) select resource,indicator,(a->>'escopoId')::uuid,rid,(a->>'aplicavel')::boolean,(a->>'informanteId')::uuid,(a->>'revisorId')::uuid from jsonb_array_elements(assignments)a;
   event_name:='competencia_demo_aberta';
  end if;
 end if;
 response:=jsonb_build_object('resourceId',resource,'version',new_version,'revisionId',null,'status',case p_command when 'open_demo_competence' then 'aberta' when 'schedule_demo_rule' then 'agendada' else 'reatribuida' end,'resultValue',null);
 insert into public.eventos_auditoria(actor_id,acao,recurso_tipo,recurso_id,detalhes,correlacao_id) values(auth.uid(),event_name,case p_command when 'open_demo_competence' then 'competencia' when 'schedule_demo_rule' then 'regra' else 'posicao' end,resource,jsonb_build_object('version',new_version,'reason',reason),p_operation_id);
 insert into public.operacoes_dominio(ator_id,operation_id,comando,payload,resposta) values(auth.uid(),p_operation_id,p_command,canonical,response);
 return response;
end;$$;

commit;
