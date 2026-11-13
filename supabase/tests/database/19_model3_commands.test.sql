begin;
select no_plan();
\ir ../support/academic-fixture.psql
-- Synthetic DEMO rule set built here: weights 30/25/25/20, targets 95/20/48/12,
-- directions up/up/down/up, decimals 2/0/2/0, maxima 100/1000/8760/1000.
insert into auth.users(id,email,aud,role) values(pg_temp.fixture('cam'),'t19-cam@example.invalid','authenticated','authenticated');
insert into public.contas_demo(ator_id,rotulo) values(pg_temp.fixture('actor'),'T19 technical'),(pg_temp.fixture('reviewer'),'T19 reviewer'),(pg_temp.fixture('cam'),'T19 CAM');
insert into public.indicadores(id,codigo) select pg_temp.fixture('t19-ind-'||n),'T19-DEMO-0'||n from generate_series(1,4)n;
insert into public.regras(id,indicador_id,versao,metodo,meta,direcao,casas_decimais,valor_maximo,unidade_medida,nome,vigencia_inicio)
 select pg_temp.fixture('t19-rule-'||n),pg_temp.fixture('t19-ind-'||n),1,'meta_peso',m,d,c,x,'u','T19 DEMO '||n,'2026-01-01'
 from (values(1,95,'maior_melhor',2,100),(2,20,'maior_melhor',0,1000),(3,48,'menor_melhor',2,8760),(4,12,'maior_melhor',0,1000))v(n,m,d,c,x);
insert into public.regras(id,indicador_id,versao,metodo,meta,direcao,casas_decimais,valor_maximo,vigencia_inicio) values
 (pg_temp.fixture('t19-rule-other'),pg_temp.fixture('t19-ind-1'),2,'meta_peso',90,'maior_melhor',2,100,'2026-01-01');
insert into public.conjuntos_regra(id,codigo,versao,modo_ausencia,sintetico,vigencia_inicio,referencia) values
 (pg_temp.fixture('t19-set'),'T19-DEMO',1,'zero',true,'2026-01-01','T19 synthetic');
insert into public.itens_conjunto(conjunto_id,indicador_id,regra_id,peso)
 select pg_temp.fixture('t19-set'),pg_temp.fixture('t19-ind-'||n),pg_temp.fixture('t19-rule-'||n),w from (values(1,30),(2,25),(3,25),(4,20))v(n,w);
select lives_ok('set constraints all immediate','synthetic DEMO rule set totals 100');
insert into public.competencias(id,codigo,referencia,estado,modelo,conjunto_id) values
 (pg_temp.fixture('t19-cycle'),'T19-2026-10','2026-10-01','aberta',3,pg_temp.fixture('t19-set'));
insert into public.escopos(id,codigo,tipo,distrito_id) select pg_temp.fixture('t19-'||u),'T19-'||upper(u),'unidade',pg_temp.fixture('district')
 from unnest(array['alfa','beta','gama','m2-draft','m2-na','m2-meta'])u;

-- Model 3: one link per indicator for each role; one position per unit and indicator.
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio)
 select pg_temp.fixture(who),role,pg_temp.fixture('t19-'||u),pg_temp.fixture('t19-ind-'||n),current_date-1
 from unnest(array['alfa','beta'])u cross join generate_series(1,4)n cross join (values('actor','area_tecnica'),('reviewer','revisor_tecnico'),('cam','cam'))a(who,role);
insert into public.posicoes_esperadas(id,competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id)
 select pg_temp.fixture('t19-pos-'||u||'-'||n),pg_temp.fixture('t19-cycle'),pg_temp.fixture('t19-ind-'||n),pg_temp.fixture('t19-'||u),pg_temp.fixture('t19-rule-'||n),pg_temp.fixture('actor'),pg_temp.fixture('reviewer')
 from unnest(array['alfa','beta'])u cross join generate_series(1,4)n;
-- Gama holds a model-3 position whose rule is not its set item rule. The R-9
-- guard rejects that row, so it is planted with the guard off to prove the
-- command check on its own.
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio) values(pg_temp.fixture('actor'),'area_tecnica',pg_temp.fixture('t19-gama'),pg_temp.fixture('t19-ind-1'),current_date-1);
alter table public.posicoes_esperadas disable trigger academic_position_guard;
insert into public.posicoes_esperadas(id,competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id)
 values(pg_temp.fixture('t19-pos-gama-1'),pg_temp.fixture('t19-cycle'),pg_temp.fixture('t19-ind-1'),pg_temp.fixture('t19-gama'),pg_temp.fixture('t19-rule-other'),pg_temp.fixture('actor'),pg_temp.fixture('reviewer'));
alter table public.posicoes_esperadas enable trigger academic_position_guard;
-- The guard also rejects any later write to that position, so its draft is planted too.
insert into public.entradas(id,competencia_id,indicador_id,escopo_id,autor_id,valor,estado,revisao,operation_id,posicao_id)
 values(pg_temp.fixture('t19-entry-gama-1'),pg_temp.fixture('t19-cycle'),pg_temp.fixture('t19-ind-1'),pg_temp.fixture('t19-gama'),pg_temp.fixture('actor'),null,'rascunho',1,pg_temp.fixture('t19-op-gama-1'),pg_temp.fixture('t19-pos-gama-1'));
insert into public.revisoes_entrada(id,entrada_id,numero,autor_id,estado_dado,valor,origem,periodo_fonte,motivo)
 values(pg_temp.fixture('t19-rev-gama-1'),pg_temp.fixture('t19-entry-gama-1'),1,pg_temp.fixture('actor'),'valor',90,'synthetic source','2026-10-01','');
update public.entradas set revisao_atual_id=pg_temp.fixture('t19-rev-gama-1') where id=pg_temp.fixture('t19-entry-gama-1');

-- Model 2 (fixture competence): an empty position, an accepted not-applicable
-- revision planted directly, and a position pinned to a meta/weight rule.
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio) values
 (pg_temp.fixture('actor'),'area_tecnica',pg_temp.fixture('t19-m2-draft'),'c0de0000-0000-4000-8000-000000000002',current_date-1),
 (pg_temp.fixture('cam'),'cam',pg_temp.fixture('t19-m2-na'),'c0de0000-0000-4000-8000-000000000002',current_date-1),
 (pg_temp.fixture('actor'),'area_tecnica',pg_temp.fixture('t19-m2-meta'),pg_temp.fixture('t19-ind-1'),current_date-1);
insert into public.posicoes_esperadas(id,competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id) values
 (pg_temp.fixture('t19-pos-m2-draft'),pg_temp.fixture('competence'),'c0de0000-0000-4000-8000-000000000002',pg_temp.fixture('t19-m2-draft'),'c0de0000-0000-4000-8000-000000000004',pg_temp.fixture('actor'),pg_temp.fixture('reviewer')),
 (pg_temp.fixture('t19-pos-m2-na'),pg_temp.fixture('competence'),'c0de0000-0000-4000-8000-000000000002',pg_temp.fixture('t19-m2-na'),'c0de0000-0000-4000-8000-000000000004',pg_temp.fixture('actor'),pg_temp.fixture('reviewer')),
 (pg_temp.fixture('t19-pos-m2-meta'),pg_temp.fixture('competence'),pg_temp.fixture('t19-ind-1'),pg_temp.fixture('t19-m2-meta'),pg_temp.fixture('t19-rule-1'),pg_temp.fixture('actor'),pg_temp.fixture('reviewer'));
insert into public.entradas(id,competencia_id,indicador_id,escopo_id,autor_id,valor,estado,revisao,operation_id,posicao_id)
 values(pg_temp.fixture('t19-entry-m2-na'),pg_temp.fixture('competence'),'c0de0000-0000-4000-8000-000000000002',pg_temp.fixture('t19-m2-na'),pg_temp.fixture('actor'),null,'rascunho',1,pg_temp.fixture('t19-op-m2-na'),pg_temp.fixture('t19-pos-m2-na'));
insert into public.revisoes_entrada(id,entrada_id,numero,autor_id,estado_dado,valor,origem,periodo_fonte,motivo,enviada_em)
 values(pg_temp.fixture('t19-rev-m2-na'),pg_temp.fixture('t19-entry-m2-na'),1,pg_temp.fixture('actor'),'nao_aplicavel',null,'synthetic source','2026-10-01','synthetic reason',now());
update public.entradas set revisao_atual_id=pg_temp.fixture('t19-rev-m2-na'),estado='validada' where id=pg_temp.fixture('t19-entry-m2-na');
insert into public.decisoes_entrada(revisao_id,ator_id,tipo,motivo) values(pg_temp.fixture('t19-rev-m2-na'),pg_temp.fixture('reviewer'),'validar','synthetic acceptance');

create function pg_temp.ctx(who text,role text,unit text,indicator uuid,cycle text default 't19-cycle') returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('vinculoId',id,'competenciaId',pg_temp.fixture(cycle),'indicadorId',indicador_id) from public.vinculos
 where actor_id=pg_temp.fixture(who) and papel=role and escopo_id=pg_temp.fixture('t19-'||unit) and indicador_id=indicator$$;
create function pg_temp.ind(n integer) returns uuid language sql as $$select pg_temp.fixture('t19-ind-'||n)$$;
create function pg_temp.input(state text,value text,reason text default '') returns jsonb language sql as $$
 select jsonb_build_object('estadoDado',state,'valor',value,'fonte','Synthetic source','periodoFonte','2026-10-01','motivo',reason)$$;
create function pg_temp.draft(unit text,n integer,version integer,input jsonb,op text) returns jsonb language sql as $$
 select public.save_position_draft(pg_temp.ctx('actor','area_tecnica',unit,pg_temp.ind(n)),pg_temp.fixture('t19-pos-'||unit||'-'||n),version,input,pg_temp.fixture('t19-op-'||op))$$;
create function pg_temp.send(unit text,n integer,version integer,op text) returns jsonb language sql as $$
 select public.submit_position(pg_temp.ctx('actor','area_tecnica',unit,pg_temp.ind(n)),pg_temp.fixture('t19-pos-'||unit||'-'||n),version,pg_temp.fixture('t19-op-'||op))$$;
create function pg_temp.claim(unit text,n integer,version integer,op text) returns jsonb language sql as $$
 select public.start_position_review(pg_temp.ctx('reviewer','revisor_tecnico',unit,pg_temp.ind(n)),pg_temp.fixture('t19-pos-'||unit||'-'||n),version,pg_temp.fixture('t19-op-'||op))$$;
create function pg_temp.review(unit text,n integer,version integer,decision text,reason text,op text) returns jsonb language sql as $$
 select public.review_position(pg_temp.ctx('reviewer','revisor_tecnico',unit,pg_temp.ind(n)),pg_temp.fixture('t19-pos-'||unit||'-'||n),version,decision,reason,pg_temp.fixture('t19-op-'||op))$$;
create function pg_temp.decide(unit text,n integer,version integer,op text) returns jsonb language sql as $$
 select public.decide_unavailability(pg_temp.ctx('cam','cam',unit,pg_temp.ind(n)),pg_temp.fixture('t19-pos-'||unit||'-'||n),version,'T19-REF','Synthetic CAM decision',pg_temp.fixture('t19-op-'||op))$$;
create function pg_temp.result_of(p_revision uuid) returns public.resultados language sql security definer set search_path='' as $$select r from public.resultados r where r.revisao_id=p_revision$$;

-- Discovery: academic rows carry the model and the competence state.
select pg_temp.login_as('actor');set local role authenticated;
select is((select jsonb_agg(distinct jsonb_build_object('modelo',c->'modelo','competenciaEstado',c->'competenciaEstado')) from jsonb_array_elements(public.get_authorized_contexts()->'contexts')c where c->>'competenciaId'=pg_temp.fixture('t19-cycle')::text),
 '[{"modelo":3,"competenciaEstado":"aberta"}]'::jsonb,'model-3 contexts are discovered with their model and competence state');
select is((select jsonb_agg(distinct jsonb_build_object('modelo',c->'modelo','competenciaEstado',c->'competenciaEstado')) from jsonb_array_elements(public.get_authorized_contexts()->'contexts')c where c->>'competenciaId'=pg_temp.fixture('competence')::text),
 '[{"modelo":2,"competenciaEstado":"aberta"}]'::jsonb,'model-2 contexts keep model 2');
select is((select count(*)::integer from jsonb_array_elements(public.get_authorized_contexts()->'contexts')c where c->>'competenciaId'=pg_temp.fixture('t19-cycle')::text and c->>'role'='area_tecnica'),9,'one technical context per linked indicator and unit with a position');

-- DEMO-01 limits (review focus 4) and the exact meta/weight result.
select throws_ok($$select pg_temp.draft('alfa',1,1,pg_temp.input('valor','100.01'),'alfa-1-over')$$,'22023','invalid_input','DEMO-01 = 100.01 is above the maximum');
select throws_ok($$select pg_temp.draft('alfa',1,1,pg_temp.input('valor','90.123'),'alfa-1-places')$$,'22023','invalid_input','DEMO-01 = 90.123 has more than 2 decimal places');
select throws_ok($$select pg_temp.draft('alfa',1,1,pg_temp.input('valor','90,123'),'alfa-1-comma')$$,'22023','invalid_input','DEMO-01 = 90,123 has more than 2 decimal places');
select is(pg_temp.draft('alfa',1,1,pg_temp.input('valor','100'),'alfa-1-max')->>'version','2','DEMO-01 = 100 is accepted at the maximum');
select is(pg_temp.draft('alfa',1,2,pg_temp.input('valor','90'),'alfa-1-save')->>'version','3','DEMO-01 = 90 is saved');
select is(pg_temp.send('alfa',1,3,'alfa-1-send')-'revisionId',jsonb_build_object('resourceId',pg_temp.fixture('t19-pos-alfa-1'),'version',4,'status','enviada','resultValue','28.42'),
 'submitting DEMO-01 = 90 returns 28.42 points');
select is((public.get_position_detail(pg_temp.ctx('actor','area_tecnica','alfa',pg_temp.ind(1)),pg_temp.fixture('t19-pos-alfa-1'))->'memories'->0)-'revisionId',
 jsonb_build_object('ruleVersion',1,'method','meta_peso','factor',null,'inputValue','90','resultValue','28.42'),'position detail names the meta/weight method and has no factor');
select is(pg_temp.draft('beta',1,1,pg_temp.input('valor','100'),'beta-1-save')->>'version','2','DEMO-01 = 100 saves in another unit');
select is(pg_temp.send('beta',1,2,'beta-1-send')->>'resultValue','30','DEMO-01 = 100 is sent and scores the full weight');

-- DEMO-02 is an integer indicator; the correction path validates too.
select throws_ok($$select pg_temp.draft('alfa',2,1,pg_temp.input('valor','20.5'),'alfa-2-places')$$,'22023','invalid_input','DEMO-02 = 20.5 is rejected (integer)');
select is(pg_temp.draft('alfa',2,1,pg_temp.input('valor','16.0'),'alfa-2-save')->>'version','2','DEMO-02 = 16.0 is the integer 16');
select is(pg_temp.send('alfa',2,2,'alfa-2-send')->>'resultValue','20','DEMO-02 = 16 scores 20');

-- Not applicable: no value, reason required at submission.
select throws_ok($$select pg_temp.draft('alfa',3,1,pg_temp.input('nao_aplicavel','5','Synthetic reason'),'alfa-3-value')$$,'22023','invalid_input','not applicable never carries a value');
select is(pg_temp.draft('alfa',3,1,pg_temp.input('nao_aplicavel',null),'alfa-3-empty')->>'version','2','not applicable without reason can remain a draft');
select throws_ok($$select pg_temp.send('alfa',3,2,'alfa-3-send-empty')$$,'22023','invalid_input','not applicable without reason is not sent');
select is(pg_temp.draft('alfa',3,2,pg_temp.input('nao_aplicavel',null,'Synthetic: not applicable here'),'alfa-3-save')->>'version','3','not applicable with reason is saved');
select is(pg_temp.send('alfa',3,3,'alfa-3-send')-'revisionId',jsonb_build_object('resourceId',pg_temp.fixture('t19-pos-alfa-3'),'version',4,'status','enviada','resultValue',null),'not applicable with reason is sent without points');
select is(pg_temp.draft('beta',3,1,pg_temp.input('indisponivel',null,'Synthetic: source down'),'beta-3-save')->>'version','2','unavailable is saved on model 3');
select is(pg_temp.send('beta',3,2,'beta-3-send')->>'resultValue',null,'unavailable is sent without points on model 3');

-- A model-3 position whose rule is not the set item rule.
select throws_ok($$select pg_temp.send('gama',1,1,'gama-1-send')$$,'22023','rule_unavailable','model-3 rule that is not the set item rule is unavailable');

-- Model 2 keeps its states and rejects meta/weight rules.
select throws_ok($$select public.save_position_draft(pg_temp.ctx('actor','area_tecnica','m2-draft','c0de0000-0000-4000-8000-000000000002','competence'),pg_temp.fixture('t19-pos-m2-draft'),1,pg_temp.input('nao_aplicavel',null,'Synthetic reason'),pg_temp.fixture('t19-op-m2-na-draft'))$$,
 '22023','invalid_input','model-2 drafts reject not applicable');
select is(public.save_position_draft(pg_temp.ctx('actor','area_tecnica','m2-meta',pg_temp.ind(1),'competence'),pg_temp.fixture('t19-pos-m2-meta'),1,pg_temp.input('valor','10'),pg_temp.fixture('t19-op-m2-meta-save'))->>'version','2','model-2 draft on a meta/weight rule is kept');
select throws_ok($$select public.submit_position(pg_temp.ctx('actor','area_tecnica','m2-meta',pg_temp.ind(1),'competence'),pg_temp.fixture('t19-pos-m2-meta'),2,pg_temp.fixture('t19-op-m2-meta-send'))$$,
 '22023','rule_unavailable','model-2 position with a meta/weight rule is unavailable');
reset role;

-- R-2: stored memory is the scoring output plus revision, set, mode and effective weight.
select is((pg_temp.result_of(r.id)).valor,28.42::numeric,'result value stores the rounded points')
 from public.revisoes_entrada r join public.entradas e on e.revisao_atual_id=r.id where e.posicao_id=pg_temp.fixture('t19-pos-alfa-1');
select is((pg_temp.result_of(r.id)).memoria->>'ratio','0.9473684211','memory ratio is 90 ÷ 95 with 10 places')
 from public.revisoes_entrada r join public.entradas e on e.revisao_atual_id=r.id where e.posicao_id=pg_temp.fixture('t19-pos-alfa-1');
select is((pg_temp.result_of(r.id)).memoria,
 private.calcular_pontos(g,30,90)||jsonb_build_object('revisionId',r.id,'ruleSetId',pg_temp.fixture('t19-set'),'ruleSetVersion',1,'mode','zero','effectiveWeight','30'),'memory carries the scoring output, revision, set, version, mode and effective weight')
 from public.revisoes_entrada r join public.entradas e on e.revisao_atual_id=r.id cross join public.regras g
 where e.posicao_id=pg_temp.fixture('t19-pos-alfa-1') and g.id=pg_temp.fixture('t19-rule-1');
select is((pg_temp.result_of(r.id)).regra_id,pg_temp.fixture('t19-rule-1'),'result references the set item rule')
 from public.revisoes_entrada r join public.entradas e on e.revisao_atual_id=r.id where e.posicao_id=pg_temp.fixture('t19-pos-alfa-1');
select is((select count(*)::integer from public.resultados s join public.entradas e on e.id=s.entrada_id where e.posicao_id in (pg_temp.fixture('t19-pos-alfa-3'),pg_temp.fixture('t19-pos-beta-3'))),0,'states without value store no result');
select is((select memoria->>'exactPoints' from public.resultados s join public.entradas e on e.id=s.entrada_id where e.posicao_id=pg_temp.fixture('t19-pos-alfa-2')),'20','DEMO-02 = 16 memory keeps the exact points');

-- Review, correction and CAM decisions on model 3.
select pg_temp.login_as('reviewer');set local role authenticated;
select is(pg_temp.claim('alfa',2,3,'alfa-2-claim')->>'status','em_revisao','reviewer claims DEMO-02');
select is(pg_temp.review('alfa',2,4,'return','Synthetic: check the routine count','alfa-2-return')->>'status','devolvida','reviewer returns DEMO-02');
select pg_temp.login_as('actor');
select throws_ok($$select public.correct_position(pg_temp.ctx('actor','area_tecnica','alfa',pg_temp.ind(2)),pg_temp.fixture('t19-pos-alfa-2'),5,pg_temp.input('valor','20.5','Synthetic correction')||'{"explanation":"Synthetic explanation"}',pg_temp.fixture('t19-op-alfa-2-fix-bad'))$$,
 '22023','invalid_input','correction with DEMO-02 = 20.5 is rejected');
-- R-25: a model-3 correction carries its explanation inside the input.
select throws_ok($$select public.correct_position(pg_temp.ctx('actor','area_tecnica','alfa',pg_temp.ind(2)),pg_temp.fixture('t19-pos-alfa-2'),5,pg_temp.input('valor','20','Synthetic correction'),pg_temp.fixture('t19-op-alfa-2-fix-none'))$$,
 '22023','invalid_input','a model-3 correction without an explanation is rejected');
select is(public.correct_position(pg_temp.ctx('actor','area_tecnica','alfa',pg_temp.ind(2)),pg_temp.fixture('t19-pos-alfa-2'),5,pg_temp.input('valor','20','Synthetic correction')||'{"explanation":" Synthetic explanation "}',pg_temp.fixture('t19-op-alfa-2-fix'))->>'resultValue','25','correction with DEMO-02 = 20 scores 25');
select is((select r->>'correctionExplanation' from jsonb_array_elements(public.get_position_detail(pg_temp.ctx('actor','area_tecnica','alfa',pg_temp.ind(2)),pg_temp.fixture('t19-pos-alfa-2'))->'revisions')r where (r->>'number')::integer=2),
 'Synthetic explanation','the trimmed explanation is stored on the new revision');
select pg_temp.login_as('cam');
select throws_ok($$select pg_temp.decide('alfa',3,4,'alfa-3-early')$$,'55000','invalid_state','CAM cannot decide not applicable before the technical acceptance');
select pg_temp.login_as('reviewer');
select is(pg_temp.claim('alfa',1,4,'alfa-1-claim')->>'status','em_revisao','reviewer claims DEMO-01');
select is(pg_temp.review('alfa',1,5,'accept','','alfa-1-accept')->>'resultValue','28.42','accepting DEMO-01 keeps its points');
select is(pg_temp.claim('alfa',3,4,'alfa-3-claim')->>'status','em_revisao','reviewer claims not applicable');
select is(pg_temp.review('alfa',3,5,'accept','','alfa-3-accept')->>'status','validada','reviewer accepts not applicable');
select is(pg_temp.claim('beta',3,3,'beta-3-claim')->>'status','em_revisao','reviewer claims unavailable');
select is(pg_temp.review('beta',3,4,'accept','','beta-3-accept')->>'status','validada','reviewer accepts unavailable');
select pg_temp.login_as('cam');
select is(pg_temp.decide('alfa',3,6,'alfa-3-decide')-'revisionId',jsonb_build_object('resourceId',pg_temp.fixture('t19-pos-alfa-3'),'version',7,'status','validada','resultValue',null),'CAM decides not applicable on model 3');
select throws_ok($$select pg_temp.decide('alfa',3,7,'alfa-3-again')$$,'55000','invalid_state','not applicable is decided only once');
select is(pg_temp.decide('beta',3,5,'beta-3-decide')->>'status','validada','CAM still decides unavailable on model 3');
select throws_ok($$select public.decide_unavailability(pg_temp.ctx('cam','cam','m2-na','c0de0000-0000-4000-8000-000000000002','competence'),pg_temp.fixture('t19-pos-m2-na'),1,'T19-REF','Synthetic CAM decision',pg_temp.fixture('t19-op-m2-na-decide'))$$,
 '55000','invalid_state','model-2 not applicable cannot be decided');
reset role;
select is((select d.tipo from public.decisoes_entrada d join public.entradas e on e.revisao_atual_id=d.revisao_id where e.posicao_id=pg_temp.fixture('t19-pos-alfa-3') and d.ator_id=pg_temp.fixture('cam')),'decidir_indisponibilidade','the CAM decision is recorded on the current revision');

-- The unit score sees the decided not-applicable item.
create function pg_temp.items(p_unit text,p_key text) returns jsonb language sql as $$
 select jsonb_agg(i->p_key order by i->>'code') from jsonb_array_elements(private.pontuacao_unidade(pg_temp.fixture('t19-cycle'),pg_temp.fixture('t19-'||p_unit))->'items')i$$;
select is(pg_temp.items('alfa','state'),'["valor","pendente","nao_aplicavel","pendente"]','unit score shows the decided not-applicable state');
select is(pg_temp.items('alfa','points'),'["28.42",null,"0",null]','accepted DEMO-01 scores 28.42 and not applicable scores 0 in zero mode');
select is(pg_temp.items('beta','state'),'["pendente","pendente","indisponivel","pendente"]','unit score shows the decided unavailable state');

select ok(not has_function_privilege(r.role,'private.check_rule_value(public.regras,numeric)','EXECUTE') and not has_function_privilege(r.role,'private.authorized_context_rows()','EXECUTE'),r.role||' cannot execute the internal helpers')
 from (values('public'),('anon'),('authenticated'),('service_role'))r(role);

select * from finish();rollback;
