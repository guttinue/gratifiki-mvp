begin;

-- Keep the exact product of a four-decimal input and the synthetic 0.8 factor.
alter table public.resultados
  alter column valor type numeric(13, 5)
  using valor::numeric(13, 5);

create or replace function private.submit_demo_entry(
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
    and e.operation_id = p_operation_id;

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
      and e.operation_id = p_operation_id;

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

revoke all on function private.submit_demo_entry(uuid, uuid, uuid, text, uuid) from public, anon, service_role;
grant execute on function private.submit_demo_entry(uuid, uuid, uuid, text, uuid) to authenticated;

create or replace function public.submit_demo_entry(
  p_competencia_id uuid,
  p_indicador_id uuid,
  p_escopo_id uuid,
  p_valor_texto text,
  p_operation_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.submit_demo_entry(
    p_competencia_id, p_indicador_id, p_escopo_id, p_valor_texto, p_operation_id
  );
$$;

revoke all on function public.submit_demo_entry(uuid, uuid, uuid, text, uuid) from public, anon, service_role;
grant execute on function public.submit_demo_entry(uuid, uuid, uuid, text, uuid) to authenticated;

commit;
