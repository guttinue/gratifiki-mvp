begin;
select no_plan();
\ir ../support/academic-fixture.psql
-- CAM-04 guard: the model-3 history reads get_scoped_audit once per context of
-- the view, with pageSize 100. The October V3 seed has drafts, submissions and
-- a return, so the CAM sees events.
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

select pg_temp.login_account('cam');
set local role authenticated;
select lives_ok(format('select public.get_scoped_audit(%L::jsonb,%L::jsonb)',pg_temp.ctx('cam','cam','ACADEMIC-NORTE-1','DEMO-V1-01','ACADEMIC-V3-2026-10'),'{"page":1,"pageSize":100}'),
 'the model-3 CAM reads its scoped audit with the history page size');
select ok((public.get_scoped_audit(pg_temp.ctx('cam','cam','ACADEMIC-NORTE-1','DEMO-V1-01','ACADEMIC-V3-2026-10'),'{"page":1,"pageSize":100}')->>'total')::integer>0,
 'the model-3 CAM history is not empty (October has drafts, submissions and a return)');
reset role;

select pg_temp.login_account('area_tecnica');
set local role authenticated;
select lives_ok(format('select public.get_scoped_audit(%L::jsonb,%L::jsonb)',pg_temp.ctx('area_tecnica','area_tecnica','ACADEMIC-NORTE-1','DEMO-V1-01','ACADEMIC-V3-2026-10'),'{"page":1,"pageSize":100}'),
 'the model-3 technical area reads its scoped audit');
reset role;

select pg_temp.login_account('gestor_unidade');
set local role authenticated;
select lives_ok(format('select public.get_scoped_audit(%L::jsonb,%L::jsonb)',pg_temp.ctx('gestor_unidade','gestor_unidade','ACADEMIC-NORTE-1','DEMO-V1-01','ACADEMIC-V3-2026-10'),'{"page":1,"pageSize":100}'),
 'the model-3 unit manager reads its scoped audit');
reset role;

select * from finish();rollback;
