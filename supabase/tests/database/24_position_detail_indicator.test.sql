begin;
select no_plan();
\ir ../support/academic-fixture.psql
-- R-28: the reviewer's position detail and queue rows name the model-3
-- indicator, its target and last month's accepted value. Model 2 is unchanged.
create function pg_temp.actor(label text) returns uuid language sql security definer set search_path='' as $$
 select ator_id from public.contas_demo where rotulo='Conta acadêmica '||label$$;
create function pg_temp.login_account(label text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',pg_temp.actor(label)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.actor(label),'role','authenticated')::text,true);
end;$$;
create function pg_temp.ctx(label text,role text,scope text,indicator text,month text) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('vinculoId',v.id,'competenciaId',c.id,'indicadorId',v.indicador_id)
 from public.vinculos v join public.escopos s on s.id=v.escopo_id join public.indicadores i on i.id=v.indicador_id
 cross join public.competencias c
 where v.actor_id=pg_temp.actor(label) and v.papel=role and s.codigo=scope and i.codigo=indicator and c.codigo=month$$;
create function pg_temp.pos(scope text,indicator text,month text) returns uuid language sql security definer set search_path='' as $$
 select p.id from public.posicoes_esperadas p join public.escopos s on s.id=p.alvo_id join public.indicadores i on i.id=p.indicador_id
 join public.competencias c on c.id=p.competencia_id where c.codigo=month and s.codigo=scope and i.codigo=indicator$$;
create function pg_temp.reviewer(indicator text,month text,scope text default 'ACADEMIC-NORTE-1') returns jsonb language sql as $$
 select pg_temp.ctx('revisor_tecnico','revisor_tecnico',scope,indicator,month)$$;

-- A later month (not closed) so that the "open previous month" path is read too:
-- October Alfa 04 is accepted (12), October Alfa 01 is only a draft.
insert into public.competencias(codigo,referencia,estado,modelo,conjunto_id)
 select 'ACADEMIC-V3-2026-11',date '2026-11-01','aberta',3,conjunto_id from public.competencias where codigo='ACADEMIC-V3-2026-10';
insert into public.posicoes_esperadas(competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id)
 select (select id from public.competencias where codigo='ACADEMIC-V3-2026-11'),p.indicador_id,p.alvo_id,p.regra_id,p.informante_id,p.revisor_id
 from public.posicoes_esperadas p where p.id in (pg_temp.pos('ACADEMIC-NORTE-1','DEMO-V1-01','ACADEMIC-V3-2026-10'),pg_temp.pos('ACADEMIC-NORTE-1','DEMO-V1-04','ACADEMIC-V3-2026-10'));

select pg_temp.login_account('revisor_tecnico');
set local role authenticated;

-- October Alfa DEMO-V1-01: target 95; previous month is the frozen September 88.
create temp table oct01 as select public.get_position_detail(pg_temp.reviewer('DEMO-V1-01','ACADEMIC-V3-2026-10'),pg_temp.pos('ACADEMIC-NORTE-1','DEMO-V1-01','ACADEMIC-V3-2026-10')) d;
grant select on oct01 to authenticated;
select is((select d->'indicator' from oct01),
 jsonb_build_object('code','DEMO-V1-01','name','Registros conferidos','meta','95','direction','maior_melhor','weight','30','unit','%'),
 'the reviewer of Alfa October DEMO-V1-01 sees the indicator and its target 95');
select is((select d->'previous' from oct01),jsonb_build_object('competencia','ACADEMIC-V3-2026-09','valor','88','estadoDado','valor'),
 'the previous month is the frozen September value 88');
select is((select d->'position'->>'indicatorCode'||' / '||(d->'position'->>'indicatorName') from oct01),'DEMO-V1-01 / Registros conferidos','the detail position carries the indicator code and name');

-- September has no earlier month: previous is null but present.
select is((select d->'previous' from (select public.get_position_detail(pg_temp.reviewer('DEMO-V1-01','ACADEMIC-V3-2026-09'),pg_temp.pos('ACADEMIC-NORTE-1','DEMO-V1-01','ACADEMIC-V3-2026-09')) d) s),
 'null'::jsonb,'with no earlier month the previous block is null');

-- The queue rows carry the indicator code and name.
select is((select i->>'indicatorCode'||' / '||(i->>'indicatorName')
  from jsonb_array_elements(public.get_operational_positions(pg_temp.reviewer('DEMO-V1-01','ACADEMIC-V3-2026-10'),'{"page":1,"pageSize":25}')->'items')i limit 1),
 'DEMO-V1-01 / Registros conferidos','the queue rows of model 3 name their indicator');

-- Open earlier month: November Alfa 04 reads October's accepted 12; November 01 reads October's draft as none.
select is((select public.get_position_detail(pg_temp.reviewer('DEMO-V1-04','ACADEMIC-V3-2026-11'),pg_temp.pos('ACADEMIC-NORTE-1','DEMO-V1-04','ACADEMIC-V3-2026-11'))->'previous'),
 jsonb_build_object('competencia','ACADEMIC-V3-2026-10','valor','12','estadoDado','valor'),'an open earlier month provides its accepted revision');
select is((select public.get_position_detail(pg_temp.reviewer('DEMO-V1-01','ACADEMIC-V3-2026-11'),pg_temp.pos('ACADEMIC-NORTE-1','DEMO-V1-01','ACADEMIC-V3-2026-11'))->'previous'),
 'null'::jsonb,'an earlier draft that nobody accepted is never shown as the previous value');

-- The previous-month lookup also skips an invalidated month; a model-3 competence
-- cannot be invalidated today (the state constraint), so that guard is only defensive.
reset role;
select throws_ok($$update public.competencias set estado='invalidada' where codigo='ACADEMIC-V3-2026-10'$$,'23514',null,
 'a model-3 competence cannot be invalidated, so the previous-month lookup can never meet one');
set local role authenticated;

-- Another unit's position is still denied.
select throws_ok(format('select public.get_position_detail(%L::jsonb,%L::uuid)',pg_temp.reviewer('DEMO-V1-01','ACADEMIC-V3-2026-10'),pg_temp.pos('ACADEMIC-NORTE-2','DEMO-V1-01','ACADEMIC-V3-2026-10')),
 '42501',null,'the reviewer of Alfa cannot read the detail of a Beta position');
reset role;

-- A model-2 detail and queue row keep exactly their old keys.
select pg_temp.login_account('revisor_tecnico');
set local role authenticated;
select is((select array(select jsonb_object_keys(d) order by 1) from (select public.get_position_detail(pg_temp.reviewer('DEMO-01','ACADEMIC-2026-10'),pg_temp.pos('ACADEMIC-NORTE-1','DEMO-01','ACADEMIC-2026-10')) d) s),
 array['decisions','memories','position','revisions'],'a model-2 detail has neither indicator nor previous');
select is((select array(select jsonb_object_keys(i) order by 1) from jsonb_array_elements(public.get_operational_positions(pg_temp.reviewer('DEMO-01','ACADEMIC-2026-10'),'{"page":1,"pageSize":25}')->'items')i limit 1),
 array['aplicavel','escopoCodigo','escopoId','escopoTipo','estadoDado','id','inputValue','resultValue','revisionId','status','version'],'a model-2 queue row has no indicator keys');
-- An actor without any link is denied.
select pg_temp.login_account('gestor_unidade');
select throws_ok(format('select public.get_position_detail(%L::jsonb,%L::uuid)',pg_temp.reviewer('DEMO-V1-01','ACADEMIC-V3-2026-10'),pg_temp.pos('ACADEMIC-NORTE-1','DEMO-V1-01','ACADEMIC-V3-2026-10')),
 '42501',null,'an actor that does not hold the reviewer link is denied');
reset role;

select * from finish();
rollback;
