begin;

select plan(45);

select ok(to_regclass('public.competencias') is not null, 'competencias table exists');
select ok(to_regclass('public.indicadores') is not null, 'indicadores table exists');
select ok(to_regclass('public.escopos') is not null, 'escopos table exists');
select ok(to_regclass('public.vinculos') is not null, 'vinculos table exists');
select ok(to_regclass('public.regras') is not null, 'regras table exists');
select ok(to_regclass('public.entradas') is not null, 'entradas table exists');
select ok(to_regclass('public.resultados') is not null, 'resultados table exists');
select ok(to_regclass('public.eventos_auditoria') is not null, 'eventos_auditoria table exists');

select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.competencias') and contype = 'p'), 'competencias has a primary key');
select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.indicadores') and contype = 'p'), 'indicadores has a primary key');
select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.escopos') and contype = 'p'), 'escopos has a primary key');
select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.vinculos') and contype = 'p'), 'vinculos has a primary key');
select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.regras') and contype = 'p'), 'regras has a primary key');
select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.entradas') and contype = 'p'), 'entradas has a primary key');
select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.resultados') and contype = 'p'), 'resultados has a primary key');
select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.eventos_auditoria') and contype = 'p'), 'eventos_auditoria has a primary key');

select ok(coalesce((select array_agg(a.attname::text) from pg_attribute a where a.attrelid = to_regclass('public.competencias') and a.attnum > 0 and not a.attisdropped) @> array['id','codigo','referencia','estado']::text[], false), 'competencias exposes its contract columns');
select ok(coalesce((select array_agg(a.attname::text) from pg_attribute a where a.attrelid = to_regclass('public.indicadores') and a.attnum > 0 and not a.attisdropped) @> array['id','codigo']::text[], false), 'indicadores exposes its contract columns');
select ok(coalesce((select array_agg(a.attname::text) from pg_attribute a where a.attrelid = to_regclass('public.escopos') and a.attnum > 0 and not a.attisdropped) @> array['id','codigo']::text[], false), 'escopos exposes its contract columns');
select ok(coalesce((select array_agg(a.attname::text) from pg_attribute a where a.attrelid = to_regclass('public.vinculos') and a.attnum > 0 and not a.attisdropped) @> array['id','actor_id','papel','escopo_id']::text[], false), 'vinculos exposes its contract columns');
select ok(coalesce((select array_agg(a.attname::text) from pg_attribute a where a.attrelid = to_regclass('public.regras') and a.attnum > 0 and not a.attisdropped) @> array['id','indicador_id','versao','fator','vigencia_inicio','vigencia_fim']::text[], false), 'regras exposes its contract columns');
select ok(coalesce((select array_agg(a.attname::text) from pg_attribute a where a.attrelid = to_regclass('public.entradas') and a.attnum > 0 and not a.attisdropped) @> array['id','competencia_id','indicador_id','escopo_id','autor_id','valor','estado','revisao','operation_id']::text[], false), 'entradas exposes its contract columns');
select ok(coalesce((select array_agg(a.attname::text) from pg_attribute a where a.attrelid = to_regclass('public.resultados') and a.attnum > 0 and not a.attisdropped) @> array['id','entrada_id','regra_id','valor','memoria']::text[], false), 'resultados exposes its contract columns');
select ok(coalesce((select array_agg(a.attname::text) from pg_attribute a where a.attrelid = to_regclass('public.eventos_auditoria') and a.attnum > 0 and not a.attisdropped) @> array['id','recurso_tipo','recurso_id','actor_id','acao','ocorrido_em','detalhes']::text[], false), 'eventos_auditoria exposes its contract columns');

select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.vinculos') and confrelid = to_regclass('auth.users') and conname = 'fk_vinculos_actor'), 'vinculos actor references auth.users');
select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.vinculos') and confrelid = to_regclass('public.escopos') and conname = 'fk_vinculos_escopo'), 'vinculos scope references escopos');
select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.regras') and confrelid = to_regclass('public.indicadores') and conname = 'fk_regras_indicador'), 'regras indicator references indicadores');
select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.entradas') and confrelid = to_regclass('public.competencias') and conname = 'fk_entradas_competencia'), 'entradas competence references competencias');
select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.entradas') and confrelid = to_regclass('public.indicadores') and conname = 'fk_entradas_indicador'), 'entradas indicator references indicadores');
select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.entradas') and confrelid = to_regclass('public.escopos') and conname = 'fk_entradas_escopo'), 'entradas scope references escopos');
select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.entradas') and confrelid = to_regclass('auth.users') and conname = 'fk_entradas_autor'), 'entradas author references auth.users');
select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.resultados') and confrelid = to_regclass('public.entradas') and conname = 'fk_resultados_entrada'), 'resultados entry references entradas');
select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.resultados') and confrelid = to_regclass('public.regras') and conname = 'fk_resultados_regra'), 'resultados rule references regras');
select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.eventos_auditoria') and confrelid = to_regclass('auth.users') and conname = 'fk_eventos_auditoria_actor'), 'audit actor references auth.users');

select is((select count(*)::integer from public.competencias where codigo = 'DEMO-2026-09'), 1, 'one synthetic competence is seeded');
select is((select count(*)::integer from public.escopos where codigo = 'DEMO-ESCOPO-01'), 1, 'one synthetic scope is seeded');
select is((select count(*)::integer from public.regras r join public.indicadores i on i.id = r.indicador_id join public.competencias c on c.codigo = 'DEMO-2026-09' where i.codigo = 'DEMO-01' and c.referencia >= r.vigencia_inicio and (r.vigencia_fim is null or c.referencia <= r.vigencia_fim)), 1, 'one DEMO-01 rule is active for the fixed competence reference');

select ok(exists (select 1 from pg_constraint where conrelid = to_regclass('public.entradas') and contype = 'u' and conname = 'uq_entradas_autor_operation'), 'author and operation id have a unique constraint');
insert into auth.users (id, email, aud, role)
values ('d3e00000-0000-4000-8000-000000000001', 'schema-test@example.invalid', 'authenticated', 'authenticated');
insert into public.entradas (competencia_id, indicador_id, escopo_id, autor_id, valor, estado, revisao, operation_id)
select c.id, i.id, s.id, 'd3e00000-0000-4000-8000-000000000001', 0, 'validada', 1, 'd3e00000-0000-4000-8000-000000000002'
from public.competencias c, public.indicadores i, public.escopos s
where c.codigo = 'DEMO-2026-09' and i.codigo = 'DEMO-01' and s.codigo = 'DEMO-ESCOPO-01';
select throws_ok($$insert into public.entradas (competencia_id, indicador_id, escopo_id, autor_id, valor, estado, revisao, operation_id) select c.id, i.id, s.id, 'd3e00000-0000-4000-8000-000000000001', 0, 'validada', 1, 'd3e00000-0000-4000-8000-000000000002' from public.competencias c, public.indicadores i, public.escopos s where c.codigo = 'DEMO-2026-09' and i.codigo = 'DEMO-01' and s.codigo = 'DEMO-ESCOPO-01'$$, '23505', null, 'duplicate author and operation id are rejected');
select throws_ok($$insert into public.entradas (competencia_id, indicador_id, escopo_id, autor_id, valor, estado, revisao, operation_id) select c.id, i.id, s.id, 'd3e00000-0000-4000-8000-000000000001', -1, 'validada', 1, 'd3e00000-0000-4000-8000-000000000003' from public.competencias c, public.indicadores i, public.escopos s where c.codigo = 'DEMO-2026-09' and i.codigo = 'DEMO-01' and s.codigo = 'DEMO-ESCOPO-01'$$, '23514', null, 'negative entry values are rejected');

insert into public.entradas (competencia_id, indicador_id, escopo_id, autor_id, valor, estado, revisao, operation_id)
select c.id, i.id, s.id, 'd3e00000-0000-4000-8000-000000000001', 0, 'validada', 1, 'd3e00000-0000-4000-8000-000000000004'
from public.competencias c, public.indicadores i, public.escopos s
where c.codigo = 'DEMO-2026-09' and i.codigo = 'DEMO-01' and s.codigo = 'DEMO-ESCOPO-01';
select is((select estado from public.entradas where operation_id = 'd3e00000-0000-4000-8000-000000000004'), 'validada', 'zero is a valid value and does not infer invalid state');
update public.competencias set estado = 'fechada' where codigo = 'DEMO-2026-09';
select is((select estado from public.competencias where codigo = 'DEMO-2026-09'), 'fechada', 'competence state is explicit and independent of entry value zero');

select ok(not exists (select 1 from pg_class where oid = any (array[to_regclass('public.competencias'), to_regclass('public.indicadores'), to_regclass('public.escopos'), to_regclass('public.vinculos'), to_regclass('public.regras'), to_regclass('public.entradas'), to_regclass('public.resultados'), to_regclass('public.eventos_auditoria')]) and not relrowsecurity), 'RLS is enabled on all domain tables');
select ok(not exists (select 1 from unnest(array[to_regclass('public.competencias'), to_regclass('public.indicadores'), to_regclass('public.escopos'), to_regclass('public.vinculos'), to_regclass('public.regras'), to_regclass('public.entradas'), to_regclass('public.resultados'), to_regclass('public.eventos_auditoria')]) as table_oid where table_oid is not null and (has_table_privilege('anon', table_oid, 'INSERT') or has_table_privilege('anon', table_oid, 'UPDATE') or has_table_privilege('anon', table_oid, 'DELETE'))), 'anon has no direct DML grants on domain tables');
select ok(not exists (select 1 from unnest(array[to_regclass('public.competencias'), to_regclass('public.indicadores'), to_regclass('public.escopos'), to_regclass('public.vinculos'), to_regclass('public.regras'), to_regclass('public.entradas'), to_regclass('public.resultados'), to_regclass('public.eventos_auditoria')]) as table_oid where table_oid is not null and (has_table_privilege('authenticated', table_oid, 'INSERT') or has_table_privilege('authenticated', table_oid, 'UPDATE') or has_table_privilege('authenticated', table_oid, 'DELETE'))), 'authenticated has no direct DML grants on domain tables');

select * from finish();
rollback;
