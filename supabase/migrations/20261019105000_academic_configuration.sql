begin;
-- Narrow policy exception: returns only a boolean after current legacy access.
-- No grants on the activation table and no operational metadata are exposed.
create function private.legacy_rule_visible(p_rule_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.has_pilot_link(null::text,null::uuid)
 and exists(select 1 from public.regras r where r.id=p_rule_id and not exists(select 1 from public.ativacoes_regra a where a.regra_id=r.id));
$$;
revoke all on function private.legacy_rule_visible(uuid) from public,anon,service_role;
grant execute on function private.legacy_rule_visible(uuid) to authenticated;
alter policy regras_read_for_pilot_roles on public.regras using(private.legacy_rule_visible(id));
-- An explicit claim pointer avoids guessing ownership from tied timestamps.
alter table public.entradas add column claim_revisao_atual_id uuid references public.decisoes_entrada(id);
update public.entradas e set claim_revisao_atual_id=x.claim_id
from (select e0.id,(array_agg(d.id))[1] claim_id
 from public.entradas e0 join public.posicoes_esperadas p on p.id=e0.posicao_id
 join public.revisoes_entrada r on r.id=e0.revisao_atual_id
 join public.decisoes_entrada d on d.revisao_id=r.id and d.tipo='iniciar_revisao'
 where e0.estado='em_revisao' group by e0.id,p.revisor_id,r.autor_id
 having count(*)=1 and bool_and(d.ator_id=p.revisor_id and d.ator_id<>r.autor_id))x
where e.id=x.id;
create function private.guard_current_claim() returns trigger language plpgsql set search_path='' as $$
begin
 if new.revisao_atual_id is distinct from old.revisao_atual_id then new.claim_revisao_atual_id:=null;end if;
 if new.claim_revisao_atual_id is not null and not exists(select 1 from public.decisoes_entrada d join public.revisoes_entrada r on r.id=d.revisao_id where d.id=new.claim_revisao_atual_id and d.tipo='iniciar_revisao' and d.revisao_id=new.revisao_atual_id and r.entrada_id=new.id and d.ator_id<>r.autor_id) then raise exception using errcode='55000',message='invalid_review_claim';end if;
 return new;
end;$$;
create trigger current_claim_guard before update on public.entradas for each row execute function private.guard_current_claim();

-- This is assignment metadata only, never a back door to operational payloads.
create function public.get_demo_configuration(p_contexto jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ctx jsonb;
begin
 ctx:=private.require_academic_context(p_contexto,'admin_catalog');
 return jsonb_build_object(
 'competences',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'codigo',c.codigo,'reference',c.referencia,'state',c.estado,'version',c.lock_version) order by c.referencia,c.id),'[]'::jsonb) from public.competencias c where c.modelo=2 and exists(select 1 from public.posicoes_esperadas p where p.competencia_id=c.id and p.indicador_id=(ctx->>'indicadorId')::uuid)),
 'positions',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'competenceId',p.competencia_id,'escopoId',p.alvo_id,'informanteId',p.informante_id,'revisorId',p.revisor_id,'aplicavel',p.aplicavel,'version',p.lock_version) order by p.competencia_id,p.alvo_id,p.id),'[]'::jsonb) from public.posicoes_esperadas p join public.competencias c on c.id=p.competencia_id and c.modelo=2 where p.indicador_id=(ctx->>'indicadorId')::uuid),
 'rules',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'version',r.versao,'factor',trim_scale(r.fator)::text,'startMonth',a.primeiro_mes,'reference',a.referencia_demo) order by r.versao,r.id),'[]'::jsonb) from public.regras r left join public.ativacoes_regra a on a.regra_id=r.id where r.indicador_id=(ctx->>'indicadorId')::uuid and (a.id is not null or exists(select 1 from public.posicoes_esperadas p where p.regra_id=r.id))));
end;$$;

create function private.require_demo_assignment(p_scope uuid,p_informant uuid,p_reviewer uuid,p_indicator uuid) returns void
language plpgsql set search_path='' as $$
begin
 if p_informant=auth.uid() or p_reviewer=auth.uid() then raise exception using errcode='42501',message='access_denied';end if;
 if p_informant is null or p_reviewer is null or p_informant=p_reviewer then raise exception using errcode='22023',message='invalid_input';end if;
 if not exists(select 1 from public.contas_demo where ator_id=p_informant and ativo) or not exists(select 1 from public.contas_demo where ator_id=p_reviewer and ativo) then raise exception using errcode='42501',message='access_denied';end if;
 if not exists(select 1 from public.vinculos where actor_id=p_informant and papel='area_tecnica' and escopo_id=p_scope and indicador_id=p_indicator and ativo and vigencia_inicio<=current_date and (vigencia_fim is null or vigencia_fim>=current_date)) or not exists(select 1 from public.vinculos where actor_id=p_reviewer and papel='revisor_tecnico' and escopo_id=p_scope and indicador_id=p_indicator and ativo and vigencia_inicio<=current_date and (vigencia_fim is null or vigencia_fim>=current_date)) then raise exception using errcode='22023',message='invalid_input';end if;
end;$$;

create function private.configure_academic_cycle(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctx jsonb;canonical jsonb;response jsonb;old_op public.operacoes_dominio%rowtype;
 c public.competencias%rowtype;p public.posicoes_esperadas%rowtype;e public.entradas%rowtype;
 indicator uuid;sid uuid;informant uuid;reviewer uuid;rid uuid;resource uuid;reference_month date;factor numeric;factor_text text;approval text;reason text;expected integer;new_version integer;event_name text;item jsonb;assignments jsonb;rule_count integer;
begin
 ctx:=private.require_academic_context(p_contexto,'admin_write');indicator:=(ctx->>'indicadorId')::uuid;
 if p_command not in ('open_demo_competence','reassign_demo_position','schedule_demo_rule') then raise exception using errcode='42501',message='access_denied';end if;
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

create function public.open_demo_competence(p_contexto jsonb,p_reference date,p_assignments jsonb,p_operation_id uuid) returns jsonb language sql security definer set search_path='' as $$select private.run_academic_command(p_contexto,'open_demo_competence',jsonb_build_object('month',p_reference,'assignments',p_assignments),p_operation_id);$$;
create function public.reassign_demo_position(p_contexto jsonb,p_position_id uuid,p_expected_version integer,p_input jsonb,p_reason text,p_operation_id uuid) returns jsonb language sql security definer set search_path='' as $$select private.run_academic_command(p_contexto,'reassign_demo_position',jsonb_build_object('positionId',p_position_id,'expectedVersion',p_expected_version,'input',p_input,'reason',p_reason),p_operation_id);$$;
create function public.schedule_demo_rule(p_contexto jsonb,p_factor text,p_start_month date,p_reference text,p_operation_id uuid) returns jsonb language sql security definer set search_path='' as $$select private.run_academic_command(p_contexto,'schedule_demo_rule',jsonb_build_object('month',p_start_month,'factor',p_factor,'reference',p_reference),p_operation_id);$$;
revoke all on function private.guard_current_claim(),private.require_demo_assignment(uuid,uuid,uuid,uuid),private.configure_academic_cycle(jsonb,text,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_demo_configuration(jsonb),public.open_demo_competence(jsonb,date,jsonb,uuid),public.reassign_demo_position(jsonb,uuid,integer,jsonb,text,uuid),public.schedule_demo_rule(jsonb,text,date,text,uuid) from public,anon,service_role;
grant execute on function public.get_demo_configuration(jsonb),public.open_demo_competence(jsonb,date,jsonb,uuid),public.reassign_demo_position(jsonb,uuid,integer,jsonb,text,uuid),public.schedule_demo_rule(jsonb,text,date,text,uuid) to authenticated;
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

create or replace function private.review_academic_position(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_context jsonb; v_capability text; v_id uuid; v_expected integer;
 v_competence public.competencias%rowtype; v_position public.posicoes_esperadas%rowtype;
 v_entry public.entradas%rowtype; v_revision public.revisoes_entrada%rowtype;
 v_claim public.decisoes_entrada%rowtype; v_existing public.operacoes_dominio%rowtype;
 v_canonical jsonb; v_response jsonb; v_reason text; v_decision text;
 v_type text; v_status text; v_result numeric(18,10); v_new_claim uuid;
begin
 if p_command='start_review' then v_capability:='start_review';
 elsif p_command='review' then v_capability:='review';
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
 perform pg_advisory_xact_lock(hashtextextended((auth.uid())::text||':'||p_operation_id::text,0));
 v_context:=private.require_academic_context(p_contexto,v_capability);
 if not(v_context->'positionIds' ? v_id::text) or v_position.revisor_id<>auth.uid() or v_revision.autor_id=auth.uid() then
  raise exception using errcode='42501',message='access_denied';
 end if;
 if p_command='start_review' then
  if (select count(*) from jsonb_object_keys(p_payload))<>2 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('positionId','expectedVersion')) then raise exception using errcode='22023',message='invalid_input'; end if;
  v_reason:='';v_type:='iniciar_revisao';v_status:='em_revisao';
  v_canonical:=jsonb_build_object('context',p_contexto,'positionId',v_id,'expectedVersion',v_expected);
 else
  if (select count(*) from jsonb_object_keys(p_payload))<>4 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('positionId','expectedVersion','decision','reason')) or
   jsonb_typeof(p_payload->'decision') is distinct from 'string' or jsonb_typeof(p_payload->'reason') is distinct from 'string' then raise exception using errcode='22023',message='invalid_input'; end if;
  -- ECMAScript String.trim WhiteSpace + LineTerminator code points, explicitly
  -- independent of database locale. Trim edges only; preserve interior text.
  v_decision:=p_payload->>'decision';
  v_reason:=btrim(p_payload->>'reason',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if v_decision not in ('accept','return') or length(v_reason)>1000 or (v_decision='return' and v_reason='') then raise exception using errcode='22023',message='invalid_input'; end if;
  v_type:=case v_decision when 'accept' then 'validar' else 'devolver' end;
  v_status:=case v_decision when 'accept' then 'validada' else 'devolvida' end;
  v_canonical:=jsonb_build_object('context',p_contexto,'positionId',v_id,'expectedVersion',v_expected,'decision',v_decision,'reason',v_reason);
 end if;
 select * into v_existing from public.operacoes_dominio where ator_id=auth.uid() and operation_id=p_operation_id;
 if v_existing.id is not null then
  if v_existing.comando<>p_command or v_existing.payload<>v_canonical then raise exception using errcode='22023',message='operation_payload_mismatch'; end if;
  return v_existing.resposta;
 end if;
 if v_position.lock_version<>v_expected then raise exception using errcode='40001',message='version_conflict'; end if;
 if v_competence.estado not in ('aberta','em_consolidacao') or not v_position.aplicavel or v_entry.id is null or v_revision.id is null or v_revision.enviada_em is null then raise exception using errcode='55000',message='invalid_state'; end if;
 if p_command='start_review' then
  if v_entry.estado<>'enviada' then raise exception using errcode='55000',message='invalid_state'; end if;
 else
  if v_entry.estado<>'em_revisao' then raise exception using errcode='55000',message='invalid_state'; end if;
  -- A claim belongs to its immutable revision AND original actor. A later
  -- assignment never rewrites that history or transfers an existing claim.
  select * into v_claim from public.decisoes_entrada where id=v_entry.claim_revisao_atual_id and revisao_id=v_revision.id and tipo='iniciar_revisao';
  if v_claim.id is null then raise exception using errcode='55000',message='invalid_state'; end if;
  if v_claim.ator_id<>auth.uid() then raise exception using errcode='42501',message='access_denied'; end if;
 end if;
 -- Technical acceptance checks evidence, not the CAM's unavailability decision.
 -- In particular, it never creates a number or changes the submitted payload.
 select valor into v_result from public.resultados where revisao_id=v_revision.id;
 insert into public.decisoes_entrada(revisao_id,ator_id,tipo,motivo,ocorrido_em) values(v_revision.id,auth.uid(),v_type,v_reason,clock_timestamp()) returning id into v_new_claim;
 update public.entradas set estado=v_status,claim_revisao_atual_id=case when p_command='start_review' then v_new_claim else claim_revisao_atual_id end,lock_version=lock_version+1 where id=v_entry.id;
 update public.posicoes_esperadas set lock_version=lock_version+1 where id=v_id returning * into v_position;
 update public.competencias set lock_version=lock_version+1 where id=v_competence.id;
 v_response:=jsonb_build_object('resourceId',v_id,'version',v_position.lock_version,'revisionId',v_revision.id,'status',v_status,'resultValue',trim_scale(v_result)::text);
 insert into public.eventos_auditoria(actor_id,acao,recurso_tipo,recurso_id,detalhes,correlacao_id)
  values(auth.uid(),'posicao_'||v_status,'posicao',v_id,jsonb_build_object('version',v_position.lock_version,'revisionId',v_revision.id,'estadoDado',v_revision.estado_dado,'reason',v_reason),p_operation_id);
 insert into public.operacoes_dominio(ator_id,operation_id,comando,payload,resposta) values(auth.uid(),p_operation_id,p_command,v_canonical,v_response);
 return v_response;
end;
$$;

create or replace function private.submit_legacy_entry_internal(
  p_competencia_id uuid,
  p_indicador_id uuid,
  p_escopo_id uuid,
  p_valor_texto text,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_input numeric(12, 4);
  v_competence_reference date;
  v_competence_state text;
  v_rule_id uuid;
  v_rule_version integer;
  v_rule_version_text text;
  v_factor numeric(12, 6);
  v_result_value numeric(13, 5);
  v_result_id uuid;
  v_entry_id uuid;
  v_existing public.entradas%rowtype;
  v_result_memory jsonb;
  v_memory jsonb;
begin
  v_actor_id := auth.uid();
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'submit_demo_entry_requires_authentication';
  end if;

  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operation_id_required';
  end if;

  if p_escopo_id is null or not exists (
    select 1
    from public.vinculos as v
    where v.actor_id = v_actor_id
      and v.papel = 'area_tecnica'
      and v.escopo_id = p_escopo_id
  ) then
    raise exception using errcode = '42501', message = 'submit_demo_entry_scope_denied';
  end if;

  if p_competencia_id is null or p_indicador_id is null then
    raise exception using errcode = '22023', message = 'demo_context_required';
  end if;

  if p_valor_texto is null
    or pg_catalog.btrim(p_valor_texto) = ''
    or pg_catalog.btrim(p_valor_texto) !~ '^[0-9]+([.][0-9]{1,4})?$'
  then
    raise exception using errcode = '22023', message = 'invalid_demo_value';
  end if;

  begin
    v_input := pg_catalog.btrim(p_valor_texto)::numeric(12, 4);
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'invalid_demo_value';
  end;

  -- The stored columns form the canonical payload: UUIDs plus the parsed exact decimal.
  select e.*
  into v_existing
  from public.entradas as e
  where e.autor_id = v_actor_id
    and e.operation_id = p_operation_id
    and e.posicao_id is null;

  if found then
    if v_existing.competencia_id is distinct from p_competencia_id
      or v_existing.indicador_id is distinct from p_indicador_id
      or v_existing.escopo_id is distinct from p_escopo_id
      or v_existing.valor is distinct from v_input
    then
      raise exception using errcode = '22023', message = 'operation_id_payload_mismatch';
    end if;

    select r.id, r.valor, r.memoria
    into v_result_id, v_result_value, v_result_memory
    from public.resultados as r
    where r.entrada_id = v_existing.id;

    if not found then
      raise exception using errcode = '55000', message = 'operation_result_missing';
    end if;

    v_rule_version_text := v_result_memory->>'ruleVersion';
    if v_rule_version_text is null
      or pg_catalog.jsonb_typeof(v_result_memory->'ruleVersion') <> 'number'
      or v_rule_version_text !~ '^[1-9][0-9]*$'
    then
      raise exception using errcode = '55000', message = 'operation_result_memory_invalid';
    end if;

    begin
      v_rule_version := v_rule_version_text::integer;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception using errcode = '55000', message = 'operation_result_memory_invalid';
    end;

    return pg_catalog.jsonb_build_object(
      'entryId', v_existing.id::text,
      'resultId', v_result_id::text,
      'resultValue', v_result_value::text,
      'ruleVersion', v_rule_version,
      'operationId', p_operation_id::text
    );
  end if;

  select c.referencia, c.estado
  into v_competence_reference, v_competence_state
  from public.competencias as c
  join public.indicadores as i on i.id = p_indicador_id
  join public.escopos as s on s.id = p_escopo_id
  where c.id = p_competencia_id
    and c.codigo = 'DEMO-2026-09'
    and i.codigo = 'DEMO-01'
    and s.codigo = 'DEMO-ESCOPO-01';

  if not found then
    raise exception using errcode = '22023', message = 'unsupported_demo_context';
  end if;

  if v_competence_state <> 'aberta' then
    raise exception using errcode = '55000', message = 'demo_competence_not_open';
  end if;

  begin
    select rule.id, rule.versao, rule.fator
    into strict v_rule_id, v_rule_version, v_factor
    from public.regras as rule
    where rule.indicador_id = p_indicador_id
      and not exists(select 1 from public.ativacoes_regra a where a.regra_id=rule.id)
      and v_competence_reference >= rule.vigencia_inicio
      and (rule.vigencia_fim is null or v_competence_reference <= rule.vigencia_fim);
  exception
    when no_data_found or too_many_rows then
      raise exception using errcode = '22023', message = 'demo_rule_not_unique_for_competence';
  end;

  v_result_value := v_input * v_factor;
  v_memory := pg_catalog.jsonb_build_object(
    'input', v_input,
    'factor', v_factor,
    'ruleVersion', v_rule_version,
    'competenceId', p_competencia_id::text,
    'indicatorId', p_indicador_id::text
  );

  insert into public.entradas (
    competencia_id, indicador_id, escopo_id, autor_id, valor, estado, revisao, operation_id
  ) values (
    p_competencia_id, p_indicador_id, p_escopo_id, v_actor_id, v_input, 'pendente', 1, p_operation_id
  )
  on conflict on constraint uq_entradas_autor_operation do nothing
  returning id into v_entry_id;

  if v_entry_id is null then
    -- A concurrent request won the unique-key insert. Read its committed result and
    -- return it only when the persisted canonical payload matches this request.
    select e.*
    into v_existing
    from public.entradas as e
    where e.autor_id = v_actor_id
      and e.operation_id = p_operation_id
    and e.posicao_id is null;

    if not found then
      raise exception using errcode = '40001', message = 'operation_retry_required';
    end if;

    if v_existing.competencia_id is distinct from p_competencia_id
      or v_existing.indicador_id is distinct from p_indicador_id
      or v_existing.escopo_id is distinct from p_escopo_id
      or v_existing.valor is distinct from v_input
    then
      raise exception using errcode = '22023', message = 'operation_id_payload_mismatch';
    end if;

    select r.id, r.valor, r.memoria
    into v_result_id, v_result_value, v_result_memory
    from public.resultados as r
    where r.entrada_id = v_existing.id;

    if not found then
      raise exception using errcode = '55000', message = 'operation_result_missing';
    end if;

    v_rule_version_text := v_result_memory->>'ruleVersion';
    if v_rule_version_text is null
      or pg_catalog.jsonb_typeof(v_result_memory->'ruleVersion') <> 'number'
      or v_rule_version_text !~ '^[1-9][0-9]*$'
    then
      raise exception using errcode = '55000', message = 'operation_result_memory_invalid';
    end if;

    begin
      v_rule_version := v_rule_version_text::integer;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception using errcode = '55000', message = 'operation_result_memory_invalid';
    end;

    return pg_catalog.jsonb_build_object(
      'entryId', v_existing.id::text,
      'resultId', v_result_id::text,
      'resultValue', v_result_value::text,
      'ruleVersion', v_rule_version,
      'operationId', p_operation_id::text
    );
  end if;

  insert into public.resultados (entrada_id, regra_id, valor, memoria)
  values (v_entry_id, v_rule_id, v_result_value, v_memory)
  returning id, valor into v_result_id, v_result_value;

  insert into public.eventos_auditoria (
    recurso_tipo, recurso_id, actor_id, acao, detalhes
  ) values (
    'entrada',
    v_entry_id,
    v_actor_id,
    'demo.entry.submitted',
    pg_catalog.jsonb_build_object(
      'operation_id', p_operation_id::text,
      'result_id', v_result_id::text,
      'rule_version', v_rule_version
    )
  );

  return pg_catalog.jsonb_build_object(
    'entryId', v_entry_id::text,
    'resultId', v_result_id::text,
    'resultValue', v_result_value::text,
    'ruleVersion', v_rule_version,
    'operationId', p_operation_id::text
  );
end;
$$;

create or replace function private.authorized_context_rows()
returns table(vinculo_id uuid,actor_id uuid,papel text,competencia_id uuid,indicador_id uuid,
 escopo_id uuid,escopo_codigo text,competencia_codigo text,mode text)
language sql stable security definer set search_path='' as $$
 select v.id,v.actor_id,v.papel,c.id,i.id,s.id,s.codigo,c.codigo,
  case when c.modelo=1 then 'legacy' else 'academic' end
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
   (c.modelo=2 and v.indicador_id=i.id and v.vigencia_inicio is not null
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

create or replace function private.run_academic_command(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_command in ('save_draft','submit') then return private.run_academic_submission(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command in ('start_review','review') then return private.review_academic_position(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command in ('correct','authorize_correction','decide_unavailability') then return private.correct_academic_position(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command in ('transition_cycle','publish_cycle_demo') then return private.transition_academic_cycle(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command='get_snapshot_export' then return private.export_academic_snapshot(p_contexto,p_payload,p_operation_id);
 elsif p_command in ('save_demo_scope','set_demo_business_link') then return private.administer_academic_metadata(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command in ('open_demo_competence','reassign_demo_position','schedule_demo_rule') then return private.configure_academic_cycle(p_contexto,p_command,p_payload,p_operation_id);
 else raise exception using errcode='42501',message='access_denied';end if;
end;$$;
commit;
