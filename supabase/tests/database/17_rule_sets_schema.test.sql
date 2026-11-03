begin;
select no_plan();
\ir ../support/academic-fixture.psql
select has_table('public','conjuntos_regra','rule sets exist');
select has_table('public','itens_conjunto','rule set items exist');
select has_table('public','pontuacoes_fechamento','frozen unit scores exist');
select ok(not has_table_privilege('authenticated','public.conjuntos_regra','select') and not has_table_privilege('authenticated','public.itens_conjunto','select') and not has_table_privilege('authenticated','public.pontuacoes_fechamento','select'),'new tables are readable only through RPCs');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.conjuntos_regra'::regclass,'public.itens_conjunto'::regclass,'public.pontuacoes_fechamento'::regclass)),'new tables have RLS enabled');
select is((select count(*)::integer from information_schema.columns where table_schema='public' and table_name='itens_fechamento' and is_nullable='YES'
 and column_name in ('metodo','meta','direcao','peso','peso_efetivo','razao','pontos','conjunto_id','conjunto_versao','modo_ausencia')),10,'closure items gain nullable model-3 frozen columns');

-- Rules: the legacy factor rule is classified, never rewritten.
select is((select metodo from public.regras where id='c0de0000-0000-4000-8000-000000000004'),'fator','existing rule defaults to the factor method');
insert into public.indicadores(id,codigo) select pg_temp.fixture('t17-ind-'||n),'T17-IND-'||n from generate_series(1,5)n;
select lives_ok($$insert into public.regras(id,indicador_id,versao,metodo,meta,direcao,casas_decimais,valor_maximo,unidade_medida,nome,vigencia_inicio)
 select pg_temp.fixture('t17-rule-'||n),pg_temp.fixture('t17-ind-'||n),1,'meta_peso',90,case when n=2 then 'menor_melhor' else 'maior_melhor' end,2,100,'%','T17 '||n,'2026-01-01' from generate_series(1,5)n$$,'meta/weight rules need no factor');
select throws_ok($$insert into public.regras(indicador_id,versao,metodo,fator,meta,direcao,casas_decimais,valor_maximo,vigencia_inicio) values(pg_temp.fixture('t17-ind-1'),2,'meta_peso',1,90,'maior_melhor',2,100,'2026-01-01')$$,'23514',null,'meta/weight rule with a factor is rejected');
select throws_ok($$insert into public.regras(indicador_id,versao,fator,meta,vigencia_inicio) values(pg_temp.fixture('t17-ind-1'),3,1,90,'2026-01-01')$$,'23514',null,'factor rule with a target is rejected');

-- Rule set total is checked when constraints are resolved, not per statement.
insert into public.conjuntos_regra(id,codigo,versao,modo_ausencia,sintetico,vigencia_inicio,referencia) values(pg_temp.fixture('t17-set'),'T17-SET',1,'zero',true,'2026-11-01','T17 synthetic reference');
insert into public.itens_conjunto(conjunto_id,indicador_id,regra_id,peso) values(pg_temp.fixture('t17-set'),pg_temp.fixture('t17-ind-1'),pg_temp.fixture('t17-rule-1'),30);
insert into public.itens_conjunto(conjunto_id,indicador_id,regra_id,peso) select pg_temp.fixture('t17-set'),pg_temp.fixture('t17-ind-'||n),pg_temp.fixture('t17-rule-'||n),w from(values(2,25),(3,25),(4,20))v(n,w);
select lives_ok('set constraints all immediate','weights 30+25+25+20 satisfy the deferred total');
select is((select metadados from public.itens_conjunto where conjunto_id=pg_temp.fixture('t17-set') and indicador_id=pg_temp.fixture('t17-ind-1')),'{}'::jsonb,'item metadata defaults to an empty object');
select throws_ok($$with s as (insert into public.conjuntos_regra(id,codigo,versao,modo_ausencia,sintetico,vigencia_inicio,referencia) values(pg_temp.fixture('t17-short'),'T17-SET',2,'zero',true,'2026-11-01','T17 short') returning id)
 insert into public.itens_conjunto(conjunto_id,indicador_id,regra_id,peso) select (select id from s),pg_temp.fixture('t17-ind-'||n),pg_temp.fixture('t17-rule-'||n),w from(values(1,30),(2,25),(3,25),(4,19))v(n,w)$$,'22023','invalid_input','weights 30+25+25+19 are rejected');
select throws_ok($$insert into public.conjuntos_regra(codigo,versao,modo_ausencia,sintetico,vigencia_inicio,referencia) values('T17-EMPTY',1,'zero',true,'2026-11-01','T17 empty')$$,'22023','invalid_input','a rule set without items is rejected');
select throws_ok($$with s as (insert into public.conjuntos_regra(id,codigo,versao,modo_ausencia,sintetico,vigencia_inicio,referencia) values(pg_temp.fixture('t17-factor'),'T17-FACTOR',1,'zero',true,'2026-11-01','T17 factor') returning id)
 insert into public.itens_conjunto(conjunto_id,indicador_id,regra_id,peso) select (select id from s),i,r,w from(values(pg_temp.fixture('t17-ind-1'),pg_temp.fixture('t17-rule-1'),30),(pg_temp.fixture('t17-ind-2'),pg_temp.fixture('t17-rule-2'),25),(pg_temp.fixture('t17-ind-3'),pg_temp.fixture('t17-rule-3'),25),
  ('c0de0000-0000-4000-8000-000000000002'::uuid,'c0de0000-0000-4000-8000-000000000004'::uuid,20))v(i,r,w)$$,'22023','invalid_input','a factor rule cannot join a rule set even when weights total 100');
select throws_ok($$with s as (insert into public.conjuntos_regra(id,codigo,versao,modo_ausencia,sintetico,vigencia_inicio,referencia) values(pg_temp.fixture('t17-foreign'),'T17-FOREIGN',1,'zero',true,'2026-11-01','T17 foreign') returning id)
 insert into public.itens_conjunto(conjunto_id,indicador_id,regra_id,peso) select (select id from s),pg_temp.fixture('t17-ind-1'),pg_temp.fixture('t17-rule-5'),100$$,'23503',null,'an item rule must belong to the item indicator');

-- Competence model 3 always names its rule set; models 1/2 never do.
select throws_ok($$insert into public.competencias(codigo,referencia,estado,modelo) values('T17-2026-11','2026-11-01','aberta',3)$$,'23514',null,'model-3 competence without a rule set is rejected');
select throws_ok($$insert into public.competencias(codigo,referencia,estado,modelo,conjunto_id) values('T17-2026-12','2026-12-01','aberta',2,pg_temp.fixture('t17-set'))$$,'23514',null,'model-2 competence cannot reference a rule set');

-- A referenced rule set and its items become immutable.
select lives_ok($$update public.itens_conjunto set metadados='{"note":"T17"}' where conjunto_id=pg_temp.fixture('t17-set') and indicador_id=pg_temp.fixture('t17-ind-1')$$,'unreferenced rule set items stay editable');
select lives_ok($$insert into public.competencias(id,codigo,referencia,estado,modelo,conjunto_id) values(pg_temp.fixture('t17-cycle'),'T17-2026-11','2026-11-01','aberta',3,pg_temp.fixture('t17-set'))$$,'model-3 competence references its rule set');
select throws_ok($$update public.itens_conjunto set peso=peso where conjunto_id=pg_temp.fixture('t17-set') and indicador_id=pg_temp.fixture('t17-ind-1')$$,'55000','immutable_record','referenced rule set item cannot be updated');
select throws_ok($$delete from public.itens_conjunto where conjunto_id=pg_temp.fixture('t17-set') and indicador_id=pg_temp.fixture('t17-ind-4')$$,'55000','immutable_record','referenced rule set item cannot be deleted');
select throws_ok($$insert into public.itens_conjunto(conjunto_id,indicador_id,regra_id,peso) values(pg_temp.fixture('t17-set'),pg_temp.fixture('t17-ind-5'),pg_temp.fixture('t17-rule-5'),1)$$,'55000','immutable_record','referenced rule set cannot gain items');
select throws_ok($$update public.conjuntos_regra set modo_ausencia='redistribuir' where id=pg_temp.fixture('t17-set')$$,'55000','immutable_record','referenced rule set cannot be updated');

-- Data state: not applicable behaves like unavailable.
select throws_ok($$insert into public.revisoes_entrada(entrada_id,numero,autor_id,estado_dado,valor,origem,periodo_fonte,motivo,enviada_em) values(pg_temp.fixture('entry'),3,pg_temp.fixture('actor'),'nao_aplicavel',null,'synthetic source','2026-10-01','',now())$$,'23514',null,'submitted not-applicable revision requires a reason');
select throws_ok($$insert into public.revisoes_entrada(entrada_id,numero,autor_id,estado_dado,valor,origem,periodo_fonte,motivo,enviada_em) values(pg_temp.fixture('entry'),3,pg_temp.fixture('actor'),'nao_aplicavel',0,'synthetic source','2026-10-01','not applicable reason',now())$$,'23514',null,'not-applicable revision never carries a value');
select lives_ok($$insert into public.revisoes_entrada(entrada_id,numero,autor_id,estado_dado,valor,origem,periodo_fonte,motivo,enviada_em) values(pg_temp.fixture('entry'),3,pg_temp.fixture('actor'),'nao_aplicavel',null,'synthetic source','2026-10-01','not applicable reason',now())$$,'submitted not-applicable revision with a reason is accepted');

-- Links are unique per indicator; NULL indicators are not distinct.
select lives_ok($$insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio) values(pg_temp.fixture('actor'),'area_tecnica',pg_temp.fixture('unit'),pg_temp.fixture('t17-ind-1'),current_date-1),(pg_temp.fixture('actor'),'area_tecnica',pg_temp.fixture('unit'),pg_temp.fixture('t17-ind-2'),current_date-1)$$,'same actor, role and scope may hold links for different indicators');
select throws_ok($$insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio) values(pg_temp.fixture('actor'),'area_tecnica',pg_temp.fixture('unit'),pg_temp.fixture('t17-ind-1'),current_date-1)$$,'23505',null,'duplicate link for the same indicator is rejected');
select throws_ok($$insert into public.vinculos(actor_id,papel,escopo_id) values(pg_temp.fixture('actor'),'area_tecnica',pg_temp.fixture('unit'))$$,'23505',null,'duplicate legacy link without indicator is rejected');
select lives_ok($$insert into public.vinculos(actor_id,papel,escopo_id) values(pg_temp.fixture('actor'),'area_tecnica',pg_temp.fixture('unit')) on conflict(actor_id,papel,escopo_id,indicador_id) do update set ativo=excluded.ativo$$,'legacy identity upsert resolves on the indicator-aware key');
select is((select count(*)::integer from public.vinculos where actor_id=pg_temp.fixture('actor') and papel='area_tecnica' and escopo_id=pg_temp.fixture('unit') and indicador_id is null),1,'legacy upsert updates the existing link instead of duplicating it');

-- Link administration resolves the link of the requested indicator.
insert into auth.users(id,email,aud,role) values(pg_temp.fixture('admin'),'admin-t17@example.invalid','authenticated','authenticated');
insert into public.contas_demo(ator_id,rotulo) select pg_temp.fixture(who),'DEMO-'||who from unnest(array['admin','reviewer'])who;
insert into public.vinculos(id,actor_id,papel,escopo_id,indicador_id,vigencia_inicio) values
 (pg_temp.fixture('t17-admin-link'),pg_temp.fixture('admin'),'administrador',pg_temp.fixture('district'),'c0de0000-0000-4000-8000-000000000002',current_date-1),
 (pg_temp.fixture('t17-other-link'),pg_temp.fixture('reviewer'),'cam',pg_temp.fixture('unit'),pg_temp.fixture('t17-ind-1'),current_date-1),
 (pg_temp.fixture('t17-pilot-link'),pg_temp.fixture('reviewer'),'cam',pg_temp.fixture('unit'),'c0de0000-0000-4000-8000-000000000002',current_date-1);
create function pg_temp.admin_ctx() returns jsonb language sql security definer as $$select jsonb_build_object('vinculoId',id,'competenciaId',pg_temp.fixture('competence'),'indicadorId',indicador_id) from public.vinculos where id=pg_temp.fixture('t17-admin-link');$$;
select pg_temp.login_as('admin');set local role authenticated;
select lives_ok($$select public.set_demo_business_link(pg_temp.admin_ctx(),pg_temp.fixture('reviewer'),1,jsonb_build_object('role','cam','escopoId',pg_temp.fixture('unit'),'indicadorId','c0de0000-0000-4000-8000-000000000002','ativo',false,'vigenciaInicio',(current_date-1)::text,'vigenciaFim',null),gen_random_uuid())$$,'link command updates the link of the requested indicator');
reset role;
select is((select jsonb_object_agg(id,jsonb_build_array(ativo,lock_version)) from public.vinculos where id in (pg_temp.fixture('t17-other-link'),pg_temp.fixture('t17-pilot-link'))),
 jsonb_build_object(pg_temp.fixture('t17-other-link'),jsonb_build_array(true,1),pg_temp.fixture('t17-pilot-link'),jsonb_build_array(false,2)),'only the requested indicator link changes');

-- Frozen unit scores are immutable.
insert into public.fechamentos(id,competencia_id,referencia_demo,ator_id) values(pg_temp.fixture('t17-closure'),pg_temp.fixture('t17-cycle'),'T17 closure',pg_temp.fixture('actor'));
select lives_ok($$insert into public.pontuacoes_fechamento(fechamento_id,alvo_id,alvo_codigo,distrito_id,pontos,completo,sem_base,conjunto_id,conjunto_versao) values(pg_temp.fixture('t17-closure'),pg_temp.fixture('unit'),'TEST-UNIT',pg_temp.fixture('district'),88.62,true,false,pg_temp.fixture('t17-set'),1)$$,'unit score is frozen at closure');
select throws_ok($$update public.pontuacoes_fechamento set pontos=0 where fechamento_id=pg_temp.fixture('t17-closure')$$,'55000','immutable_record','frozen unit score cannot be updated');
select throws_ok($$delete from public.pontuacoes_fechamento where fechamento_id=pg_temp.fixture('t17-closure')$$,'55000','immutable_record','frozen unit score cannot be deleted');
select * from finish();rollback;
