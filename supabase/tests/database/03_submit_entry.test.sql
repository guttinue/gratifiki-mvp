begin;

select plan(46);

create temporary table submit_calls (
  call_name text primary key,
  outcome jsonb not null
);
grant select, insert on pg_temp.submit_calls to authenticated;

create function pg_temp.capture_submit(
  p_competencia_id uuid,
  p_indicador_id uuid,
  p_escopo_id uuid,
  p_valor_texto text,
  p_operation_id uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_response jsonb;
  v_sqlstate text;
begin
  execute 'select public.submit_demo_entry($1, $2, $3, $4, $5)'
    into v_response
    using p_competencia_id, p_indicador_id, p_escopo_id, p_valor_texto, p_operation_id;
  return pg_catalog.jsonb_build_object('success', true, 'response', v_response);
exception when others then
  get stacked diagnostics v_sqlstate = returned_sqlstate;
  return pg_catalog.jsonb_build_object('success', false, 'sqlstate', v_sqlstate);
end;
$$;

insert into auth.users (id, email, aud, role)
values
  ('d4e00000-0000-4000-8000-000000000011', 'submit-area@example.invalid', 'authenticated', 'authenticated'),
  ('d4e00000-0000-4000-8000-000000000012', 'submit-cam@example.invalid', 'authenticated', 'authenticated'),
  ('d4e00000-0000-4000-8000-000000000013', 'submit-other-scope@example.invalid', 'authenticated', 'authenticated');

insert into public.escopos (id, codigo)
values ('d4e00000-0000-4000-8000-000000000101', 'TEST-SUBMIT-OTHER-SCOPE');

insert into public.vinculos (actor_id, papel, escopo_id)
values
  ('d4e00000-0000-4000-8000-000000000011', 'area_tecnica', 'c0de0000-0000-4000-8000-000000000003'),
  ('d4e00000-0000-4000-8000-000000000012', 'cam', 'c0de0000-0000-4000-8000-000000000003'),
  ('d4e00000-0000-4000-8000-000000000013', 'area_tecnica', 'd4e00000-0000-4000-8000-000000000101');

select ok(
  to_regprocedure('public.submit_demo_entry(uuid,uuid,uuid,text,uuid)') is not null,
  'submit_demo_entry exposes the exact expected signature'
);
select ok(
  (select not p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.submit_demo_entry(uuid,uuid,uuid,text,uuid)')),
  'public RPC is SECURITY INVOKER'
);
select ok(
  (select p.prosecdef from pg_proc p where p.oid = to_regprocedure('private.submit_demo_entry(uuid,uuid,uuid,text,uuid)')),
  'private helper is SECURITY DEFINER'
);
select ok(
  coalesce((select p.proconfig @> array['search_path=""']::text[] from pg_proc p where p.oid = to_regprocedure('private.submit_demo_entry(uuid,uuid,uuid,text,uuid)')), false),
  'private helper has an empty fixed search_path'
);
select ok(
  coalesce(not has_function_privilege('anon', to_regprocedure('public.submit_demo_entry(uuid,uuid,uuid,text,uuid)'), 'EXECUTE'), true),
  'anon cannot execute the public RPC'
);
select ok(
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.submit_demo_entry(uuid,uuid,uuid,text,uuid)'), 'EXECUTE'), false),
  'authenticated can execute the public RPC'
);
select ok(
  coalesce(not has_function_privilege('service_role', to_regprocedure('public.submit_demo_entry(uuid,uuid,uuid,text,uuid)'), 'EXECUTE'), true),
  'service_role does not receive a default execute grant on the public RPC'
);
select ok(
  coalesce(not has_function_privilege('anon', to_regprocedure('private.submit_demo_entry(uuid,uuid,uuid,text,uuid)'), 'EXECUTE'), true),
  'anon cannot execute the private helper'
);
select ok(
  coalesce(has_function_privilege('authenticated', to_regprocedure('private.submit_demo_entry(uuid,uuid,uuid,text,uuid)'), 'EXECUTE'), false),
  'authenticated can call the narrowly scoped helper through the invoker wrapper'
);
select ok(
  coalesce(not has_function_privilege('service_role', to_regprocedure('private.submit_demo_entry(uuid,uuid,uuid,text,uuid)'), 'EXECUTE'), true),
  'service_role does not receive a default execute grant on the private helper'
);

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$select public.submit_demo_entry('c0de0000-0000-4000-8000-000000000001', 'c0de0000-0000-4000-8000-000000000002', 'c0de0000-0000-4000-8000-000000000003', '10', 'd4e00000-0000-4000-8000-000000000201')$$,
  '42501', null, 'anonymous callers cannot submit'
);
reset role;

select set_config('request.jwt.claim.sub', 'd4e00000-0000-4000-8000-000000000011', true);
select set_config('request.jwt.claims', '{"sub":"d4e00000-0000-4000-8000-000000000011","role":"authenticated"}', true);
set local role authenticated;

insert into pg_temp.submit_calls values (
  'ten', pg_temp.capture_submit(
    'c0de0000-0000-4000-8000-000000000001', 'c0de0000-0000-4000-8000-000000000002',
    'c0de0000-0000-4000-8000-000000000003', '10', 'd4e00000-0000-4000-8000-000000000201'
  )
);
select is((select outcome->>'success' from pg_temp.submit_calls where call_name = 'ten'), 'true', 'area técnica can submit in its assigned scope');
select is(((select outcome->'response'->>'resultValue' from pg_temp.submit_calls where call_name = 'ten')::numeric), 8::numeric, '10 produces the exact synthetic result 8');
select is(((select outcome->'response'->>'ruleVersion' from pg_temp.submit_calls where call_name = 'ten')::integer), 1, 'response identifies the selected rule version');
select is((select outcome->'response'->>'operationId' from pg_temp.submit_calls where call_name = 'ten'), 'd4e00000-0000-4000-8000-000000000201', 'response identifies the persisted operation id');

insert into pg_temp.submit_calls values (
  'zero', pg_temp.capture_submit(
    'c0de0000-0000-4000-8000-000000000001', 'c0de0000-0000-4000-8000-000000000002',
    'c0de0000-0000-4000-8000-000000000003', '0', 'd4e00000-0000-4000-8000-000000000202'
  )
);
select is((select outcome->>'success' from pg_temp.submit_calls where call_name = 'zero'), 'true', 'zero is accepted as a numeric value');
select is(((select outcome->'response'->>'resultValue' from pg_temp.submit_calls where call_name = 'zero')::numeric), 0::numeric, 'zero produces the exact synthetic result 0');

insert into pg_temp.submit_calls values (
  'fractional', pg_temp.capture_submit(
    'c0de0000-0000-4000-8000-000000000001', 'c0de0000-0000-4000-8000-000000000002',
    'c0de0000-0000-4000-8000-000000000003', '0.0001', 'd4e00000-0000-4000-8000-00000000020a'
  )
);
select is((select outcome->>'success' from pg_temp.submit_calls where call_name = 'fractional'), 'true', 'four-decimal input remains accepted');
select is(((select outcome->'response'->>'resultValue' from pg_temp.submit_calls where call_name = 'fractional')::numeric), 0.00008::numeric, 'fractional result remains exact at five decimal places');
select is(
  (select r.valor from public.resultados r join public.entradas e on e.id = r.entrada_id where e.operation_id = 'd4e00000-0000-4000-8000-00000000020a'),
  0.00008::numeric, 'persisted result does not round the exact decimal product'
);

select is((select count(*)::integer from public.entradas where autor_id = auth.uid()), 3, 'successful calls persist three entries');
select is((select count(*)::integer from public.resultados r join public.entradas e on e.id = r.entrada_id where e.autor_id = auth.uid()), 3, 'each successful call persists a result');
select is((select count(*)::integer from public.eventos_auditoria where actor_id = auth.uid() and acao = 'demo.entry.submitted'), 3, 'each successful call persists one audit event');
select ok(
  (select memoria ?& array['input','factor','ruleVersion','competenceId','indicatorId']::text[]
   from public.resultados r join public.entradas e on e.id = r.entrada_id
   where e.operation_id = 'd4e00000-0000-4000-8000-000000000201'),
  'result memory includes input, factor, version, competence, and indicator'
);
select is(
  ((select memoria->>'input' from public.resultados r join public.entradas e on e.id = r.entrada_id where e.operation_id = 'd4e00000-0000-4000-8000-000000000201')::numeric),
  10::numeric, 'memory preserves the canonical input'
);
select is(
  ((select memoria->>'factor' from public.resultados r join public.entradas e on e.id = r.entrada_id where e.operation_id = 'd4e00000-0000-4000-8000-000000000201')::numeric),
  0.8::numeric, 'memory preserves the exact synthetic factor'
);
select is(
  ((select memoria->>'ruleVersion' from public.resultados r join public.entradas e on e.id = r.entrada_id where e.operation_id = 'd4e00000-0000-4000-8000-000000000201')::integer),
  1, 'memory preserves the selected rule version'
);
select is(
  (select memoria->>'competenceId' from public.resultados r join public.entradas e on e.id = r.entrada_id where e.operation_id = 'd4e00000-0000-4000-8000-000000000201'),
  'c0de0000-0000-4000-8000-000000000001', 'memory identifies the fixed synthetic competence'
);
select is(
  (select memoria->>'indicatorId' from public.resultados r join public.entradas e on e.id = r.entrada_id where e.operation_id = 'd4e00000-0000-4000-8000-000000000201'),
  'c0de0000-0000-4000-8000-000000000002', 'memory identifies DEMO-01'
);

insert into pg_temp.submit_calls values (
  'retry', pg_temp.capture_submit(
    'c0de0000-0000-4000-8000-000000000001', 'c0de0000-0000-4000-8000-000000000002',
    'c0de0000-0000-4000-8000-000000000003', '10.0', 'd4e00000-0000-4000-8000-000000000201'
  )
);
select is((select outcome->>'success' from pg_temp.submit_calls where call_name = 'retry'), 'true', 'same actor and operation id accepts a canonical-equivalent retry');
select is(
  (select outcome->'response'->>'entryId' from pg_temp.submit_calls where call_name = 'retry'),
  (select outcome->'response'->>'entryId' from pg_temp.submit_calls where call_name = 'ten'),
  'retry returns the original entry id'
);
select is(
  (select outcome->'response'->>'resultId' from pg_temp.submit_calls where call_name = 'retry'),
  (select outcome->'response'->>'resultId' from pg_temp.submit_calls where call_name = 'ten'),
  'retry returns the original result id'
);
select is(
  (select outcome->'response'->>'resultValue' from pg_temp.submit_calls where call_name = 'retry'),
  (select outcome->'response'->>'resultValue' from pg_temp.submit_calls where call_name = 'ten'),
  'retry returns the original exact result value'
);
select is((select count(*)::integer from public.eventos_auditoria where actor_id = auth.uid() and acao = 'demo.entry.submitted'), 3, 'same operation id does not create another audit event');

insert into pg_temp.submit_calls values (
  'changed-payload', pg_temp.capture_submit(
    'c0de0000-0000-4000-8000-000000000001', 'c0de0000-0000-4000-8000-000000000002',
    'c0de0000-0000-4000-8000-000000000003', '11', 'd4e00000-0000-4000-8000-000000000201'
  )
);
select is((select outcome->>'sqlstate' from pg_temp.submit_calls where call_name = 'changed-payload'), '22023', 'reusing an operation id with a changed payload is rejected');

insert into pg_temp.submit_calls values
  ('empty', pg_temp.capture_submit('c0de0000-0000-4000-8000-000000000001', 'c0de0000-0000-4000-8000-000000000002', 'c0de0000-0000-4000-8000-000000000003', '', 'd4e00000-0000-4000-8000-000000000203')),
  ('text', pg_temp.capture_submit('c0de0000-0000-4000-8000-000000000001', 'c0de0000-0000-4000-8000-000000000002', 'c0de0000-0000-4000-8000-000000000003', 'abc', 'd4e00000-0000-4000-8000-000000000204')),
  ('negative', pg_temp.capture_submit('c0de0000-0000-4000-8000-000000000001', 'c0de0000-0000-4000-8000-000000000002', 'c0de0000-0000-4000-8000-000000000003', '-1', 'd4e00000-0000-4000-8000-000000000205')),
  ('absence', pg_temp.capture_submit('c0de0000-0000-4000-8000-000000000001', 'c0de0000-0000-4000-8000-000000000002', 'c0de0000-0000-4000-8000-000000000003', 'ausencia', 'd4e00000-0000-4000-8000-000000000206'));
select is((select outcome->>'sqlstate' from pg_temp.submit_calls where call_name = 'empty'), '22023', 'empty input is rejected');
select is((select outcome->>'sqlstate' from pg_temp.submit_calls where call_name = 'text'), '22023', 'non-numeric text is rejected');
select is((select outcome->>'sqlstate' from pg_temp.submit_calls where call_name = 'negative'), '22023', 'negative input is rejected');
select is((select outcome->>'sqlstate' from pg_temp.submit_calls where call_name = 'absence'), '22023', 'absence is not coerced to zero');

insert into pg_temp.submit_calls values (
  'null-operation', pg_temp.capture_submit(
    'c0de0000-0000-4000-8000-000000000001', 'c0de0000-0000-4000-8000-000000000002',
    'c0de0000-0000-4000-8000-000000000003', '4', null
  )
);
select is((select outcome->>'sqlstate' from pg_temp.submit_calls where call_name = 'null-operation'), '22023', 'null operation id is rejected');

reset role;
select set_config('request.jwt.claim.sub', 'd4e00000-0000-4000-8000-000000000012', true);
select set_config('request.jwt.claims', '{"sub":"d4e00000-0000-4000-8000-000000000012","role":"authenticated"}', true);
set local role authenticated;
insert into pg_temp.submit_calls values (
  'cam', pg_temp.capture_submit(
    'c0de0000-0000-4000-8000-000000000001', 'c0de0000-0000-4000-8000-000000000002',
    'c0de0000-0000-4000-8000-000000000003', '3', 'd4e00000-0000-4000-8000-000000000207'
  )
);
select is((select outcome->>'sqlstate' from pg_temp.submit_calls where call_name = 'cam'), '42501', 'CAM cannot submit an entry');

reset role;
select set_config('request.jwt.claim.sub', 'd4e00000-0000-4000-8000-000000000011', true);
select set_config('request.jwt.claims', '{"sub":"d4e00000-0000-4000-8000-000000000011","role":"authenticated"}', true);
set local role authenticated;
insert into pg_temp.submit_calls values (
  'cross-scope', pg_temp.capture_submit(
    'c0de0000-0000-4000-8000-000000000001', 'c0de0000-0000-4000-8000-000000000002',
    'd4e00000-0000-4000-8000-000000000101', '3', 'd4e00000-0000-4000-8000-000000000208'
  )
);
select is((select outcome->>'sqlstate' from pg_temp.submit_calls where call_name = 'cross-scope'), '42501', 'area técnica cannot submit to another scope');

reset role;
select set_config('request.jwt.claim.sub', 'd4e00000-0000-4000-8000-000000000013', true);
select set_config('request.jwt.claims', '{"sub":"d4e00000-0000-4000-8000-000000000013","role":"authenticated"}', true);
set local role authenticated;
insert into pg_temp.submit_calls values (
  'other-scope-actor', pg_temp.capture_submit(
    'c0de0000-0000-4000-8000-000000000001', 'c0de0000-0000-4000-8000-000000000002',
    'c0de0000-0000-4000-8000-000000000003', '3', 'd4e00000-0000-4000-8000-000000000209'
  )
);
select is((select outcome->>'sqlstate' from pg_temp.submit_calls where call_name = 'other-scope-actor'), '42501', 'actor assigned to another scope cannot submit in the demo scope');

reset role;
select is((select count(*)::integer from public.entradas), 3, 'rejected requests leave no partial entries');
select is((select count(*)::integer from public.resultados), 3, 'rejected requests leave no partial results');
select is((select count(*)::integer from public.eventos_auditoria), 3, 'rejected requests leave no partial audit events');

select * from finish();
rollback;
