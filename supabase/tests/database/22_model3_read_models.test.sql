begin;
select no_plan();
\ir ../support/academic-fixture.psql
-- Model-3 read models over the DEMO-v1 data that the academic fixture seeds
-- (T7): September V3 closed and published, October V3 open in the V3 states.
create function pg_temp.actor(label text) returns uuid language sql security definer set search_path='' as $$
 select ator_id from public.contas_demo where rotulo='Conta acadêmica '||label$$;
create function pg_temp.login_account(label text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',pg_temp.actor(label)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.actor(label),'role','authenticated')::text,true);
end;$$;
-- Context of one DEMO-v1 link: actor label, role, scope code, indicator code, month code.
create function pg_temp.ctx(label text,role text,scope text,indicator text,month text) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('vinculoId',v.id,'competenciaId',c.id,'indicadorId',v.indicador_id)
 from public.vinculos v join public.escopos s on s.id=v.escopo_id join public.indicadores i on i.id=v.indicador_id
 cross join public.competencias c
 where v.actor_id=pg_temp.actor(label) and v.papel=role and s.codigo=scope and i.codigo=indicator and c.codigo=month$$;
create function pg_temp.manager(month text,indicator text default 'DEMO-V1-01') returns jsonb language sql as $$
 select pg_temp.ctx('gestor_unidade','gestor_unidade','ACADEMIC-NORTE-1',indicator,month)$$;
create function pg_temp.unit(r jsonb,code text) returns jsonb language sql as $$
 select u from jsonb_array_elements(r->'units')u where u->>'unitCode'=code$$;
create function pg_temp.item(u jsonb,code text) returns jsonb language sql as $$
 select i from jsonb_array_elements(u->'items')i where i->>'indicatorCode'=code$$;
create function pg_temp.snapshot(month text) returns uuid language sql security definer set search_path='' as $$
 select f.id from public.fechamentos f join public.competencias c on c.id=f.competencia_id where c.codigo=month$$;

-- Grants follow the public read-model pattern.
select ok(has_function_privilege('authenticated','public.get_unit_results(jsonb)','execute') and not has_function_privilege('anon','public.get_unit_results(jsonb)','execute'),
 'get_unit_results is executable by authenticated only');
select ok(has_function_privilege('authenticated','public.get_rule_catalog(jsonb)','execute') and not has_function_privilege('anon','public.get_rule_catalog(jsonb)','execute'),
 'get_rule_catalog is executable by authenticated only');

-- Unit manager of Alfa (ACADEMIC-NORTE-1).
select pg_temp.login_account('gestor_unidade');
set local role authenticated;
create temp table oct_manager as select public.get_unit_results(pg_temp.manager('ACADEMIC-V3-2026-10')) r;
select is((select jsonb_build_object('competencia',r->>'competencia','state',r->>'state','publication',r->>'publication','units',jsonb_array_length(r->'units')) from oct_manager),
 jsonb_build_object('competencia','ACADEMIC-V3-2026-10','state','aberta','publication','nao_publicada','units',1),'the Alfa manager reads October as one open, unpublished unit');
select is((select pg_temp.unit(r,'ACADEMIC-NORTE-1')-'items'-'unitId' from oct_manager),
 jsonb_build_object('unitCode','ACADEMIC-NORTE-1','districtCode','ACADEMIC-NORTE','points','20','complete',false,'noBase',false,'partial',true,
  'previous',jsonb_build_object('points','88.62','competencia','ACADEMIC-V3-2026-09'),'delta',null),
 'focus 3: Alfa in October before the flow is partial (only the accepted item counts) and has no delta');
select is((select string_agg(format('%s=%s/%s/%s/%s',i->>'indicatorCode',i->>'state',i->>'reviewStatus',coalesce(i->>'inputValue','-'),coalesce(i->>'points','-')),' ' order by i->>'indicatorCode')
  from oct_manager,jsonb_array_elements(pg_temp.unit(r,'ACADEMIC-NORTE-1')->'items')i),
 'DEMO-V1-01=pendente/sem_envio/-/- DEMO-V1-02=pendente/em_conferencia/-/- DEMO-V1-03=pendente/sem_envio/-/- DEMO-V1-04=valor/valor/12/20',
 'pending items expose neither drafts nor submitted values; the accepted item carries its points');
select is((select pg_temp.item(pg_temp.unit(r,'ACADEMIC-NORTE-1'),'DEMO-V1-04') from oct_manager),
 jsonb_build_object('indicatorCode','DEMO-V1-04','name','Verificações realizadas','state','valor','inputValue','12','meta','12','direction','maior_melhor',
  'weight','20','effectiveWeight','20','points','20','expression','min(12 ÷ 12; 1) × 20','reviewStatus','valor'),'an open item carries the rule, weights, points and expression');
select is(public.get_unit_results(pg_temp.manager('ACADEMIC-V3-2026-10','DEMO-V1-03')),(select r from oct_manager),
 'a context of any indicator of the group expands to the whole DEMO-v1 set');

create temp table sep_manager as select public.get_unit_results(pg_temp.manager('ACADEMIC-V3-2026-09')) r;
select is((select jsonb_build_object('state',r->>'state','publication',r->>'publication') from sep_manager),
 jsonb_build_object('state','fechada','publication','publicada_demo'),'September reads as closed and published');
select is((select pg_temp.unit(r,'ACADEMIC-NORTE-1')-'items'-'unitId' from sep_manager),
 jsonb_build_object('unitCode','ACADEMIC-NORTE-1','districtCode','ACADEMIC-NORTE','points','88.62','complete',true,'noBase',false,'partial',false,'previous',null,'delta',null),
 'the Alfa manager sees the frozen September score 88.62, with no earlier published month');
select is((select pg_temp.item(pg_temp.unit(r,'ACADEMIC-NORTE-1'),'DEMO-V1-01') from sep_manager),
 jsonb_build_object('indicatorCode','DEMO-V1-01','name','Registros conferidos','state','valor','inputValue','88','meta','95','direction','maior_melhor',
  'weight','30','effectiveWeight','30','points','27.79','expression','min(88 ÷ 95; 1) × 30','reviewStatus','valor'),'a closed item is read from the frozen snapshot');

-- The manager of Alfa asking for Beta: no Beta link of the manager exists, so
-- any Beta context (another actor's link) or a foreign month is denied.
select throws_ok(format('select public.get_unit_results(%L::jsonb)',pg_temp.ctx('cam','cam','ACADEMIC-NORTE-2','DEMO-V1-01','ACADEMIC-V3-2026-10')),'42501',null,
 'the Alfa manager asking for Beta is denied');
select throws_ok(format('select public.get_unit_results(%L::jsonb)',pg_temp.manager('ACADEMIC-V3-2026-10')||jsonb_build_object('competenciaId',(select id from public.competencias where codigo='ACADEMIC-2026-10'))),'42501',null,
 'a model-3 link cannot read a model-2 month');
select throws_ok(format('select public.get_rule_catalog(%L::jsonb)',pg_temp.manager('ACADEMIC-V3-2026-10')),'42501',null,'a unit manager cannot read the rule catalogue');
select throws_ok(format('select public.get_leadership_aggregates(%L::jsonb)',pg_temp.manager('ACADEMIC-V3-2026-10')),'42501',null,'a unit manager cannot read leadership aggregates');
reset role;

-- District manager of Norte sees Alfa and Beta.
select pg_temp.login_account('gestor_distrital');
set local role authenticated;
select is((select string_agg(u->>'unitCode'||':'||coalesce(u->>'points','-')||':'||(u->>'partial'),',' order by u->>'unitCode')
  from jsonb_array_elements(public.get_unit_results(pg_temp.ctx('gestor_distrital','gestor_distrital','ACADEMIC-NORTE','DEMO-V1-02','ACADEMIC-V3-2026-10'))->'units')u),
 'ACADEMIC-NORTE-1:20:true,ACADEMIC-NORTE-2:41.67:true','the district manager sees Alfa and Beta (both partial in October)');
select is((select string_agg(u->>'unitCode'||':'||(u->>'points'),',' order by u->>'unitCode')
  from jsonb_array_elements(public.get_unit_results(pg_temp.ctx('gestor_distrital','gestor_distrital','ACADEMIC-NORTE','DEMO-V1-02','ACADEMIC-V3-2026-09'))->'units')u),
 'ACADEMIC-NORTE-1:88.62,ACADEMIC-NORTE-2:100','the district manager reads the frozen September scores of its district');
reset role;

-- CAM: every unit with CAM links; delta only between two complete scores.
select pg_temp.login_account('cam');
set local role authenticated;
select is((select string_agg(format('%s:%s:%s:%s',u->>'unitCode',coalesce(u->>'points','-'),u->'previous'->>'points',coalesce(u->>'delta','-')),',' order by u->>'unitCode')
  from jsonb_array_elements(public.get_unit_results(pg_temp.ctx('cam','cam','ACADEMIC-SUL-2','DEMO-V1-04','ACADEMIC-V3-2026-10'))->'units')u),
 'ACADEMIC-NORTE-1:20:88.62:-,ACADEMIC-NORTE-2:41.67:100:-,ACADEMIC-SUL-1:99.05:97.17:1.88,ACADEMIC-SUL-2:69.87:87.84:-17.97',
 'the CAM sees the four units; complete units compare with published September, partial ones never do');
select is((select (r->'ruleSets'->0)-'items'-'id' from (select public.get_rule_catalog(pg_temp.ctx('cam','cam','ACADEMIC-SUL-2','DEMO-V1-04','ACADEMIC-V3-2026-10')) r) x),
 jsonb_build_object('code','DEMO','version',1,'mode','zero','synthetic',true,'validFrom','2026-09-01','reference','DEMO-v1 · regra fictícia acadêmica','inUse',true),
 'the CAM reads the rule catalogue too');

-- Model-3 export: September carries the frozen meta/weight calculation.
create temp table sep_export as select public.get_snapshot_export(pg_temp.ctx('cam','cam','ACADEMIC-NORTE-1','DEMO-V1-01','ACADEMIC-V3-2026-09'),pg_temp.snapshot('ACADEMIC-V3-2026-09'),gen_random_uuid()) b;
select is((select jsonb_build_object('contractVersion',b->'contractVersion','rows',jsonb_array_length(b->'rows'),
  'withPoints',(select count(*) from jsonb_array_elements(b->'rows')x where jsonb_typeof(x->'pontos')='string'),
  'synthetic',(select count(*) from jsonb_array_elements(b->'rows')x where x->'sintetico'='true'::jsonb),
  'sets',(select jsonb_agg(distinct (x->>'conjunto')||'/'||(x->>'conjuntoVersao')) from jsonb_array_elements(b->'rows')x)) from sep_export),
 jsonb_build_object('contractVersion',2,'rows',16,'withPoints',16,'synthetic',16,'sets',jsonb_build_array('DEMO/1')),
 'the September export has 16 rows with points, synthetic=true and the DEMO v1 set');
select is((select x-'snapshotId' from sep_export,jsonb_array_elements(b->'rows')x where x->>'alvoCodigo'='ACADEMIC-NORTE-1' and x->>'indicador'='DEMO-V1-01'),
 jsonb_build_object('competencia','ACADEMIC-V3-2026-09','indicador','DEMO-V1-01','alvoTipo','unidade','alvoCodigo','ACADEMIC-NORTE-1','regraVersao',1,'revisao',1,
  'situacaoDado','valor','valor','88','meta','95','peso','30','pesoEfetivo','30','pontos','27.79','conjunto','DEMO','conjuntoVersao',1,'sintetico',true,'publicacao','publicada_demo'),
 'a model-3 export row carries state, value, target, weights, points and set');
select is((select b->'manifest' from sep_export),
 jsonb_build_object('competencia','ACADEMIC-V3-2026-09','ruleVersions',jsonb_build_array(1),'publicationVersion',1,'positionCount',16,'calculableCount',16,'unavailableCount',0,'notApplicableCount',0,
  'totals',jsonb_build_array(jsonb_build_object('tipo','unidade','unidadeMedida','pontos sintéticos','sum','373.63'))),
 'the model-3 manifest totals the frozen points (88.62 + 100 + 97.17 + 87.84)');
select throws_ok(format('select public.get_snapshot_export(%L::jsonb,%L::uuid,gen_random_uuid())',pg_temp.ctx('cam','cam','ACADEMIC-NORTE-1','DEMO-V1-01','ACADEMIC-V3-2026-10'),pg_temp.snapshot('ACADEMIC-V3-2026-09')),'55000',null,
 'an open month still cannot be exported');
reset role;

-- Leadership: Norte and Sul, no person and no individual value.
select pg_temp.login_account('lideranca');
set local role authenticated;
select is(public.get_leadership_aggregates(pg_temp.ctx('lideranca','lideranca','ACADEMIC-NORTE','DEMO-V1-01','ACADEMIC-V3-2026-10')),
 jsonb_build_object('acceptedPercent','68.75','mode','zero',
  'districts',jsonb_build_array(jsonb_build_object('districtCode','ACADEMIC-NORTE','average',null,'completeUnits',0,'totalUnits',2),
   jsonb_build_object('districtCode','ACADEMIC-SUL','average','84.46','completeUnits',2,'totalUnits',2)),
  'attention',jsonb_build_array(jsonb_build_object('unitCode','ACADEMIC-NORTE-1','pending',3),jsonb_build_object('unitCode','ACADEMIC-NORTE-2','pending',2))),
 'leadership sees both districts in October: 11 of 16 accepted, Sul averages its complete units, Norte needs action');
select is(public.get_leadership_aggregates(pg_temp.ctx('lideranca','lideranca','ACADEMIC-SUL','DEMO-V1-03','ACADEMIC-V3-2026-09')),
 jsonb_build_object('acceptedPercent','100.00','mode','zero',
  'districts',jsonb_build_array(jsonb_build_object('districtCode','ACADEMIC-NORTE','average','94.31','completeUnits',2,'totalUnits',2),
   jsonb_build_object('districtCode','ACADEMIC-SUL','average','92.51','completeUnits',2,'totalUnits',2)),
  'attention','[]'::jsonb),
 'September leadership reads the frozen scores, averaged to 2 places (92.505 rounds half up)');
select throws_ok(format('select public.get_unit_results(%L::jsonb)',pg_temp.ctx('lideranca','lideranca','ACADEMIC-NORTE','DEMO-V1-01','ACADEMIC-V3-2026-10')),'42501',null,
 'leadership cannot read unit results');
reset role;

-- Administrator: catalogue yes, unit results no.
select pg_temp.login_account('administrador');
set local role authenticated;
select throws_ok(format('select public.get_unit_results(%L::jsonb)',pg_temp.ctx('administrador','administrador','ACADEMIC-NORTE','DEMO-V1-01','ACADEMIC-V3-2026-10')),'42501',null,
 'the administrator cannot read unit results');
create temp table catalog as select public.get_rule_catalog(pg_temp.ctx('administrador','administrador','ACADEMIC-NORTE','DEMO-V1-01','ACADEMIC-V3-2026-10')) r;
select is((select sum((i->>'weight')::numeric) from catalog,jsonb_array_elements(r->'ruleSets')s,jsonb_array_elements(s->'items')i where s->>'code'='DEMO' and s->'version'='1'),100::numeric,
 'the administrator sees DEMO v1 weights summing to 100');
select is((select s->'items'->2 from catalog,jsonb_array_elements(r->'ruleSets')s where s->>'code'='DEMO'),
 jsonb_build_object('indicatorCode','DEMO-V1-03','name','Tempo de resposta','meta','48','direction','menor_melhor','decimals',2,'maximum','8760','unit','h','weight','25'),
 'catalogue items carry code, name, target, direction, places, maximum, unit and weight');
select is((select count(*)::integer from catalog,jsonb_path_query(r,'strict $.**') v where jsonb_typeof(v)='object' and (v ?| array['inputValue','valor','points','pontos','actorId'])),0,
 'the catalogue carries no evaluation values or people');
reset role;

select * from finish();rollback;
