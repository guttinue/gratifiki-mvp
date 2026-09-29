begin;

select plan(24);

insert into auth.users (id, email, aud, role)
values
  ('d3e00000-0000-4000-8000-000000000011', 'access-area@example.invalid', 'authenticated', 'authenticated'),
  ('d3e00000-0000-4000-8000-000000000012', 'access-cam@example.invalid', 'authenticated', 'authenticated'),
  ('d3e00000-0000-4000-8000-000000000013', 'access-other-scope@example.invalid', 'authenticated', 'authenticated'),
  ('d3e00000-0000-4000-8000-000000000014', 'access-unlinked@example.invalid', 'authenticated', 'authenticated');

insert into public.escopos (id, codigo)
values ('d3e00000-0000-4000-8000-000000000101', 'TEST-OTHER-SCOPE');

insert into public.vinculos (actor_id, papel, escopo_id)
select 'd3e00000-0000-4000-8000-000000000011', 'area_tecnica', id
from public.escopos where codigo = 'DEMO-ESCOPO-01';
insert into public.vinculos (actor_id, papel, escopo_id)
select 'd3e00000-0000-4000-8000-000000000012', 'cam', id
from public.escopos where codigo = 'DEMO-ESCOPO-01';
insert into public.vinculos (actor_id, papel, escopo_id)
values ('d3e00000-0000-4000-8000-000000000013', 'area_tecnica', 'd3e00000-0000-4000-8000-000000000101');

insert into public.entradas (
  id, competencia_id, indicador_id, escopo_id, autor_id, valor, estado, revisao, operation_id
)
select
  'd3e00000-0000-4000-8000-000000000201', c.id, i.id, s.id,
  'd3e00000-0000-4000-8000-000000000011', 10, 'pendente', 1,
  'd3e00000-0000-4000-8000-000000000301'
from public.competencias c
join public.indicadores i on i.codigo = 'DEMO-01'
join public.escopos s on s.codigo = 'DEMO-ESCOPO-01'
where c.codigo = 'DEMO-2026-09';

insert into public.entradas (
  id, competencia_id, indicador_id, escopo_id, autor_id, valor, estado, revisao, operation_id
)
select
  'd3e00000-0000-4000-8000-000000000202', c.id, i.id, s.id,
  'd3e00000-0000-4000-8000-000000000013', 12, 'pendente', 1,
  'd3e00000-0000-4000-8000-000000000302'
from public.competencias c
join public.indicadores i on i.codigo = 'DEMO-01'
join public.escopos s on s.id = 'd3e00000-0000-4000-8000-000000000101'
where c.codigo = 'DEMO-2026-09';

insert into public.resultados (id, entrada_id, regra_id, valor, memoria)
select
  'd3e00000-0000-4000-8000-000000000401', e.id, r.id, 8,
  '{"tipo":"fixture de autorização"}'::jsonb
from public.entradas e
join public.regras r on r.versao = 1
join public.indicadores i on i.id = r.indicador_id and i.codigo = 'DEMO-01'
where e.id = 'd3e00000-0000-4000-8000-000000000201';

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is((select count(*)::integer from public.entradas), 0, 'anonymous claims see no protected entries');
select is((select count(*)::integer from public.vinculos), 0, 'anonymous claims see no role links');
reset role;

select set_config('request.jwt.claim.sub', 'd3e00000-0000-4000-8000-000000000011', true);
select set_config('request.jwt.claims', '{"sub":"d3e00000-0000-4000-8000-000000000011","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::integer from public.entradas), 1, 'area tecnica sees its assigned scope entry');
select is((select count(*)::integer from public.entradas where escopo_id = 'd3e00000-0000-4000-8000-000000000101'), 0, 'area tecnica cannot see another scope entry');
select is((select count(*)::integer from public.escopos), 1, 'area tecnica sees only its assigned scope');
select is((select count(*)::integer from public.vinculos where papel = 'area_tecnica'), 1, 'area tecnica can read its own server-side role link');
reset role;

select set_config('request.jwt.claim.sub', 'd3e00000-0000-4000-8000-000000000012', true);
select set_config('request.jwt.claims', '{"sub":"d3e00000-0000-4000-8000-000000000012","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::integer from public.entradas), 1, 'CAM can review entries in its assigned scope');
select is((select count(*)::integer from public.resultados), 1, 'CAM can read result memory in its assigned scope');
select is((select count(*)::integer from public.vinculos where papel = 'cam'), 1, 'CAM can read its own server-side role link');
reset role;

select set_config('request.jwt.claim.sub', 'd3e00000-0000-4000-8000-000000000014', true);
select set_config('request.jwt.claims', '{"sub":"d3e00000-0000-4000-8000-000000000014","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::integer from public.entradas), 0, 'an authenticated actor without a server-side link sees no entries');
select is((select count(*)::integer from public.vinculos), 0, 'an authenticated actor without a server-side link sees no role links');
select set_config('request.jwt.claims', '{"sub":"d3e00000-0000-4000-8000-000000000014","role":"authenticated","user_metadata":{"papel":"area_tecnica","escopo_id":"d3e00000-0000-4000-8000-000000000101"}}', true);
select is((select count(*)::integer from public.entradas), 0, 'user-editable role and scope metadata grants no access');

select throws_ok(
  $$insert into public.entradas (competencia_id, indicador_id, escopo_id, autor_id, valor, estado, revisao, operation_id)
    select competencia_id, indicador_id, escopo_id, auth.uid(), 1, 'pendente', 1, 'd3e00000-0000-4000-8000-000000000311'
    from public.entradas where id = 'd3e00000-0000-4000-8000-000000000201'$$,
  '42501', null, 'authenticated cannot insert entries directly'
);
select throws_ok($$update public.entradas set valor = 11 where id = 'd3e00000-0000-4000-8000-000000000201'$$, '42501', null, 'authenticated cannot update entries directly');
select throws_ok($$delete from public.entradas where id = 'd3e00000-0000-4000-8000-000000000201'$$, '42501', null, 'authenticated cannot delete entries directly');
select throws_ok(
  $$insert into public.resultados (entrada_id, regra_id, valor, memoria)
    select e.id, r.id, 1, '{}'::jsonb from public.entradas e cross join public.regras r
    where e.id = 'd3e00000-0000-4000-8000-000000000201' and r.versao = 1$$,
  '42501', null, 'authenticated cannot insert results directly'
);
select throws_ok($$update public.resultados set valor = 1 where id = 'd3e00000-0000-4000-8000-000000000401'$$, '42501', null, 'authenticated cannot update results directly');
select throws_ok($$delete from public.resultados where id = 'd3e00000-0000-4000-8000-000000000401'$$, '42501', null, 'authenticated cannot delete results directly');
select throws_ok(
  $$insert into public.eventos_auditoria (recurso_tipo, recurso_id, actor_id, acao)
    values ('entrada', 'd3e00000-0000-4000-8000-000000000201', auth.uid(), 'direct-write-test')$$,
  '42501', null, 'authenticated cannot insert audit events directly'
);
select throws_ok($$update public.eventos_auditoria set acao = 'tampered' where recurso_id = 'd3e00000-0000-4000-8000-000000000201'$$, '42501', null, 'authenticated cannot update audit events directly');
select throws_ok($$delete from public.eventos_auditoria where recurso_id = 'd3e00000-0000-4000-8000-000000000201'$$, '42501', null, 'authenticated cannot delete audit events directly');
reset role;

select ok(
  not exists (
    select 1
    from unnest(array[
      to_regclass('public.competencias'), to_regclass('public.indicadores'),
      to_regclass('public.escopos'), to_regclass('public.vinculos'),
      to_regclass('public.regras'), to_regclass('public.entradas'),
      to_regclass('public.resultados'), to_regclass('public.eventos_auditoria')
    ]) as protected(table_oid)
    where protected.table_oid is not null
      and not (select relrowsecurity from pg_class where oid = protected.table_oid)
  ),
  'row-level security is enabled for every exposed domain table'
);
select ok(
  not exists (
    select 1
    from unnest(array[
      to_regclass('public.competencias'), to_regclass('public.indicadores'),
      to_regclass('public.escopos'), to_regclass('public.vinculos'),
      to_regclass('public.regras'), to_regclass('public.entradas'),
      to_regclass('public.resultados'), to_regclass('public.eventos_auditoria')
    ]) as protected(table_oid)
    where protected.table_oid is not null and (
      has_table_privilege('authenticated', protected.table_oid, 'INSERT')
      or has_table_privilege('authenticated', protected.table_oid, 'UPDATE')
      or has_table_privilege('authenticated', protected.table_oid, 'DELETE')
    )
  ),
  'authenticated has no direct DML grants on domain tables'
);
select ok(
  not exists (
    select 1
    from unnest(array[
      to_regclass('public.competencias'), to_regclass('public.indicadores'),
      to_regclass('public.escopos'), to_regclass('public.vinculos'),
      to_regclass('public.regras'), to_regclass('public.entradas'),
      to_regclass('public.resultados'), to_regclass('public.eventos_auditoria')
    ]) as protected(table_oid)
    where protected.table_oid is not null and (
      has_table_privilege('anon', protected.table_oid, 'INSERT')
      or has_table_privilege('anon', protected.table_oid, 'UPDATE')
      or has_table_privilege('anon', protected.table_oid, 'DELETE')
    )
  ),
  'anon has no direct DML grants on domain tables'
);

select * from finish();
rollback;
