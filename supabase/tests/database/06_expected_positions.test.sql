begin;
select no_plan();
\ir ../support/academic-fixture.psql
insert into public.contas_demo(ator_id,rotulo) values(pg_temp.fixture('actor'),'Synthetic account');
update public.vinculos set indicador_id='c0de0000-0000-4000-8000-000000000002',vigencia_inicio=current_date-1 where actor_id=pg_temp.fixture('actor');
-- This test's six expected positions start without entries; never confuse absence with zero.
delete from public.revisoes_entrada where id=pg_temp.fixture('draft');
-- Sent rows are immutable, so use a distinct empty month instead of altering history.
insert into public.competencias(id,codigo,referencia,estado,modelo) values(pg_temp.fixture('empty_month'),'ACADEMIC-EMPTY',date '2026-10-01','aberta',2);
insert into public.escopos(id,codigo,tipo) select pg_temp.fixture('target-'||n),'ACADEMIC-'||n,case when n<=4 then 'unidade' else 'distrito' end from generate_series(1,6) n;
insert into public.posicoes_esperadas(id,competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id)
select pg_temp.fixture('pos-'||n),pg_temp.fixture('empty_month'),'c0de0000-0000-4000-8000-000000000002',pg_temp.fixture('target-'||n),'c0de0000-0000-4000-8000-000000000004',pg_temp.fixture('actor'),pg_temp.fixture('reviewer') from generate_series(1,6) n;
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio)
select pg_temp.fixture('actor'),'cam',pg_temp.fixture('target-'||n),'c0de0000-0000-4000-8000-000000000002',current_date-1 from generate_series(1,6) n;
create function pg_temp.ctx(p_role text,p_target integer default 1) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('vinculoId',v.id,'competenciaId',pg_temp.fixture('empty_month'),'indicadorId',v.indicador_id) from public.vinculos v where actor_id=pg_temp.fixture('actor') and papel=p_role and escopo_id=pg_temp.fixture('target-'||p_target);
$$;
select pg_temp.login_as('actor');
set local role authenticated;
select is((public.get_operational_positions(pg_temp.ctx('cam'),'{"page":1,"pageSize":25}')->>'total')::integer,6,'counts_expected_even_without_entry');
select is((select count(*)::integer from jsonb_array_elements(public.get_operational_positions(pg_temp.ctx('cam'),'{"page":1,"pageSize":25}')->'items') x where x->>'status'='ausente'),6,'all six expected positions remain absent, not zero');
select is(public.get_position_detail(pg_temp.ctx('cam'),pg_temp.fixture('pos-6'))->'position'->>'status','ausente','CAM detail follows explicit cycle coverage');
reset role;
update public.vinculos set ativo=false where actor_id=pg_temp.fixture('actor') and papel='cam' and escopo_id<>pg_temp.fixture('target-1');
set local role authenticated;
select is((public.get_operational_positions(pg_temp.ctx('cam'),'{"page":1,"pageSize":25}')->>'total')::integer,1,'partial CAM cannot inherit territory or other roles');
select throws_ok($$select public.get_position_detail(pg_temp.ctx('cam'),pg_temp.fixture('pos-6'))$$,'42501',null,'partial CAM cannot inspect an uncovered position');
reset role;
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio) select pg_temp.fixture('actor'),r,pg_temp.fixture('target-1'),'c0de0000-0000-4000-8000-000000000002',current_date-1 from unnest(array['area_tecnica','administrador']) r;
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio) values(pg_temp.fixture('actor'),'lideranca',pg_temp.fixture('target-5'),'c0de0000-0000-4000-8000-000000000002',current_date-1);
insert into public.territorios_competencia values(pg_temp.fixture('empty_month'),pg_temp.fixture('target-1'),pg_temp.fixture('target-5'));
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio) values(pg_temp.fixture('actor'),'revisor_tecnico',pg_temp.fixture('target-2'),'c0de0000-0000-4000-8000-000000000002',current_date-1);
update public.posicoes_esperadas set informante_id=pg_temp.fixture('reviewer'),revisor_id=pg_temp.fixture('actor') where id=pg_temp.fixture('pos-2');
set local role authenticated;
select is((public.get_operational_positions(pg_temp.ctx('area_tecnica'),'{"page":1,"pageSize":25}')->>'total')::integer,1,'technical North does not read South or union its CAM role');
select throws_ok($$select public.get_position_detail(pg_temp.ctx('area_tecnica'),pg_temp.fixture('pos-2'))$$,'42501',null,'technical detail outside exact assignment denied');
select is((public.get_operational_positions(pg_temp.ctx('revisor_tecnico',2),'{"page":1,"pageSize":25}')->>'total')::integer,1,'reviewer reads only its assigned target, not technical or CAM union');
select throws_ok($$select public.get_position_detail(pg_temp.ctx('revisor_tecnico',2),pg_temp.fixture('pos-1'))$$,'42501',null,'reviewer cannot inspect unassigned target');
select throws_ok($$select public.get_operational_positions(pg_temp.ctx('administrador'),'{"page":1,"pageSize":25}')$$,'42501',null,'admin cannot read operational positions');
select throws_ok($$select public.get_operational_positions(pg_temp.ctx('lideranca',5),'{"page":1,"pageSize":25}')$$,'42501',null,'leadership cannot read operational positions');
select is((public.get_operational_positions(pg_temp.ctx('cam'),'{"page":2,"pageSize":1}')->>'total')::integer,1,'pagination preserves filtered total');
select is(jsonb_array_length(public.get_operational_positions(pg_temp.ctx('cam'),'{"page":2,"pageSize":1}')->'items'),0,'page beyond end has no phantom rows');
select is((public.get_operational_positions(pg_temp.ctx('cam'),'{"search":"no-such-scope"}')->>'total')::integer,0,'search filters authorized scope codes');
select throws_ok($$select public.get_operational_positions(pg_temp.ctx('cam'),'{"page":0,"pageSize":25}')$$,'22023',null,'invalid pagination rejected');
select throws_ok($$select public.get_operational_positions(pg_temp.ctx('cam'),'{"status":"unknown"}')$$,'22023',null,'unknown workflow status rejected');
reset role;
update public.escopos set ativo=false where id=pg_temp.fixture('target-1');
set local role authenticated;
select is((public.get_operational_positions(pg_temp.ctx('cam'),'{"page":1,"pageSize":25}')->>'total')::integer,1,'inactive catalog does not erase existing authorized history');
reset role;
update public.entradas set revisao_atual_id=pg_temp.fixture('revision'),estado='enviada' where id=pg_temp.fixture('entry');
insert into public.resultados(entrada_id,regra_id,revisao_id,valor,memoria) values(pg_temp.fixture('entry'),'c0de0000-0000-4000-8000-000000000004',pg_temp.fixture('revision'),0.00008,'{"synthetic":true}');
create function pg_temp.original_ctx() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('vinculoId',v.id,'competenciaId',pg_temp.fixture('competence'),'indicadorId',v.indicador_id) from public.vinculos v where actor_id=pg_temp.fixture('actor') and papel='area_tecnica' and escopo_id=pg_temp.fixture('unit');
$$;
set local role authenticated;
select is(public.get_position_detail(pg_temp.original_ctx(),pg_temp.fixture('position'))->'position'->>'resultValue','0.00008','detail preserves exact product decimal text');
select is(public.get_position_detail(pg_temp.original_ctx(),pg_temp.fixture('position'))->'memories'->0->>'factor','0.8','memory uses rule fixed to persisted result');
select is(jsonb_array_length(public.get_position_detail(pg_temp.original_ctx(),pg_temp.fixture('position'))->'revisions'),1,'detail includes only this position revisions');
select ok(not has_function_privilege('authenticated','private.operational_position_rows(jsonb)','execute'),'browser cannot bypass guarded projection');
reset role;
select * from finish();
rollback;
