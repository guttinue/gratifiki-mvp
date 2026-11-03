begin;
select no_plan();

select has_table('public', 'posicoes_esperadas', 'posicoes_esperadas exists');
select has_table('public', 'revisoes_entrada', 'revisoes_entrada exists');
select has_table('public', 'decisoes_entrada', 'decisoes_entrada exists');
select has_table('public', 'operacoes_dominio', 'operacoes_dominio exists');
select has_table('public', 'ativacoes_regra', 'ativacoes_regra exists');
select has_table('public', 'territorios_competencia', 'territorios_competencia exists');
select has_table('public', 'fechamentos', 'fechamentos exists');
select has_table('public', 'itens_fechamento', 'itens_fechamento exists');
select has_table('public', 'publicacoes', 'publicacoes exists');
select has_table('public', 'contas_demo', 'contas_demo exists');

\ir ../support/academic-fixture.psql
select pg_temp.fixture('model');
select lives_ok($$insert into public.vinculos(actor_id,papel,escopo_id) values(pg_temp.fixture('actor'),'area_tecnica',pg_temp.fixture('unit')) on conflict(actor_id,papel,escopo_id,indicador_id) do update set ativo=excluded.ativo$$,'legacy identity bootstrap keeps its upsert on the indicator-aware conflict target');
select throws_ok($$update public.entradas set valor=1 where id=pg_temp.fixture('entry')$$,'23514',null,'academic header cannot duplicate the authoritative revision value');

select is((select modelo from public.competencias where codigo='DEMO-2026-09'), 1, 'legacy competence is not reclassified');
select is((select tipo from public.escopos where codigo='DEMO-ESCOPO-01'), null::text, 'legacy scope has no invented classification');
select is((select referencia::text from public.competencias where codigo='DEMO-2026-09'), '2026-09-15', 'legacy calendar date is preserved');

select throws_ok($$insert into public.posicoes_esperadas (competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id) select competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id from public.posicoes_esperadas where id=pg_temp.fixture('position')$$, '23505', null, 'position is unique by month, indicator and target');
select throws_ok($$insert into public.revisoes_entrada (entrada_id,numero,autor_id,estado_dado,valor) values (pg_temp.fixture('entry'),3,pg_temp.fixture('actor'),'indisponivel',0)$$, '23514', null, 'unavailable is never zero');
select throws_ok($$insert into public.revisoes_entrada (entrada_id,numero,autor_id,estado_dado,valor,origem,periodo_fonte,enviada_em) values (pg_temp.fixture('entry'),3,pg_temp.fixture('actor'),'valor',null,'synthetic source','2026-10-01',now())$$, '23514', null, 'submitted numeric revision with valid source requires a nonnull value');
select throws_ok($$insert into public.revisoes_entrada (entrada_id,numero,autor_id,estado_dado,valor,periodo_fonte,enviada_em) values (pg_temp.fixture('entry'),3,pg_temp.fixture('actor'),'valor',1,'2026-10-01',now())$$, '23514', null, 'submitted numeric revision with valid value requires a source');
select throws_ok($$update public.revisoes_entrada set valor=2 where id=pg_temp.fixture('revision')$$, '55000', null, 'sent revision payload is immutable');
select throws_ok($$delete from public.revisoes_entrada where id=pg_temp.fixture('revision')$$, '55000', null, 'sent revisions cannot be deleted');
select lives_ok($$update public.revisoes_entrada set valor=3 where id=pg_temp.fixture('draft')$$, 'draft content remains editable by privileged future handlers');

select throws_ok($$insert into public.resultados (entrada_id,regra_id,revisao_id,valor,memoria) values (pg_temp.fixture('other_entry'),'c0de0000-0000-4000-8000-000000000004',pg_temp.fixture('revision'),1,'{}')$$,'23503',null,'cross-entry result revision is rejected');
insert into public.resultados (entrada_id,regra_id,revisao_id,valor,memoria) values
 (pg_temp.fixture('entry'),'c0de0000-0000-4000-8000-000000000004',pg_temp.fixture('revision'),0.0000000001,'{}'),
 (pg_temp.fixture('entry'),'c0de0000-0000-4000-8000-000000000004',pg_temp.fixture('draft'),0.00008,'{}');
select is((select count(*)::integer from public.resultados where entrada_id=pg_temp.fixture('entry')),2,'two revisions may use the same rule');
select is((select valor from public.resultados where revisao_id=pg_temp.fixture('revision')),0.0000000001::numeric,'result retains all ten product decimal places');
select throws_ok($$update public.entradas set revisao_atual_id=pg_temp.fixture('revision') where id=pg_temp.fixture('other_entry')$$,'23503',null,'current revision belongs to its entry');
select throws_ok($$update public.regras set versao=9 where id='c0de0000-0000-4000-8000-000000000004'$$,'55000',null,'used rule version is immutable');
select throws_ok($$update public.resultados set memoria='{"changed":true}' where entrada_id=pg_temp.fixture('entry')$$,'55000',null,'result memory is immutable');

insert into public.decisoes_entrada (revisao_id,ator_id,tipo) values (pg_temp.fixture('revision'),pg_temp.fixture('reviewer'),'iniciar_revisao');
select throws_ok($$delete from public.decisoes_entrada$$,'55000',null,'decisions are append-only');
insert into public.fechamentos (id,competencia_id,referencia_demo,ator_id) values (pg_temp.fixture('snapshot'),pg_temp.fixture('competence'),'DEMO test',pg_temp.fixture('actor'));
insert into public.itens_fechamento (fechamento_id,posicao_id,alvo_id,revisao_id,regra_id,estado_dado,valor_entrada,valor_resultado,memoria) values (pg_temp.fixture('snapshot'),pg_temp.fixture('position'),pg_temp.fixture('unit'),pg_temp.fixture('revision'),'c0de0000-0000-4000-8000-000000000004','valor',0.0001,0.00008,'{}');
select throws_ok($$update public.itens_fechamento set valor_resultado=1$$,'55000',null,'snapshot items are immutable');
select throws_ok($$delete from public.fechamentos$$,'55000',null,'snapshot headers are immutable');

select ok(c.relrowsecurity, c.relname || ' enables RLS') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('posicoes_esperadas','revisoes_entrada','decisoes_entrada','operacoes_dominio','ativacoes_regra','territorios_competencia','fechamentos','itens_fechamento','publicacoes','contas_demo');
select ok(not has_table_privilege(r.role,c.oid,'SELECT,INSERT,UPDATE,DELETE'), r.role || ' has no direct access to ' || c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join (values ('anon'),('authenticated')) r(role) where n.nspname='public' and c.relname in ('posicoes_esperadas','revisoes_entrada','decisoes_entrada','operacoes_dominio','ativacoes_regra','territorios_competencia','fechamentos','itens_fechamento','publicacoes','contas_demo');

select pg_temp.login_as('actor');
set local role authenticated;
select throws_ok($$select * from public.posicoes_esperadas$$,'42501',null,'authenticated cannot directly read new relations');
select is((select count(*)::integer from public.entradas where id=pg_temp.fixture('entry')),0,'legacy policy cannot expose academic entries');
select is((select count(*)::integer from public.resultados where entrada_id=pg_temp.fixture('entry')),0,'legacy policy cannot expose academic results');
select throws_ok($$select public.submit_demo_entry(pg_temp.fixture('competence'),'c0de0000-0000-4000-8000-000000000002',pg_temp.fixture('unit'),'1',gen_random_uuid())$$,'22023',null,'legacy submit cannot process academic context');
reset role;
select * from finish();
rollback;
