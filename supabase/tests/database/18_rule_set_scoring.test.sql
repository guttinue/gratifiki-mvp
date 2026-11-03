begin;
select no_plan();
\ir ../support/academic-fixture.psql
-- Synthetic DEMO rules built here: weights 30/25/25/20, targets 95/20/48/12, directions up/up/down/up.
insert into public.indicadores(id,codigo) select pg_temp.fixture('t18-ind-'||n),'T18-DEMO-0'||n from generate_series(1,4)n;
insert into public.regras(id,indicador_id,versao,metodo,meta,direcao,casas_decimais,valor_maximo,unidade_medida,nome,vigencia_inicio)
 select pg_temp.fixture('t18-rule-'||n),pg_temp.fixture('t18-ind-'||n),1,'meta_peso',m,d,c,x,'u','T18 DEMO '||n,'2026-01-01'
 from (values(1,95,'maior_melhor',2,100),(2,20,'maior_melhor',0,1000),(3,48,'menor_melhor',2,8760),(4,12,'maior_melhor',0,1000))v(n,m,d,c,x);
insert into public.regras(id,indicador_id,versao,metodo,meta,direcao,casas_decimais,valor_maximo,vigencia_inicio) values
 (pg_temp.fixture('t18-rule-other'),pg_temp.fixture('t18-ind-1'),2,'meta_peso',90,'maior_melhor',2,100,'2026-01-01'),
 (pg_temp.fixture('t18-rule-lone'),pg_temp.fixture('t18-ind-1'),3,'meta_peso',90,'maior_melhor',2,100,'2026-01-01'),
 (pg_temp.fixture('t18-rule-free'),pg_temp.fixture('t18-ind-1'),4,'meta_peso',90,'maior_melhor',2,100,'2026-01-01');
create function pg_temp.rule(label text) returns public.regras language sql as $$select r from public.regras r where r.id=pg_temp.fixture(label)$$;

-- Rule sets: same rules and weights, zero and redistribute modes.
insert into public.conjuntos_regra(id,codigo,versao,modo_ausencia,sintetico,vigencia_inicio,referencia) values
 (pg_temp.fixture('t18-set-zero'),'T18-DEMO',1,'zero',true,'2026-01-01','T18 synthetic'),
 (pg_temp.fixture('t18-set-redist'),'T18-DEMO',2,'redistribuir',true,'2026-01-01','T18 synthetic'),
 (pg_temp.fixture('t18-set-lone'),'T18-LONE',1,'zero',true,'2026-01-01','T18 synthetic'),
 (pg_temp.fixture('t18-set-free'),'T18-FREE',1,'zero',true,'2026-01-01','T18 synthetic');
insert into public.itens_conjunto(conjunto_id,indicador_id,regra_id,peso)
 select pg_temp.fixture(s),pg_temp.fixture('t18-ind-'||n),pg_temp.fixture('t18-rule-'||n),w
 from unnest(array['t18-set-zero','t18-set-redist'])s cross join (values(1,30),(2,25),(3,25),(4,20))v(n,w);
insert into public.itens_conjunto(conjunto_id,indicador_id,regra_id,peso) values
 (pg_temp.fixture('t18-set-lone'),pg_temp.fixture('t18-ind-1'),pg_temp.fixture('t18-rule-lone'),100),
 (pg_temp.fixture('t18-set-free'),pg_temp.fixture('t18-ind-1'),pg_temp.fixture('t18-rule-free'),100);
select lives_ok('set constraints all immediate','synthetic rule sets total 100');
insert into public.competencias(id,codigo,referencia,estado,modelo,conjunto_id) values
 (pg_temp.fixture('t18-sep'),'T18-2026-09','2026-09-01','aberta',3,pg_temp.fixture('t18-set-zero')),
 (pg_temp.fixture('t18-oct'),'T18-2026-10','2026-10-01','aberta',3,pg_temp.fixture('t18-set-zero')),
 (pg_temp.fixture('t18-oct-r'),'T18-2026-10-R','2026-10-01','aberta',3,pg_temp.fixture('t18-set-redist')),
 (pg_temp.fixture('t18-lone'),'T18-2026-11','2026-11-01','aberta',3,pg_temp.fixture('t18-set-lone'));
insert into public.escopos(id,codigo,tipo,distrito_id) select pg_temp.fixture('t18-'||u),'T18-'||upper(u),'unidade',pg_temp.fixture('district') from unnest(array['alfa','beta','gama','delta'])u;

-- R-9: model-3 positions are accepted only with the rule of their set item.
select throws_ok($$insert into public.posicoes_esperadas(competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id) values(pg_temp.fixture('t18-sep'),'c0de0000-0000-4000-8000-000000000002',pg_temp.fixture('t18-alfa'),'c0de0000-0000-4000-8000-000000000004',pg_temp.fixture('actor'),pg_temp.fixture('reviewer'))$$,
 '23514','academic_position_rule_outside_rule_set','model-3 position for an indicator outside the set is rejected');
select throws_ok($$insert into public.posicoes_esperadas(competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id) values(pg_temp.fixture('t18-sep'),pg_temp.fixture('t18-ind-1'),pg_temp.fixture('t18-alfa'),pg_temp.fixture('t18-rule-other'),pg_temp.fixture('actor'),pg_temp.fixture('reviewer'))$$,
 '23514','academic_position_rule_outside_rule_set','model-3 position with another rule version of the indicator is rejected');
insert into public.competencias(id,codigo,referencia,estado) values(pg_temp.fixture('t18-legacy'),'T18-LEGACY','2026-10-01','aberta');
select throws_ok($$insert into public.posicoes_esperadas(competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id) values(pg_temp.fixture('t18-legacy'),'c0de0000-0000-4000-8000-000000000002',pg_temp.fixture('t18-alfa'),'c0de0000-0000-4000-8000-000000000004',pg_temp.fixture('actor'),pg_temp.fixture('reviewer'))$$,
 '23514','academic_position_requires_academic_competence','model-1 competence still rejects positions');
select lives_ok($$insert into public.posicoes_esperadas(competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id) values(pg_temp.fixture('competence'),'c0de0000-0000-4000-8000-000000000002',pg_temp.fixture('t18-alfa'),'c0de0000-0000-4000-8000-000000000004',pg_temp.fixture('actor'),pg_temp.fixture('reviewer'))$$,
 'model-2 positions keep their factor rule');

-- R-8: a rule inside a set referenced by a competence is immutable.
select throws_ok($$update public.regras set meta=80 where id=pg_temp.fixture('t18-rule-lone')$$,'55000','immutable_record','rule of a referenced set cannot change its target');
select throws_ok($$update public.regras set direcao='menor_melhor' where id=pg_temp.fixture('t18-rule-lone')$$,'55000','immutable_record','rule of a referenced set cannot change its direction');
select throws_ok($$update public.regras set metodo='fator',fator=1,meta=null,direcao=null,casas_decimais=null,valor_maximo=null where id=pg_temp.fixture('t18-rule-lone')$$,'55000','immutable_record','rule of a referenced set cannot become a factor rule');
select throws_ok($$update public.regras set nome='renamed' where id=pg_temp.fixture('t18-rule-lone')$$,'55000','immutable_record','rule of a referenced set cannot change any field');
select throws_ok($$delete from public.regras where id=pg_temp.fixture('t18-rule-lone')$$,'55000','immutable_record','rule of a referenced set cannot be deleted');
select lives_ok($$update public.regras set nome='renamed' where id=pg_temp.fixture('t18-rule-free')$$,'rule of an unreferenced set stays editable');
-- One position per item: entry, current sent revision and the CAM decision for states without value.
create function pg_temp.item(p_cycle text,p_unit text,p_n integer,p_state text,p_value numeric,p_entry_state text default 'validada',p_decided boolean default true) returns void language plpgsql as $$
declare k text:=p_cycle||'-'||p_unit||'-'||p_n;
begin
 insert into public.posicoes_esperadas(id,competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id)
  values(pg_temp.fixture('t18-pos-'||k),pg_temp.fixture(p_cycle),pg_temp.fixture('t18-ind-'||p_n),pg_temp.fixture('t18-'||p_unit),pg_temp.fixture('t18-rule-'||p_n),pg_temp.fixture('actor'),pg_temp.fixture('reviewer'));
 insert into public.entradas(id,competencia_id,indicador_id,escopo_id,autor_id,valor,estado,revisao,operation_id,posicao_id)
  values(pg_temp.fixture('t18-entry-'||k),pg_temp.fixture(p_cycle),pg_temp.fixture('t18-ind-'||p_n),pg_temp.fixture('t18-'||p_unit),pg_temp.fixture('actor'),null,'rascunho',1,pg_temp.fixture('t18-op-'||k),pg_temp.fixture('t18-pos-'||k));
 insert into public.revisoes_entrada(id,entrada_id,numero,autor_id,estado_dado,valor,origem,periodo_fonte,motivo,enviada_em)
  values(pg_temp.fixture('t18-rev-'||k),pg_temp.fixture('t18-entry-'||k),1,pg_temp.fixture('actor'),p_state,p_value,'synthetic source','2026-09-01',case when p_state='valor' then '' else 'synthetic reason' end,now());
 update public.entradas set revisao_atual_id=pg_temp.fixture('t18-rev-'||k),estado=p_entry_state where id=pg_temp.fixture('t18-entry-'||k);
 if p_state<>'valor' and p_decided then
  insert into public.decisoes_entrada(revisao_id,ator_id,tipo,motivo,referencia) values(pg_temp.fixture('t18-rev-'||k),pg_temp.fixture('reviewer'),'decidir_indisponibilidade','synthetic decision','T18-REF');
 end if;
end;$$;
select lives_ok($$select pg_temp.item('t18-sep','alfa',1,'valor',88)$$,'model-3 position, entry and revision are accepted');
select pg_temp.item('t18-sep','alfa',n,'valor',v) from (values(2,18),(3,60),(4,11))x(n,v);
select pg_temp.item('t18-sep','delta',n,'valor',v) from (values(1,85),(2,17),(3,52),(4,10))x(n,v);
select pg_temp.item('t18-oct','delta',n,s,v) from (values(1,'valor',88),(2,'valor',19),(3,'indisponivel',null),(4,'valor',11))x(n,s,v);
select pg_temp.item('t18-oct-r','delta',n,s,v) from (values(1,'valor',88),(2,'valor',19),(3,'indisponivel',null),(4,'valor',11))x(n,s,v);
select pg_temp.item('t18-oct-r','beta',n,s,null) from (values(1,'indisponivel'),(2,'indisponivel'),(3,'indisponivel'),(4,'nao_aplicavel'))x(n,s);
-- Gama: one accepted value, one under review, one unavailable without CAM decision, one position marked not applicable.
select pg_temp.item('t18-oct','gama',1,'valor',90);
select pg_temp.item('t18-oct','gama',2,'valor',16,'em_revisao');
select pg_temp.item('t18-oct','gama',3,'indisponivel',null,'validada',false);
insert into public.posicoes_esperadas(competencia_id,indicador_id,alvo_id,regra_id,aplicavel,informante_id,revisor_id) values(pg_temp.fixture('t18-oct'),pg_temp.fixture('t18-ind-4'),pg_temp.fixture('t18-gama'),pg_temp.fixture('t18-rule-4'),false,pg_temp.fixture('actor'),pg_temp.fixture('reviewer'));
create function pg_temp.score(p_cycle text,p_unit text) returns jsonb language sql as $$select private.pontuacao_unidade(pg_temp.fixture(p_cycle),pg_temp.fixture('t18-'||p_unit))$$;
create function pg_temp.items(p_score jsonb,p_key text) returns jsonb language sql as $$select jsonb_agg(i->p_key order by i->>'code') from jsonb_array_elements(p_score->'items')i$$;

-- calcular_pontos: golden indicator cases (design 4.7).
select is(private.calcular_pontos(pg_temp.rule('t18-rule-1'),30,88)->>'points','27.79','DEMO-01 = 88 scores 27.79');
select is(private.calcular_pontos(pg_temp.rule('t18-rule-3'),25,0)->>'points','25','DEMO-03 = 0 earns the full weight');
select is(private.calcular_pontos(pg_temp.rule('t18-rule-1'),30,0)->>'points','0','DEMO-01 = 0 is a value worth 0 points');
select is(private.calcular_pontos(pg_temp.rule('t18-rule-3'),25,60)->>'points','20','DEMO-03 = 60 scores 20');
select is(private.calcular_pontos(pg_temp.rule('t18-rule-3'),25,52)->>'points','23.08','DEMO-03 = 52 scores 23.08');
select is(private.calcular_pontos(pg_temp.rule('t18-rule-1'),30,100)->>'points','30','ratio is capped at 1');
select is(private.calcular_pontos(pg_temp.rule('t18-rule-1'),30,88),
 jsonb_build_object('synthetic',true,'method','meta_peso','ruleId',pg_temp.fixture('t18-rule-1'),'ruleVersion',1,'meta','95','direction','maior_melhor','weight','30',
  'inputValue','88','ratio','0.9263157895','points','27.79','exactPoints','27.789473685','expression','min(88 ÷ 95; 1) × 30'),'meta/weight memory carries inputs, exact and rounded points');
select is(private.calcular_pontos(pg_temp.rule('t18-rule-3'),25,0)->>'expression','valor zero no indicador descendente = peso integral (25)','zero in a descending indicator explains the full weight');
select is(private.calcular_pontos(pg_temp.rule('t18-rule-3'),25,0)->>'ratio','1','zero in a descending indicator has ratio 1');
select is(private.calcular_pontos(pg_temp.rule('t18-rule-3'),25,52)->>'expression','min(48 ÷ 52; 1) × 25','descending expression divides target by value');
select is(private.calcular_pontos(pg_temp.rule('t18-rule-1'),33.3333333333,90.5)->>'expression','min(90,5 ÷ 95; 1) × 33,3333333333','expression uses pt-BR decimal commas');
select is(private.calcular_pontos(r,null,10),jsonb_build_object('resultValue',trim_scale(10*r.fator)::text),'factor method keeps value × factor')
 from public.regras r where r.id='c0de0000-0000-4000-8000-000000000004';
select throws_ok($$select private.calcular_pontos(pg_temp.rule('t18-rule-1'),30,null)$$,'22023','invalid_input','missing value is rejected');
select throws_ok($$select private.calcular_pontos(pg_temp.rule('t18-rule-1'),30,-1)$$,'22023','invalid_input','negative value is rejected');
select throws_ok($$select private.calcular_pontos(pg_temp.rule('t18-rule-1'),null,88)$$,'22023','invalid_input','meta/weight without a weight is rejected');
select throws_ok($$select private.calcular_pontos(pg_temp.rule('t18-rule-1'),0,88)$$,'22023','invalid_input','meta/weight with a non-positive weight is rejected');

-- pontuacao_unidade: golden unit cases (design 4.7).
select is(pg_temp.score('t18-sep','alfa')->>'points','88.62','Alfa September scores 88.62');
select is(pg_temp.score('t18-sep','alfa')->'complete','true','Alfa September is complete');
select is(pg_temp.items(pg_temp.score('t18-sep','alfa'),'points'),'["27.79","22.5","20","18.33"]','Alfa September points per indicator');
select is(pg_temp.score('t18-sep','alfa')->'items'->0,jsonb_build_object('indicatorId',pg_temp.fixture('t18-ind-1'),'code','T18-DEMO-01','state','valor','weight','30','effectiveWeight','30','ratio','0.9263157895','points','27.79'),'item carries indicator, state, weights, ratio and points');
select is(pg_temp.score('t18-sep','delta')->>'points','87.84','Delta September scores 87.84');
select is(pg_temp.score('t18-oct','delta')-'items',jsonb_build_object('points','69.87','complete',true,'noBase',false,'mode','zero'),'Delta October with a decided unavailable DEMO-03 scores 69.87 in zero mode');
select is(pg_temp.score('t18-oct','delta')->'items'->2,jsonb_build_object('indicatorId',pg_temp.fixture('t18-ind-3'),'code','T18-DEMO-03','state','indisponivel','weight','25','effectiveWeight','25','ratio',null,'points','0'),'zero mode keeps the weight of the unavailable item and scores it 0');
select is(pg_temp.score('t18-oct-r','delta')-'items',jsonb_build_object('points','93.16','complete',true,'noBase',false,'mode','redistribuir'),'Delta October scores 93.16 when redistributing');
select is(pg_temp.items(pg_temp.score('t18-oct-r','delta'),'effectiveWeight'),'["40","33.3333333333",null,"26.6666666667"]','redistributed effective weights');
select is(pg_temp.items(pg_temp.score('t18-oct-r','delta'),'points'),'["37.05","31.67",null,"24.44"]','redistributed points leave the unavailable item out');
select is(pg_temp.score('t18-oct-r','beta')-'items',jsonb_build_object('points',null,'complete',true,'noBase',true,'mode','redistribuir'),'no value in redistribute mode has no calculation base');
select is(pg_temp.items(pg_temp.score('t18-oct-r','beta'),'state'),'["indisponivel","indisponivel","indisponivel","nao_aplicavel"]','decided unavailable and not-applicable revisions are accepted states');
select is(pg_temp.score('t18-oct','gama')-'items',jsonb_build_object('points','28.42','complete',false,'noBase',false,'mode','zero'),'a pending item leaves the unit incomplete and outside the sum');
select is(pg_temp.items(pg_temp.score('t18-oct','gama'),'state'),'["valor","pendente","pendente","nao_aplicavel"]','under review and undecided unavailable are pending; a non-applicable position is decided');
select is(pg_temp.items(pg_temp.score('t18-oct','gama'),'points'),'["28.42",null,null,"0"]','pending items have no points; non-applicable scores 0 in zero mode');
select is(pg_temp.items(pg_temp.score('t18-oct','alfa'),'state'),'["pendente","pendente","pendente","pendente"]','missing positions are pending');
select is(pg_temp.score('t18-oct','alfa')->'complete','false','unit without positions is incomplete');
select throws_ok($$select private.pontuacao_unidade(pg_temp.fixture('competence'),pg_temp.fixture('unit'))$$,'22023','invalid_input','unit score requires a model-3 competence');

-- R-8 also holds for set rules already used by positions.
select throws_ok($$update public.regras set meta=80 where id=pg_temp.fixture('t18-rule-1')$$,'55000',null,'rule of a referenced set with positions cannot change');
select is(pg_temp.score('t18-sep','alfa')->>'points','88.62','unit score is unchanged after the rejected rule changes');
select has_function('private','calcular_pontos',array['regras','numeric','numeric'],'indicator scoring function exists');
select has_function('private','pontuacao_unidade',array['uuid','uuid'],'unit scoring function exists');
select is((select provolatile::text from pg_proc where oid='private.calcular_pontos(public.regras,numeric,numeric)'::regprocedure),'i','indicator scoring is immutable');
select is((select provolatile::text from pg_proc where oid='private.pontuacao_unidade(uuid,uuid)'::regprocedure),'s','unit scoring is stable');
select ok(not has_function_privilege(r.role,'private.calcular_pontos(public.regras,numeric,numeric)','EXECUTE') and not has_function_privilege(r.role,'private.pontuacao_unidade(uuid,uuid)','EXECUTE'),r.role||' cannot execute the scoring helpers')
 from (values('public'),('anon'),('authenticated'),('service_role'))r(role);

select * from finish();rollback;
