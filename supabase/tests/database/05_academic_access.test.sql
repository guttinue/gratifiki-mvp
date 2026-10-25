begin;
select no_plan();
select has_function('public','get_authorized_contexts',array[]::text[],'server contexts RPC exists');
\ir ../support/academic-fixture.psql
insert into public.contas_demo(ator_id,rotulo) values(pg_temp.fixture('actor'),'Synthetic account');
update public.vinculos set indicador_id='c0de0000-0000-4000-8000-000000000002',vigencia_inicio=current_date-1 where actor_id=pg_temp.fixture('actor');
insert into public.territorios_competencia values(pg_temp.fixture('competence'),pg_temp.fixture('unit'),pg_temp.fixture('district'));
insert into public.escopos(id,codigo,tipo,distrito_id) values(pg_temp.fixture('review_unit'),'TEST-REVIEW-UNIT','unidade',pg_temp.fixture('district'));
insert into public.posicoes_esperadas(competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id)
values(pg_temp.fixture('competence'),'c0de0000-0000-4000-8000-000000000002',pg_temp.fixture('review_unit'),'c0de0000-0000-4000-8000-000000000004',pg_temp.fixture('reviewer'),pg_temp.fixture('actor'));
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio)
select pg_temp.fixture('actor'),r.role,case when r.role in ('gestor_distrital','lideranca') then pg_temp.fixture('district') when r.role='revisor_tecnico' then pg_temp.fixture('review_unit') else pg_temp.fixture('unit') end,
 'c0de0000-0000-4000-8000-000000000002',current_date-1
from (values('revisor_tecnico'),('cam'),('gestor_unidade'),('gestor_distrital'),('administrador'),('lideranca')) r(role);
-- Other provisioned academic months legitimately add catalog contexts to an
-- administrator. These role-count assertions concern this test's own month.
create function pg_temp.fixture_context_count() returns integer language sql as $$
 select count(*)::integer from jsonb_array_elements(public.get_authorized_contexts()->'contexts') c
 where c->>'competenciaId'=pg_temp.fixture('competence')::text;
$$;
select pg_temp.login_as('actor');
set local role authenticated;
select is(pg_temp.fixture_context_count(),7,'seven academic roles are resolved server-side');
select ok(not has_function_privilege('authenticated','private.require_academic_context(jsonb,text)','EXECUTE'),'internal context helper cannot be called by browser');
reset role;
select is((private.require_academic_context(jsonb_build_object('vinculoId',(select id from public.vinculos where actor_id=pg_temp.fixture('actor') and papel='cam'),'competenciaId',pg_temp.fixture('competence'),'indicadorId','c0de0000-0000-4000-8000-000000000002'),'cycle_read')->'scopeIds'),jsonb_build_array(pg_temp.fixture('unit')),'CAM cycle scope is authorized targets, not global');
select throws_ok($$select private.require_academic_context(jsonb_build_object('vinculoId',(select id from public.vinculos where actor_id=pg_temp.fixture('actor') and papel='area_tecnica'),'competenciaId',pg_temp.fixture('competence'),'indicadorId','c0de0000-0000-4000-8000-000000000002','role','cam'),'cycle_read')$$,'42501',null,'forged role is rejected rather than combined with links');
select throws_ok($$select private.require_academic_context(jsonb_build_object('vinculoId',(select id from public.vinculos where actor_id=pg_temp.fixture('actor') and papel='administrador'),'competenciaId',pg_temp.fixture('competence'),'indicadorId','c0de0000-0000-4000-8000-000000000002'),'operational_read')$$,'42501',null,'administrator cannot read operational values');
select throws_ok($$select private.require_academic_context(jsonb_build_object('vinculoId',(select id from public.vinculos where actor_id=pg_temp.fixture('actor') and papel='lideranca'),'competenciaId',pg_temp.fixture('competence'),'indicadorId','c0de0000-0000-4000-8000-000000000002'),'operational_read')$$,'42501',null,'leadership cannot read individual operational values');

create function pg_temp.context_for(p_role text) returns jsonb language sql as $$
 select jsonb_build_object('vinculoId',v.id,'competenciaId',pg_temp.fixture('competence'),'indicadorId',v.indicador_id)
 from public.vinculos v where v.actor_id=pg_temp.fixture('actor') and v.papel=p_role limit 1;
$$;
select lives_ok(format('select private.require_academic_context(%L::jsonb,%L)',pg_temp.context_for(role),capability),role||' has only its declared capability')
from (values ('area_tecnica','draft'),('area_tecnica','operational_audit'),('revisor_tecnico','review'),('revisor_tecnico','operational_audit'),
 ('cam','authorize_correction'),('cam','cycle_transition'),('cam','export'),('cam','operational_audit'),('gestor_unidade','evaluations'),
 ('gestor_distrital','evaluation_history'),('lideranca','aggregate_dashboard'),('lideranca','leadership_aggregates'),
 ('administrador','admin_catalog'),('administrador','admin_write'),('administrador','admin_audit')) allowed(role,capability);
select throws_ok(format('select private.require_academic_context(%L::jsonb,%L)',pg_temp.context_for(role),capability),'42501',null,role||' cannot borrow another role capability')
from (values ('area_tecnica','review'),('revisor_tecnico','draft'),('cam','review'),('gestor_unidade','dashboard'),('gestor_distrital','operational_audit'),
 ('lideranca','evaluation_history'),('lideranca','export'),('administrador','dashboard'),('administrador','evaluations'),('cam','unknown')) denied(role,capability);
select is(private.require_academic_context(pg_temp.context_for('administrador'),'admin_catalog')->'positionIds','[]'::jsonb,'admin catalog has no operational positions');
select is(private.require_academic_context(pg_temp.context_for('lideranca'),'leadership_aggregates')->'scopeIds',jsonb_build_array(pg_temp.fixture('unit')),'leadership includes frozen units but not personal district target');
select is(jsonb_array_length(private.require_academic_context(pg_temp.context_for('gestor_distrital'),'evaluations')->'scopeIds'),2,'district manager has separate own target plus frozen unit territory');
select is(private.require_academic_context(pg_temp.context_for('area_tecnica'),'draft')->'positionIds',jsonb_build_array(pg_temp.fixture('position')),'informante has only explicitly assigned target positions');
select throws_ok($$select private.require_academic_context(pg_temp.context_for('area_tecnica')||jsonb_build_object('competenciaId','c0de0000-0000-4000-8000-000000000001'),'draft')$$,'42501',null,'academic context cannot switch into a legacy competence');
select throws_ok($$select private.require_academic_context(pg_temp.context_for('area_tecnica')||jsonb_build_object('indicadorId',pg_temp.fixture('forged_indicator')),'draft')$$,'42501',null,'forged indicator is denied');
select throws_ok($$select private.require_academic_context(pg_temp.context_for('area_tecnica')||jsonb_build_object('vinculoId','not-a-uuid'),'draft')$$,'42501',null,'invalid context ids fail closed');
select throws_ok($$select private.require_academic_context('{}','draft')$$,'42501',null,'missing context ids fail closed');
select throws_ok($$select private.require_academic_context('[]','draft')$$,'42501',null,'nonobject context fails closed');

update public.escopos set ativo=false where id=pg_temp.fixture('unit');
set local role authenticated;
select is(pg_temp.fixture_context_count(),7,'deactivated existing target does not revoke current-cycle authorized contexts');
reset role;
select is(private.require_academic_context(pg_temp.context_for('area_tecnica'),'draft')->'positionIds',jsonb_build_array(pg_temp.fixture('position')),'current informante can complete an already-open position after catalog deactivation');
select is(private.require_academic_context(pg_temp.context_for('lideranca'),'leadership_aggregates')->'scopeIds',jsonb_build_array(pg_temp.fixture('unit')),'historical frozen unit remains in leadership aggregates after deactivation');
select is(jsonb_array_length(private.require_academic_context(pg_temp.context_for('gestor_distrital'),'evaluations')->'scopeIds'),2,'deactivation does not erase historical district territory');
insert into public.escopos(id,codigo,tipo,ativo) values(pg_temp.fixture('inactive_unassigned'),'TEST-INACTIVE-UNASSIGNED','unidade',false);
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio)
values(pg_temp.fixture('actor'),'area_tecnica',pg_temp.fixture('inactive_unassigned'),'c0de0000-0000-4000-8000-000000000002',current_date-1);
select throws_ok($$select private.require_academic_context(jsonb_build_object('vinculoId',(select id from public.vinculos where actor_id=pg_temp.fixture('actor') and escopo_id=pg_temp.fixture('inactive_unassigned')),'competenciaId',pg_temp.fixture('competence'),'indicadorId','c0de0000-0000-4000-8000-000000000002'),'draft')$$,'42501',null,'inactive scope without existing expected membership creates no academic access');
delete from public.vinculos where escopo_id=pg_temp.fixture('inactive_unassigned');
update public.escopos set ativo=true where id=pg_temp.fixture('unit');

insert into public.escopos(id,codigo,tipo) values(pg_temp.fixture('fake_unit'),'TEST-DISTRICT-NOT-A-UNIT','distrito');
insert into public.posicoes_esperadas(competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id)
values(pg_temp.fixture('competence'),'c0de0000-0000-4000-8000-000000000002',pg_temp.fixture('fake_unit'),'c0de0000-0000-4000-8000-000000000004',pg_temp.fixture('actor'),pg_temp.fixture('reviewer'));
insert into public.territorios_competencia values(pg_temp.fixture('competence'),pg_temp.fixture('fake_unit'),pg_temp.fixture('district'));
select is(private.require_academic_context(pg_temp.context_for('lideranca'),'leadership_aggregates')->'scopeIds',jsonb_build_array(pg_temp.fixture('unit')),'malformed territory cannot turn a personal district target into a unit aggregate');
select is(jsonb_array_length(private.require_academic_context(pg_temp.context_for('gestor_distrital'),'evaluations')->'scopeIds'),2,'district evaluation descendants must be classified units');

-- CAM coverage is explicit target links, never descendants or other roles.
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio)
values(pg_temp.fixture('actor'),'cam',pg_temp.fixture('district'),'c0de0000-0000-4000-8000-000000000002',current_date-1);
select is(jsonb_array_length(private.require_academic_context(pg_temp.context_for('cam'),'cycle_read')->'scopeIds'),2,'cycle union includes only both explicit CAM targets');
select is(jsonb_array_length(private.require_academic_context(jsonb_build_object('vinculoId',(select id from public.vinculos where actor_id=pg_temp.fixture('actor') and papel='cam' and escopo_id=pg_temp.fixture('district')),'competenciaId',pg_temp.fixture('competence'),'indicadorId','c0de0000-0000-4000-8000-000000000002'),'operational_read')->'scopeIds'),1,'CAM district operational link does not cover descendant units');
delete from public.vinculos where actor_id=pg_temp.fixture('actor') and papel='cam' and escopo_id=pg_temp.fixture('district');

insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio)
values(pg_temp.fixture('actor'),'revisor_tecnico',pg_temp.fixture('unit'),'c0de0000-0000-4000-8000-000000000002',current_date-1);
set local role authenticated;
select is(pg_temp.fixture_context_count(),7,'self-review link creates no extra authorized choice');
reset role;
delete from public.vinculos where actor_id=pg_temp.fixture('actor') and papel='revisor_tecnico' and escopo_id=pg_temp.fixture('unit');
update public.vinculos set vigencia_inicio=current_date+1 where actor_id=pg_temp.fixture('actor') and papel='lideranca';
set local role authenticated;
select is(pg_temp.fixture_context_count(),6,'future link is not yet authorized');
reset role;
update public.vinculos set vigencia_inicio=current_date-1 where actor_id=pg_temp.fixture('actor') and papel='lideranca';

-- Legacy replay and reads cannot recover an academic result, even for an actor
-- that holds both modes. Revocation is checked before idempotent cache lookup.
insert into public.resultados(entrada_id,regra_id,revisao_id,valor,memoria)
values(pg_temp.fixture('entry'),'c0de0000-0000-4000-8000-000000000004',pg_temp.fixture('revision'),0.00008,'{"ruleVersion":1}');
insert into public.vinculos(actor_id,papel,escopo_id)
values(pg_temp.fixture('actor'),'area_tecnica','c0de0000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok($$select public.submit_demo_entry('c0de0000-0000-4000-8000-000000000001','c0de0000-0000-4000-8000-000000000002','c0de0000-0000-4000-8000-000000000003','0.0001',pg_temp.fixture('operation'))$$,'22023',null,'legacy_submit_cannot_replay_academic_operation');
select is((select count(*)::integer from public.entradas where id=pg_temp.fixture('entry')),0,'legacy read does not reveal academic header');
select is((select count(*)::integer from public.resultados where revisao_id=pg_temp.fixture('revision')),0,'legacy read does not reveal academic result');
select ok(not has_function_privilege('authenticated','private.submit_legacy_entry_internal(uuid,uuid,uuid,text,uuid)','EXECUTE'),'legacy internal helper has no browser grant');
reset role;
update public.vinculos set ativo=false where actor_id=pg_temp.fixture('actor') and indicador_id is null;
set local role authenticated;
select throws_ok($$select public.submit_demo_entry('c0de0000-0000-4000-8000-000000000001','c0de0000-0000-4000-8000-000000000002','c0de0000-0000-4000-8000-000000000003','0.0001',pg_temp.fixture('operation'))$$,'42501',null,'revoked legacy link cannot retrieve academic operation cache');
select is((select count(*)::integer from public.vinculos where indicador_id is null),0,'revoked legacy link is not readable');
reset role;
update public.vinculos set ativo=false where actor_id=pg_temp.fixture('actor') and papel='cam';
set local role authenticated;
select is(pg_temp.fixture_context_count(),6,'revoked link is absent');
reset role;
select throws_ok($$select private.require_academic_context(jsonb_build_object('vinculoId',(select id from public.vinculos where actor_id=pg_temp.fixture('actor') and papel='cam'),'competenciaId',pg_temp.fixture('competence'),'indicadorId','c0de0000-0000-4000-8000-000000000002'),'cycle_read')$$,'42501',null,'revoked selection cannot be restored by its id');
update public.vinculos set vigencia_inicio=current_date-10,vigencia_fim=current_date-1 where actor_id=pg_temp.fixture('actor') and papel='gestor_unidade';
set local role authenticated;
select is(pg_temp.fixture_context_count(),5,'expired link is absent');
reset role;
update public.contas_demo set ativo=false where ator_id=pg_temp.fixture('actor');
select throws_ok($$select private.require_academic_context(pg_temp.context_for('area_tecnica'),'draft')$$,'42501',null,'inactive account cannot replay a stored academic context');
set local role authenticated;
select is(jsonb_array_length(public.get_authorized_contexts()->'contexts'),0,'inactive account has no contexts');
reset role;
delete from public.contas_demo where ator_id=pg_temp.fixture('actor');
select throws_ok($$select private.require_academic_context(pg_temp.context_for('area_tecnica'),'draft')$$,'42501',null,'unprovisioned account cannot replay a stored academic context');
set local role authenticated;
select is(jsonb_array_length(public.get_authorized_contexts()->'contexts'),0,'unprovisioned account has no contexts');
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select is(public.get_authorized_contexts(),'{"contexts":[]}'::jsonb,'anonymous receives no choices');
reset role;
select * from finish();
rollback;
