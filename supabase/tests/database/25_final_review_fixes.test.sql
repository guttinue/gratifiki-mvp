begin;
select no_plan();
\ir ../support/academic-fixture.psql
-- Final review fixes over the DEMO-v1 data that the academic fixture seeds
-- (T7): October V3 open (Alfa 01 draft, 03 returned with a September source),
-- Beta 02 without entry; DEMO-v1 uses the absence mode "zero".
create function pg_temp.actor(label text) returns uuid language sql security definer set search_path='' as $$
 select ator_id from public.contas_demo where rotulo='Conta acadêmica '||label$$;
create function pg_temp.login_account(label text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',pg_temp.actor(label)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.actor(label),'role','authenticated')::text,true);
end;$$;
-- Context of one link: actor label, role, scope code, indicator code, month code.
create function pg_temp.ctx(label text,role text,scope text,indicator text,month text) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('vinculoId',v.id,'competenciaId',c.id,'indicadorId',v.indicador_id)
 from public.vinculos v join public.escopos s on s.id=v.escopo_id join public.indicadores i on i.id=v.indicador_id
 cross join public.competencias c
 where v.actor_id=pg_temp.actor(label) and v.papel=role and s.codigo=scope and i.codigo=indicator and c.codigo=month$$;
create function pg_temp.unit(scope text) returns uuid language sql security definer set search_path='' as $$
 select id from public.escopos where codigo=scope$$;
create function pg_temp.item(b jsonb,code text) returns jsonb language sql as $$
 select i from jsonb_array_elements(b->'items')i where i->>'indicatorCode'=code$$;

-- I-2 and I-3: the unit batch carries each revision's source period and the set's absence mode.
select pg_temp.login_account('area_tecnica');
set local role authenticated;
create temp table alfa as select public.get_unit_batch((select jsonb_agg(pg_temp.ctx('area_tecnica','area_tecnica','ACADEMIC-NORTE-1',i,'ACADEMIC-V3-2026-10') order by i)
 from unnest(array['DEMO-V1-01','DEMO-V1-02','DEMO-V1-03','DEMO-V1-04'])i),pg_temp.unit('ACADEMIC-NORTE-1')) b;
select is((select b->>'mode' from alfa),'zero','the unit batch carries the absence mode of the DEMO-v1 set');
select is((select pg_temp.item(b,'DEMO-V1-01')->>'periodoFonte' from alfa),'2026-10-01','a saved draft returns its source period');
select is((select pg_temp.item(b,'DEMO-V1-03')->>'periodoFonte' from alfa),'2026-09-01','a returned revision returns its own (September) source period, not the competence month');
select is((select pg_temp.item(b,'DEMO-V1-03')->'periodoFonte' from alfa),'"2026-09-01"'::jsonb,'the source period is date text');
select is((select pg_temp.item(public.get_unit_batch(jsonb_build_array(pg_temp.ctx('area_tecnica','area_tecnica','ACADEMIC-NORTE-2','DEMO-V1-02','ACADEMIC-V3-2026-10')),pg_temp.unit('ACADEMIC-NORTE-2')),'DEMO-V1-02')->'periodoFonte'),
 'null'::jsonb,'a position without entry has no source period (null)');
reset role;

-- I-3: unit results and leadership aggregates carry the mode too (open and closed months).
select pg_temp.login_account('gestor_unidade');
set local role authenticated;
select is(public.get_unit_results(pg_temp.ctx('gestor_unidade','gestor_unidade','ACADEMIC-NORTE-1','DEMO-V1-01','ACADEMIC-V3-2026-10'))->>'mode','zero','unit results carry the absence mode (open month)');
select is(public.get_unit_results(pg_temp.ctx('gestor_unidade','gestor_unidade','ACADEMIC-NORTE-1','DEMO-V1-01','ACADEMIC-V3-2026-09'))->>'mode','zero','unit results carry the absence mode (closed month)');
-- M-b (R-20): a unit is readable only with links on EVERY set indicator.
reset role;
update public.vinculos set ativo=false where id=(pg_temp.ctx('gestor_unidade','gestor_unidade','ACADEMIC-NORTE-1','DEMO-V1-04','ACADEMIC-V3-2026-10')->>'vinculoId')::uuid;
set local role authenticated;
select throws_ok(format('select public.get_unit_results(%L::jsonb)',pg_temp.ctx('gestor_unidade','gestor_unidade','ACADEMIC-NORTE-1','DEMO-V1-01','ACADEMIC-V3-2026-10')),'42501','access_denied',
 'R-20: with the DEMO-V1-04 link revoked, the remaining DEMO-V1-01 link no longer reads the unit');
reset role;

select pg_temp.login_account('lideranca');
set local role authenticated;
select is(public.get_leadership_aggregates(pg_temp.ctx('lideranca','lideranca','ACADEMIC-NORTE','DEMO-V1-01','ACADEMIC-V3-2026-10'))->>'mode','zero','leadership aggregates carry the absence mode');
select is(public.get_leadership_aggregates(pg_temp.ctx('lideranca','lideranca','ACADEMIC-SUL','DEMO-V1-03','ACADEMIC-V3-2026-09'))->>'mode','zero','leadership aggregates carry the absence mode (closed month)');
reset role;

-- I-5: the model-2 configuration commands refuse a model-3 context.
select pg_temp.login_account('administrador');
set local role authenticated;
select throws_ok(format('select public.schedule_demo_rule(%L::jsonb,%L,%L::date,%L,%L::uuid)',pg_temp.ctx('administrador','administrador','ACADEMIC-NORTE','DEMO-V1-01','ACADEMIC-V3-2026-10'),'0.5','2026-12-01','DEMO-REGRA-T25',md5('t25-schedule-v3')::uuid),
 '42501','access_denied','schedule_demo_rule refuses a model-3 administrator context');
select throws_ok(format('select public.open_demo_competence(%L::jsonb,%L::date,%L::jsonb,%L::uuid)',pg_temp.ctx('administrador','administrador','ACADEMIC-NORTE','DEMO-V1-01','ACADEMIC-V3-2026-10'),'2026-12-01','[]',md5('t25-open-v3')::uuid),
 '42501','access_denied','open_demo_competence refuses a model-3 administrator context');
select is((public.schedule_demo_rule(pg_temp.ctx('administrador','administrador','ACADEMIC-NORTE','DEMO-01','ACADEMIC-2026-10'),'0.5','2026-12-01','DEMO-REGRA-T25',md5('t25-schedule-v2')::uuid))->>'status','agendada',
 'the model-2 administrator still schedules a future rule');
reset role;

select * from finish();rollback;
