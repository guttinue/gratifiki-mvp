begin;

-- Server-side capability vocabulary; no client-selected role or scope is trusted.
create function private.academic_capability_allowed(p_role text,p_capability text)
returns boolean language sql immutable set search_path='' as $$
 select case p_capability
  when 'context' then p_role in ('area_tecnica','revisor_tecnico','cam','gestor_unidade','gestor_distrital','administrador','lideranca')
  when 'operational_read' then p_role in ('area_tecnica','revisor_tecnico','cam')
  when 'dashboard' then p_role in ('area_tecnica','revisor_tecnico','cam')
  when 'operational_audit' then p_role in ('area_tecnica','revisor_tecnico','cam')
  when 'draft' then p_role='area_tecnica'
  when 'submit' then p_role='area_tecnica'
  when 'correct' then p_role='area_tecnica'
  when 'start_review' then p_role='revisor_tecnico'
  when 'review' then p_role='revisor_tecnico'
  when 'authorize_correction' then p_role='cam'
  when 'decide_unavailability' then p_role='cam'
  when 'cycle_read' then p_role='cam'
  when 'cycle_transition' then p_role='cam'
  when 'cycle_publish' then p_role='cam'
  when 'export' then p_role='cam'
  when 'evaluations' then p_role in ('gestor_unidade','gestor_distrital')
  when 'evaluation_history' then p_role in ('gestor_unidade','gestor_distrital')
  when 'leadership_aggregates' then p_role='lideranca'
  when 'aggregate_dashboard' then p_role='lideranca'
  when 'admin_catalog' then p_role='administrador'
  when 'admin_write' then p_role='administrador'
  when 'admin_audit' then p_role='administrador'
  else false end;
$$;

-- Shared source for discovery and command guards. No read model returns these
-- internal rows directly; public discovery exposes only AuthorizedContext.
create function private.authorized_context_rows()
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
    and exists(select 1 from public.regras r where r.indicador_id=i.id and c.referencia>=r.vigencia_inicio
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

create function public.get_authorized_contexts() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('contexts',coalesce(jsonb_agg(jsonb_build_object(
  'key',r.vinculo_id::text||':'||r.competencia_id::text||':'||r.indicador_id::text,
  'actorId',r.actor_id,'role',r.papel,'vinculoId',r.vinculo_id,'competenciaId',r.competencia_id,
  'indicadorId',r.indicador_id,'escopoId',r.escopo_id,'escopoCodigo',r.escopo_codigo,
  'competenciaCodigo',r.competencia_codigo,'mode',r.mode)
  order by r.competencia_codigo,r.papel,r.escopo_codigo,r.vinculo_id,r.indicador_id),'[]'::jsonb))
 from private.authorized_context_rows() r;
$$;

create function private.require_academic_context(p_contexto jsonb,p_capability text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 v_link uuid; v_competence uuid; v_indicator uuid; v_context record;
 v_scope_ids jsonb; v_position_ids jsonb;
begin
 if auth.uid() is null or jsonb_typeof(p_contexto) is distinct from 'object'
  or not (p_contexto ?& array['vinculoId','competenciaId','indicadorId'])
  or (select count(*) from jsonb_object_keys(p_contexto))<>3 then
  raise exception using errcode='42501',message='access_denied';
 end if;
 begin
  v_link:=(p_contexto->>'vinculoId')::uuid;
  v_competence:=(p_contexto->>'competenciaId')::uuid;
  v_indicator:=(p_contexto->>'indicadorId')::uuid;
 exception when invalid_text_representation then
  raise exception using errcode='42501',message='access_denied';
 end;
 select r.* into v_context from private.authorized_context_rows() r
 where r.vinculo_id=v_link and r.competencia_id=v_competence and r.indicador_id=v_indicator and r.mode='academic';
 if not found or not private.academic_capability_allowed(v_context.papel,p_capability) then
  raise exception using errcode='42501',message='access_denied';
 end if;

 select coalesce(jsonb_agg(distinct p.alvo_id),'[]'::jsonb),coalesce(jsonb_agg(p.id order by p.id),'[]'::jsonb)
 into v_scope_ids,v_position_ids from public.posicoes_esperadas p
 join public.escopos s on s.id=p.alvo_id
 where p.competencia_id=v_competence and p.indicador_id=v_indicator
  and (
   (v_context.papel='area_tecnica' and p.alvo_id=v_context.escopo_id and p.informante_id=auth.uid())
   or (v_context.papel='revisor_tecnico' and p.alvo_id=v_context.escopo_id and p.revisor_id=auth.uid() and p.informante_id<>auth.uid())
   or (v_context.papel='cam' and (
    p.alvo_id=v_context.escopo_id or (p_capability in ('cycle_read','cycle_transition','cycle_publish','export') and exists(
     select 1 from private.authorized_context_rows() r where r.mode='academic' and r.papel='cam'
      and r.competencia_id=v_competence and r.indicador_id=v_indicator and r.escopo_id=p.alvo_id))))
   or (v_context.papel='gestor_unidade' and p.alvo_id=v_context.escopo_id)
   or (v_context.papel='gestor_distrital' and (p.alvo_id=v_context.escopo_id or (s.tipo='unidade' and exists(
    select 1 from public.territorios_competencia t where t.competencia_id=v_competence
     and t.distrito_id=v_context.escopo_id and t.unidade_id=p.alvo_id))))
   or (v_context.papel='lideranca' and s.tipo='unidade' and exists(select 1 from public.territorios_competencia t
    where t.competencia_id=v_competence and t.distrito_id=v_context.escopo_id and t.unidade_id=p.alvo_id))
  );
 return jsonb_build_object('actorId',auth.uid(),'role',v_context.papel,'vinculoId',v_link,
  'competenciaId',v_competence,'indicadorId',v_indicator,'escopoId',v_context.escopo_id,
  'scopeIds',v_scope_ids,'positionIds',v_position_ids);
end;
$$;

revoke all on function private.academic_capability_allowed(text,text),private.authorized_context_rows(),
 private.require_academic_context(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.get_authorized_contexts() from public,service_role;
grant execute on function public.get_authorized_contexts() to anon,authenticated;

-- Legacy access stays live-authorized and disjoint from academic payloads.
create or replace function private.has_pilot_link(p_papel text,p_escopo_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.vinculos v join public.escopos s on s.id=v.escopo_id
  where v.actor_id=auth.uid() and v.indicador_id is null and v.ativo
  and v.papel in ('area_tecnica','cam') and (v.vigencia_inicio is null or v.vigencia_inicio<=current_date)
  and (v.vigencia_fim is null or v.vigencia_fim>=current_date)
  and (p_papel is null or v.papel=p_papel) and (p_escopo_id is null or v.escopo_id=p_escopo_id));
$$;
alter policy vinculos_read_own_allowed_roles on public.vinculos using(indicador_id is null and actor_id=auth.uid()
 and ativo and papel in ('area_tecnica','cam') and (vigencia_inicio is null or vigencia_inicio<=current_date)
 and (vigencia_fim is null or vigencia_fim>=current_date) and private.has_pilot_link(papel,escopo_id));

create or replace function private.submit_demo_entry(p_competencia_id uuid,p_indicador_id uuid,p_escopo_id uuid,p_valor_texto text,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.has_pilot_link('area_tecnica',p_escopo_id) then
  raise exception using errcode='42501',message='submit_demo_entry_scope_denied';
 end if;
 if not exists(select 1 from public.competencias where id=p_competencia_id and modelo=1)
  or exists(select 1 from public.entradas where autor_id=auth.uid() and operation_id=p_operation_id and posicao_id is not null) then
  raise exception using errcode='22023',message='unsupported_demo_context';
 end if;
 return private.submit_legacy_entry_internal(p_competencia_id,p_indicador_id,p_escopo_id,p_valor_texto,p_operation_id);
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


commit;
