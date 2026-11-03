begin;
select no_plan();
\ir ../support/academic-fixture.psql
-- Synthetic DEMO rule set built here: weights 30/25/25/20, targets 95/20/48/12,
-- directions up/up/down/up, decimals 2/0/2/0, maxima 100/1000/8760/1000.
insert into auth.users(id,email,aud,role) values
 (pg_temp.fixture('cam'),'t20-cam@example.invalid','authenticated','authenticated'),
 (pg_temp.fixture('cam-partial'),'t20-cam-partial@example.invalid','authenticated','authenticated');
insert into public.contas_demo(ator_id,rotulo) select pg_temp.fixture(who),'T20 '||who from unnest(array['actor','reviewer','cam','cam-partial'])who;
insert into public.indicadores(id,codigo) select pg_temp.fixture('t20-ind-'||n),'T20-DEMO-0'||n from generate_series(1,4)n;
insert into public.regras(id,indicador_id,versao,metodo,meta,direcao,casas_decimais,valor_maximo,unidade_medida,nome,vigencia_inicio)
 select pg_temp.fixture('t20-rule-'||n),pg_temp.fixture('t20-ind-'||n),1,'meta_peso',m,d,c,x,'u','T20 DEMO '||n,'2026-01-01'
 from (values(1,95,'maior_melhor',2,100),(2,20,'maior_melhor',0,1000),(3,48,'menor_melhor',2,8760),(4,12,'maior_melhor',0,1000))v(n,m,d,c,x);
insert into public.conjuntos_regra(id,codigo,versao,modo_ausencia,sintetico,vigencia_inicio,referencia) values
 (pg_temp.fixture('t20-set'),'T20-DEMO',1,'zero',true,'2026-01-01','T20 synthetic');
insert into public.itens_conjunto(conjunto_id,indicador_id,regra_id,peso)
 select pg_temp.fixture('t20-set'),pg_temp.fixture('t20-ind-'||n),pg_temp.fixture('t20-rule-'||n),w from (values(1,30),(2,25),(3,25),(4,20))v(n,w);
select lives_ok('set constraints all immediate','synthetic DEMO rule set totals 100');
insert into public.competencias(id,codigo,referencia,estado,modelo,conjunto_id) values
 (pg_temp.fixture('t20-sep'),'T20-2026-09','2026-09-01','aberta',3,pg_temp.fixture('t20-set')),
 (pg_temp.fixture('t20-r10'),'T20-2026-08','2026-08-01','aberta',3,pg_temp.fixture('t20-set'));
insert into public.escopos(id,codigo,tipo,distrito_id) select pg_temp.fixture('t20-'||u),'T20-'||upper(u),'unidade',pg_temp.fixture('district') from unnest(array['alfa','beta','gama','delta'])u;
insert into public.territorios_competencia(competencia_id,unidade_id,distrito_id)
 select pg_temp.fixture(c),pg_temp.fixture('t20-'||u),pg_temp.fixture('district') from unnest(array['t20-sep','t20-r10'])c cross join unnest(array['alfa','beta','gama','delta'])u;
-- 4 units x 4 indicators. One CAM holds all 16 links; a second CAM lacks DEMO-04.
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio)
 select pg_temp.fixture(who),role,pg_temp.fixture('t20-'||u),pg_temp.fixture('t20-ind-'||n),current_date-1
 from unnest(array['alfa','beta','gama','delta'])u cross join generate_series(1,4)n cross join (values('actor','area_tecnica'),('reviewer','revisor_tecnico'),('cam','cam'))a(who,role);
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio)
 select pg_temp.fixture('cam-partial'),'cam',pg_temp.fixture('t20-'||u),pg_temp.fixture('t20-ind-'||n),current_date-1
 from unnest(array['alfa','beta','gama','delta'])u cross join generate_series(1,3)n;
insert into public.posicoes_esperadas(id,competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id)
 select pg_temp.fixture('t20-pos-'||u||'-'||n),pg_temp.fixture('t20-sep'),pg_temp.fixture('t20-ind-'||n),pg_temp.fixture('t20-'||u),pg_temp.fixture('t20-rule-'||n),pg_temp.fixture('actor'),pg_temp.fixture('reviewer')
 from unnest(array['alfa','beta','gama','delta'])u cross join generate_series(1,4)n;

create function pg_temp.ctx(who text,role text,unit text,n integer,cycle text default 't20-sep') returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('vinculoId',id,'competenciaId',pg_temp.fixture(cycle),'indicadorId',indicador_id) from public.vinculos
 where actor_id=pg_temp.fixture(who) and papel=role and escopo_id=pg_temp.fixture('t20-'||unit) and indicador_id=pg_temp.fixture('t20-ind-'||n)$$;
create function pg_temp.cam(who text default 'cam',cycle text default 't20-sep') returns jsonb language sql as $$select pg_temp.ctx(who,'cam','alfa',1,cycle)$$;
create function pg_temp.checklist(who text default 'cam',cycle text default 't20-sep') returns jsonb language sql as $$select public.get_cycle_checklist(pg_temp.cam(who,cycle))$$;
create function pg_temp.pos(unit text,n integer) returns uuid language sql as $$select pg_temp.fixture('t20-pos-'||unit||'-'||n)$$;
create function pg_temp.pos_version(unit text,n integer) returns integer language sql security definer set search_path='' as $$select lock_version from public.posicoes_esperadas where id=pg_temp.pos(unit,n)$$;
create function pg_temp.blocker(c jsonb,unit text,n integer) returns text language sql as $$select b->>'code' from jsonb_array_elements(c->'blockers')b where b->>'positionId'=pg_temp.pos(unit,n)::text$$;
-- Real workflow per position: draft, submit, claim and accept.
create function pg_temp.fill(unit text,n integer,state text,value text) returns void language plpgsql as $$
declare r jsonb;
begin
 perform pg_temp.login_as('actor');
 r:=public.save_position_draft(pg_temp.ctx('actor','area_tecnica',unit,n),pg_temp.pos(unit,n),1,jsonb_build_object('estadoDado',state,'valor',value,'fonte','Synthetic T20','periodoFonte','2026-09-01',
  'motivo',case when state='valor' then '' else 'Synthetic: not applicable here' end),gen_random_uuid());
 r:=public.submit_position(pg_temp.ctx('actor','area_tecnica',unit,n),pg_temp.pos(unit,n),(r->>'version')::integer,gen_random_uuid());
 perform pg_temp.login_as('reviewer');
 r:=public.start_position_review(pg_temp.ctx('reviewer','revisor_tecnico',unit,n),pg_temp.pos(unit,n),(r->>'version')::integer,gen_random_uuid());
 perform public.review_position(pg_temp.ctx('reviewer','revisor_tecnico',unit,n),pg_temp.pos(unit,n),(r->>'version')::integer,'accept','',gen_random_uuid());
end;$$;
create function pg_temp.transition(action text,reason text default '',reference text default '') returns jsonb language sql as $$
 select public.transition_cycle(pg_temp.cam(),(pg_temp.checklist()->>'version')::integer,action,reason,reference,gen_random_uuid())$$;

-- Coverage: model 3 CAM cycle reads span every indicator of the set.
select pg_temp.login_as('cam');
select is(jsonb_array_length(private.require_academic_context(pg_temp.cam(),'cycle_read')->'positionIds'),16,'CAM cycle context gathers the positions of all set indicators');
select is(jsonb_array_length(private.require_academic_context(pg_temp.cam(),'decide_unavailability')->'positionIds'),1,'CAM position commands keep the context indicator and scope');
set local role authenticated;
select is(pg_temp.checklist()->'fullCoverage','true','one CAM linked to the 4 indicators has full coverage');
select is(pg_temp.checklist()->'expected','16','the checklist covers 4 units x 4 indicators');
select is(pg_temp.checklist()->'ready','0','nothing is ready before the flow');
select pg_temp.login_as('cam-partial');
select is(pg_temp.checklist('cam-partial')->'fullCoverage','false','a CAM without DEMO-04 links lacks full coverage');
select is(pg_temp.checklist('cam-partial')->'expected','12','that CAM sees only its 12 positions');

-- September values; Delta DEMO-04 is reported as not applicable.
select pg_temp.fill(u,n,'valor',v) from (values
 ('alfa',1,'88'),('alfa',2,'18'),('alfa',3,'60'),('alfa',4,'11'),
 ('beta',1,'96'),('beta',2,'20'),('beta',3,'40'),('beta',4,'12'),
 ('gama',1,'90'),('gama',2,'19'),('gama',3,'36'),('gama',4,'12'),
 ('delta',1,'85'),('delta',2,'17'),('delta',3,'52'))x(u,n,v);
select pg_temp.fill('delta',4,'nao_aplicavel',null);
select pg_temp.login_as('cam');
select is(pg_temp.checklist()->'ready','15','accepted values are ready; undecided not applicable is not');
select is(pg_temp.checklist()->'unavailable','1','not applicable counts as a state without value');
select is(pg_temp.checklist()->'decidedUnavailable','0','not applicable is still undecided');
select is(pg_temp.transition('consolidate')->>'status','em_consolidacao','model-3 cycle consolidates with every position received');
select is(pg_temp.checklist()->'canClose','false','undecided not applicable blocks closing');
select is(pg_temp.blocker(pg_temp.checklist(),'delta',4),'unavailability_pending','the blocker names the undecided not-applicable position');
select is(jsonb_array_length(pg_temp.checklist()->'blockers'),1,'stored meta/weight memories match calcular_pontos');
select throws_ok($$select pg_temp.transition('close','','DEMO-DECISAO-T20')$$,'55000','invalid_state','close is refused while a decision is pending');
select is(pg_temp.transition('reopen','Synthetic: CAM decision pending')->>'status','aberta','CAM reopens to decide');
select is(public.decide_unavailability(pg_temp.ctx('cam','cam','delta',4),pg_temp.pos('delta',4),pg_temp.pos_version('delta',4),'DEMO-T20-NA','Synthetic CAM decision',gen_random_uuid())->>'status','validada','CAM decides the not-applicable position');
select is(pg_temp.transition('consolidate')->>'status','em_consolidacao','cycle consolidates again');
select is(pg_temp.checklist()-'version'-'snapshotId'-'publicationId',jsonb_build_object('state','em_consolidacao','expected',16,'received',16,'reviewed',16,'unavailable',1,'decidedUnavailable',1,'notApplicable',0,
 'fullCoverage',true,'canConsolidate',false,'canClose',true,'publication','nao_publicada','blockers','[]'::jsonb,'ready',16),'all 16 positions are ready to close');
select pg_temp.login_as('cam-partial');
select throws_ok($$select public.transition_cycle(pg_temp.cam('cam-partial'),(pg_temp.checklist('cam-partial')->>'version')::integer,'close','','DEMO-DECISAO-T20',gen_random_uuid())$$,'42501','access_denied','a partial CAM cannot close');
select pg_temp.login_as('cam');
select is(pg_temp.transition('close','Synthetic only','DEMO-DECISAO-T20')->>'status','fechada','full-coverage CAM closes the model-3 cycle');
reset role;

-- Frozen unit scores and calculation inputs.
create function pg_temp.snapshot() returns uuid language sql security definer set search_path='' as $$select id from public.fechamentos where competencia_id=pg_temp.fixture('t20-sep')$$;
create function pg_temp.scores() returns jsonb language sql as $$select jsonb_object_agg(alvo_codigo,trim_scale(pontos)::text) from public.pontuacoes_fechamento where fechamento_id=pg_temp.snapshot()$$;
select is((select trim_scale(pontos)::text from public.pontuacoes_fechamento where fechamento_id=pg_temp.snapshot() and alvo_id=pg_temp.fixture('t20-alfa')),'88.62','Alfa September is frozen at 88.62');
select is(pg_temp.scores(),'{"T20-ALFA":"88.62","T20-BETA":"100","T20-GAMA":"97.17","T20-DELTA":"71.17"}'::jsonb,'one frozen score per unit');
select is((select jsonb_build_object('complete',completo,'noBase',sem_base,'set',conjunto_id,'version',conjunto_versao,'district',distrito_id) from public.pontuacoes_fechamento where fechamento_id=pg_temp.snapshot() and alvo_id=pg_temp.fixture('t20-alfa')),
 jsonb_build_object('complete',true,'noBase',false,'set',pg_temp.fixture('t20-set'),'version',1,'district',pg_temp.fixture('district')),'unit score freezes completeness, set, version and district');
select is((select trim_scale(pontos)::text from public.itens_fechamento where posicao_id=pg_temp.pos('alfa',1)),'27.79','DEMO-01 Alfa item is frozen at 27.79');
select is((select jsonb_build_object('method',metodo,'meta',trim_scale(meta)::text,'direction',direcao,'weight',trim_scale(peso)::text,'effectiveWeight',trim_scale(peso_efetivo)::text,'ratio',trim_scale(razao)::text,
  'set',conjunto_id,'version',conjunto_versao,'mode',modo_ausencia,'input',trim_scale(valor_entrada)::text,'factor',fator) from public.itens_fechamento where posicao_id=pg_temp.pos('alfa',1)),
 jsonb_build_object('method','meta_peso','meta','95','direction','maior_melhor','weight','30','effectiveWeight','30','ratio','0.9263157895','set',pg_temp.fixture('t20-set'),'version',1,'mode','zero','input','88','factor',null),
 'DEMO-01 Alfa item freezes method, target, direction, weights, ratio, set and mode');
select is((select jsonb_build_object('state',estado_dado,'points',trim_scale(pontos)::text,'effectiveWeight',trim_scale(peso_efetivo)::text,'ratio',razao) from public.itens_fechamento where posicao_id=pg_temp.pos('delta',4)),
 jsonb_build_object('state','nao_aplicavel','points','0','effectiveWeight','20','ratio',null),'decided not applicable is frozen with 0 points in zero mode');
select is((select sum(i.pontos) from public.itens_fechamento i where i.fechamento_id=pg_temp.snapshot() and i.alvo_id=pg_temp.fixture('t20-alfa')),88.62::numeric,'frozen unit score is the sum of frozen item points');
select is((select count(*)::integer from public.itens_fechamento where fechamento_id=pg_temp.snapshot()),16,'snapshot holds the 16 positions');

-- Review focus 2: a new set version after closing never changes the closed score.
set constraints all deferred;
insert into public.conjuntos_regra(id,codigo,versao,modo_ausencia,sintetico,vigencia_inicio,referencia) values
 (pg_temp.fixture('t20-set-v2'),'T20-DEMO',2,'zero',true,'2026-10-01','T20 synthetic v2');
insert into public.itens_conjunto(conjunto_id,indicador_id,regra_id,peso)
 select pg_temp.fixture('t20-set-v2'),pg_temp.fixture('t20-ind-'||n),pg_temp.fixture('t20-rule-'||n),w from (values(1,40),(2,20),(3,20),(4,20))v(n,w);
select lives_ok('set constraints all immediate','set version 2 with other weights is created after closing');
select is((select trim_scale(pontos)::text from public.pontuacoes_fechamento where fechamento_id=pg_temp.snapshot() and alvo_id=pg_temp.fixture('t20-alfa')),'88.62','closed Alfa score still reads 88.62');
select throws_ok($$update public.pontuacoes_fechamento set pontos=90 where fechamento_id=pg_temp.snapshot()$$,'55000','immutable_record','frozen unit scores cannot be updated');
select throws_ok($$delete from public.pontuacoes_fechamento where fechamento_id=pg_temp.snapshot()$$,'55000','immutable_record','frozen unit scores cannot be deleted');
select throws_ok($$update public.competencias set conjunto_id=pg_temp.fixture('t20-set-v2') where id=pg_temp.fixture('t20-sep')$$,'55000','closed_cycle_is_immutable','closed competence cannot switch to another set version');
select pg_temp.login_as('cam');set local role authenticated;
select is(public.publish_cycle_demo(pg_temp.cam(),pg_temp.snapshot(),'DEMO-PUBLICACAO-T20',gen_random_uuid())->>'status','publicada_demo','closed model-3 cycle is published');
reset role;
select throws_ok($$update public.competencias set conjunto_id=pg_temp.fixture('t20-set-v2') where id=pg_temp.fixture('t20-sep')$$,'55000','closed_cycle_is_immutable','published competence cannot switch to another set version');
select is(pg_temp.scores()->>'T20-ALFA','88.62','published Alfa score still reads 88.62');

-- Carry-forward: frozen method, direction and mode only take known values.
select throws_ok($$insert into public.itens_fechamento(fechamento_id,posicao_id,alvo_id,regra_id,estado_dado,memoria,metodo) values(pg_temp.snapshot(),pg_temp.fixture('position'),pg_temp.fixture('t20-alfa'),pg_temp.fixture('t20-rule-1'),'nao_aplicavel','{}','media')$$,'23514',null,'unknown frozen method is rejected');
select throws_ok($$insert into public.itens_fechamento(fechamento_id,posicao_id,alvo_id,regra_id,estado_dado,memoria,direcao) values(pg_temp.snapshot(),pg_temp.fixture('position'),pg_temp.fixture('t20-alfa'),pg_temp.fixture('t20-rule-1'),'nao_aplicavel','{}','lateral')$$,'23514',null,'unknown frozen direction is rejected');
select throws_ok($$insert into public.itens_fechamento(fechamento_id,posicao_id,alvo_id,regra_id,estado_dado,memoria,modo_ausencia) values(pg_temp.snapshot(),pg_temp.fixture('position'),pg_temp.fixture('t20-alfa'),pg_temp.fixture('t20-rule-1'),'nao_aplicavel','{}','ignorar')$$,'23514',null,'unknown frozen absence mode is rejected');

-- R-10: acceptance needs a non-author validation of the current revision, and a
-- state without value needs a CAM decision with reason and reference.
-- Planted directly (August, Alfa): 1 accepted with a corrupted memory, 2 validated
-- by its own author, 3 validated with no validation decision, 4 unavailable whose
-- CAM decision has a blank reference.
insert into public.posicoes_esperadas(id,competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id)
 select pg_temp.fixture('t20-r10-pos-'||n),pg_temp.fixture('t20-r10'),pg_temp.fixture('t20-ind-'||n),pg_temp.fixture('t20-alfa'),pg_temp.fixture('t20-rule-'||n),pg_temp.fixture('actor'),pg_temp.fixture('reviewer') from generate_series(1,4)n;
insert into public.entradas(id,competencia_id,indicador_id,escopo_id,autor_id,valor,estado,revisao,operation_id,posicao_id)
 select pg_temp.fixture('t20-r10-entry-'||n),pg_temp.fixture('t20-r10'),pg_temp.fixture('t20-ind-'||n),pg_temp.fixture('t20-alfa'),pg_temp.fixture('actor'),null,'rascunho',1,pg_temp.fixture('t20-r10-op-'||n),pg_temp.fixture('t20-r10-pos-'||n) from generate_series(1,4)n;
insert into public.revisoes_entrada(id,entrada_id,numero,autor_id,estado_dado,valor,origem,periodo_fonte,motivo,enviada_em)
 select pg_temp.fixture('t20-r10-rev-'||n),pg_temp.fixture('t20-r10-entry-'||n),1,pg_temp.fixture('actor'),s,v,'synthetic source','2026-08-01',case when s='valor' then '' else 'synthetic reason' end,now()
 from (values(1,'valor',88),(2,'valor',18),(3,'valor',60),(4,'indisponivel',null))x(n,s,v);
update public.entradas e set revisao_atual_id=pg_temp.fixture('t20-r10-rev-'||n),estado='validada' from generate_series(1,4)n where e.id=pg_temp.fixture('t20-r10-entry-'||n);
insert into public.decisoes_entrada(revisao_id,ator_id,tipo,motivo,referencia) values
 (pg_temp.fixture('t20-r10-rev-1'),pg_temp.fixture('reviewer'),'validar','',null),
 (pg_temp.fixture('t20-r10-rev-2'),pg_temp.fixture('actor'),'validar','',null),
 (pg_temp.fixture('t20-r10-rev-4'),pg_temp.fixture('reviewer'),'validar','',null),
 (pg_temp.fixture('t20-r10-rev-4'),pg_temp.fixture('cam'),'decidir_indisponibilidade','Synthetic CAM decision',' ');
insert into public.resultados(entrada_id,regra_id,valor,memoria,revisao_id) values(pg_temp.fixture('t20-r10-entry-1'),pg_temp.fixture('t20-rule-1'),27.79,'{"synthetic":true}',pg_temp.fixture('t20-r10-rev-1'));
select is((select jsonb_agg(i->>'state' order by i->>'code') from jsonb_array_elements(private.pontuacao_unidade(pg_temp.fixture('t20-r10'),pg_temp.fixture('t20-alfa'))->'items')i),
 '["valor","pendente","pendente","pendente"]'::jsonb,'unit score counts only the non-author validation; blank-reference decision stays pending');
select pg_temp.login_as('cam');set local role authenticated;
select is(pg_temp.checklist('cam','t20-r10')->'ready','1','checklist ready uses the same acceptance predicate');
select is((select jsonb_object_agg(b->>'positionId',b->>'code') from jsonb_array_elements(pg_temp.checklist('cam','t20-r10')->'blockers')b),
 jsonb_build_object(pg_temp.fixture('t20-r10-pos-1'),'rule_inconsistent',pg_temp.fixture('t20-r10-pos-2'),'review_pending',pg_temp.fixture('t20-r10-pos-3'),'review_pending',pg_temp.fixture('t20-r10-pos-4'),'unavailability_pending'),
 'memory differing from calcular_pontos is rule_inconsistent; self or missing validation is review pending; blank-reference decision is pending');
reset role;

-- Model 2 keeps its checklist shape.
select ok(not(private.cycle_checklist(jsonb_build_object('competenciaId',pg_temp.fixture('competence'),'indicadorId','c0de0000-0000-4000-8000-000000000002','positionIds','[]'::jsonb)) ? 'ready'),'model-2 checklist has no ready count');
select ok(not has_function_privilege(r.role,'private.situacao_posicao(uuid)','EXECUTE') and not has_function_privilege(r.role,'private.cycle_positions(jsonb)','EXECUTE'),r.role||' cannot execute the cycle helpers')
 from (values('public'),('anon'),('authenticated'),('service_role'))r(role);

select * from finish();rollback;
