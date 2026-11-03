begin;
select no_plan();
\ir ../support/academic-fixture.psql
-- Unit batch read and all-or-nothing submission over the DEMO-v1 October data
-- that the academic fixture seeds (T7): Alfa 01 draft 90, 02 submitted,
-- 03 returned with the V3 reason, 04 accepted; Beta 02 has no entry.
create function pg_temp.actor(label text) returns uuid language sql security definer set search_path='' as $$
 select ator_id from public.contas_demo where rotulo=label$$;
create function pg_temp.login_account(label text) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',pg_temp.actor(label)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.actor(label),'role','authenticated')::text,true);
end;$$;
create function pg_temp.ctx(scope text,indicator text,label text default 'Conta acadêmica area_tecnica',month text default 'ACADEMIC-V3-2026-10') returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('vinculoId',v.id,'competenciaId',c.id,'indicadorId',v.indicador_id)
 from public.vinculos v join public.escopos s on s.id=v.escopo_id join public.indicadores i on i.id=v.indicador_id
 cross join public.competencias c
 where v.actor_id=pg_temp.actor(label) and v.papel='area_tecnica' and s.codigo=scope and i.codigo=indicator and c.codigo=month$$;
create function pg_temp.pos(scope text,indicator text) returns uuid language sql security definer set search_path='' as $$
 select p.id from public.posicoes_esperadas p join public.escopos s on s.id=p.alvo_id join public.indicadores i on i.id=p.indicador_id
 join public.competencias c on c.id=p.competencia_id where c.codigo='ACADEMIC-V3-2026-10' and s.codigo=scope and i.codigo=indicator$$;
create function pg_temp.unit(scope text) returns uuid language sql security definer set search_path='' as $$
 select id from public.escopos where codigo=scope$$;
-- Versions and states of every October position of a unit.
create function pg_temp.state(scope text) returns text language sql security definer set search_path='' as $$
 select string_agg(i.codigo||'='||p.lock_version||'/'||coalesce(e.estado,'ausente'),' ' order by i.codigo)
 from public.posicoes_esperadas p join public.escopos s on s.id=p.alvo_id join public.indicadores i on i.id=p.indicador_id
 join public.competencias c on c.id=p.competencia_id left join public.entradas e on e.posicao_id=p.id
 where c.codigo='ACADEMIC-V3-2026-10' and s.codigo=scope$$;
create function pg_temp.input(value text) returns jsonb language sql as $$
 select jsonb_build_object('estadoDado','valor','valor',value,'fonte','Painel sintético de outubro','periodoFonte','2026-10-01','motivo','')$$;
create function pg_temp.item(scope text,indicator text,input jsonb,correction jsonb default null,label text default 'Conta acadêmica area_tecnica') returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('contexto',pg_temp.ctx(scope,indicator,label),'positionId',p.id,'expectedVersion',p.lock_version,'input',input,'correction',correction)
 from public.posicoes_esperadas p where p.id=pg_temp.pos(scope,indicator)$$;
create function pg_temp.op(label text) returns uuid language sql immutable as $$select md5('t23-op:'||label)::uuid$$;
-- The error a batch raises, with its JSON detail.
create function pg_temp.failure(items jsonb,op text) returns jsonb language plpgsql as $$
declare s text; m text; d text;
begin
 perform public.submit_unit_batch(items,pg_temp.op(op));
 return null;
exception when others then
 get stacked diagnostics s=returned_sqlstate,m=message_text,d=pg_exception_detail;
 return jsonb_build_object('state',s,'message',m,'detail',nullif(d,'')::jsonb);
end;$$;
create function pg_temp.operations(op text) returns integer language sql security definer set search_path='' as $$
 select count(*)::integer from public.operacoes_dominio where operation_id=pg_temp.op(op)
  or operation_id in (select extensions.uuid_generate_v5(pg_temp.op(op),p.id::text||':'||k)
   from public.posicoes_esperadas p cross join unnest(array['save_draft','submit','correct'])k)$$;

select ok(has_function_privilege('authenticated','public.get_unit_batch(jsonb,uuid)','execute') and not has_function_privilege('anon','public.get_unit_batch(jsonb,uuid)','execute'),
 'get_unit_batch is executable by authenticated only');
select ok(has_function_privilege('authenticated','public.submit_unit_batch(jsonb,uuid)','execute') and not has_function_privilege('anon','public.submit_unit_batch(jsonb,uuid)','execute'),
 'submit_unit_batch is executable by authenticated only');

create temp table alfa_before as select pg_temp.state('ACADEMIC-NORTE-1') s;
create temp table beta_before as select pg_temp.state('ACADEMIC-NORTE-2') s;
grant select on alfa_before,beta_before to authenticated;
create temp table alfa_contexts as select jsonb_agg(pg_temp.ctx('ACADEMIC-NORTE-1',i) order by i) c from unnest(array['DEMO-V1-01','DEMO-V1-02','DEMO-V1-03','DEMO-V1-04'])i;
grant select on alfa_contexts to authenticated;

-- Read: the Norte technical area reads Alfa through its four DEMO-v1 links.
select pg_temp.login_account('Conta acadêmica area_tecnica');
set local role authenticated;
create temp table alfa_batch as select public.get_unit_batch((select c from alfa_contexts),pg_temp.unit('ACADEMIC-NORTE-1')) b;
select is((select b-'items' from alfa_batch),jsonb_build_object('unitId',pg_temp.unit('ACADEMIC-NORTE-1'),'unitCode','ACADEMIC-NORTE-1'),'the batch names its unit');
select is((select string_agg(i->>'indicatorCode'||'='||(i->>'status')||'/'||(i->>'version'),' ' order by i->>'indicatorCode') from alfa_batch,jsonb_array_elements(b->'items')i),
 'DEMO-V1-01=rascunho/2 DEMO-V1-02=enviada/3 DEMO-V1-03=devolvida/5 DEMO-V1-04=validada/5','Alfa lists its four October positions with states and versions');
select is((select i from alfa_batch,jsonb_array_elements(b->'items')i where i->>'indicatorCode'='DEMO-V1-01'),
 jsonb_build_object('positionId',pg_temp.pos('ACADEMIC-NORTE-1','DEMO-V1-01'),'indicatorCode','DEMO-V1-01','name','Registros conferidos','meta','95','direction','maior_melhor',
  'weight','30','decimals',2,'max','100','unit','%','status','rascunho','version',2,'estadoDado','valor','valor','90','fonte','Painel sintético de acompanhamento',
  'motivo','','returnReason',null,'revisionNumber',1),'an item carries its rule, weight, limits and current draft');
select is((select jsonb_build_object('returnReason',i->>'returnReason','valor',i->>'valor','revisionNumber',i->'revisionNumber') from alfa_batch,jsonb_array_elements(b->'items')i where i->>'indicatorCode'='DEMO-V1-03'),
 jsonb_build_object('returnReason','A fonte informada é de setembro. Confirme o tempo de resposta de outubro e reenvie.','valor','96','revisionNumber',1),
 'the returned item carries the return reason');
select is(public.get_unit_batch((select c from alfa_contexts)||jsonb_build_array(pg_temp.ctx('ACADEMIC-NORTE-2','DEMO-V1-01')),pg_temp.unit('ACADEMIC-NORTE-1')),(select b from alfa_batch),
 'a context that does not include the unit is ignored');
select throws_ok(format('select public.get_unit_batch(%L::jsonb,%L::uuid)',(select c from alfa_contexts)||jsonb_build_array(pg_temp.ctx('ACADEMIC-SUL-1','DEMO-V1-01','Área técnica Sul / duplo vínculo')),pg_temp.unit('ACADEMIC-NORTE-1')),
 '42501','access_denied','a foreign context in the read is denied');
select throws_ok(format('select public.get_unit_batch(%L::jsonb,%L::uuid)',(select c from alfa_contexts),pg_temp.unit('ACADEMIC-SUL-1')),
 '42501','access_denied','a unit that no context includes is denied');
select throws_ok(format('select public.get_unit_batch(%L::jsonb,%L::uuid)',jsonb_build_array(pg_temp.ctx('ACADEMIC-NORTE-1','DEMO-01',month=>'ACADEMIC-2026-10')),pg_temp.unit('ACADEMIC-NORTE-1')),
 '42501','access_denied','a model-2 context has no unit batch');
select throws_ok(format('select public.get_unit_batch(%L::jsonb,%L::uuid)',(select c||c||jsonb_build_array(c->0) from alfa_contexts),pg_temp.unit('ACADEMIC-NORTE-1')),
 '22023','invalid_input','more than 8 contexts are rejected');

-- Submit, failures first: each aborts the whole batch and writes nothing.
create temp table good as select jsonb_build_array(pg_temp.item('ACADEMIC-NORTE-1','DEMO-V1-01',pg_temp.input('90')),
 pg_temp.item('ACADEMIC-NORTE-1','DEMO-V1-03',pg_temp.input('40'),jsonb_build_object('explanation','Usei o relatório de outubro.'))) items;
select is(pg_temp.failure((select items from good)||pg_temp.item('ACADEMIC-SUL-1','DEMO-V1-01',pg_temp.input('92'),label=>'Área técnica Sul / duplo vínculo'),'gama'),
 jsonb_build_object('state','42501','message','access_denied','detail',null),'focus 1: an item of Gama (no link of this actor) denies the whole batch');
select is(pg_temp.state('ACADEMIC-NORTE-1'),(select s from alfa_before),'focus 1: Alfa versions and states are unchanged after the Gama denial');
select is(pg_temp.operations('gama'),0,'focus 1: no operation of the denied batch is recorded');
select is(pg_temp.failure((select items from good)||pg_temp.item('ACADEMIC-NORTE-2','DEMO-V1-02',pg_temp.input('19')),'beta'),
 jsonb_build_object('state','42501','message','access_denied','detail',null),'focus 1: an item of another unit of the same actor denies the whole batch');
select is(pg_temp.state('ACADEMIC-NORTE-2'),(select s from beta_before),'focus 1: Beta is unchanged after the mixed-unit denial');
select is(pg_temp.failure(jsonb_build_array(pg_temp.item('ACADEMIC-NORTE-1','DEMO-V1-01',pg_temp.input('90.123')),(select items->1 from good)),'places'),
 jsonb_build_object('state','22023','message','invalid_input','detail',jsonb_build_object('positionId',pg_temp.pos('ACADEMIC-NORTE-1','DEMO-V1-01'),'code','invalid_input')),
 'DEMO-V1-01 = 90.123 fails with the position in the detail');
select is(pg_temp.state('ACADEMIC-NORTE-1'),(select s from alfa_before),'the 90.123 batch writes nothing, not even the valid correction');
select is(pg_temp.operations('places'),0,'the 90.123 batch records no operation');
select is(pg_temp.failure(jsonb_build_array((select items->0 from good),pg_temp.item('ACADEMIC-NORTE-1','DEMO-V1-03',pg_temp.input('40'))),'no-explanation'),
 jsonb_build_object('state','22023','message','invalid_input','detail',jsonb_build_object('positionId',pg_temp.pos('ACADEMIC-NORTE-1','DEMO-V1-03'),'code','invalid_input')),
 'a returned item without an explanation fails with its position');
select is(pg_temp.failure(jsonb_build_array((select items->0 from good),pg_temp.item('ACADEMIC-NORTE-1','DEMO-V1-03',pg_temp.input('40'),jsonb_build_object('explanation',' 	 '))),'blank-explanation'),
 jsonb_build_object('state','22023','message','invalid_input','detail',jsonb_build_object('positionId',pg_temp.pos('ACADEMIC-NORTE-1','DEMO-V1-03'),'code','invalid_input')),
 'a blank explanation is no explanation');
select is(pg_temp.failure(jsonb_build_array(pg_temp.item('ACADEMIC-NORTE-1','DEMO-V1-01',pg_temp.input('90'),jsonb_build_object('explanation','Nada a corrigir'))),'stray-correction'),
 jsonb_build_object('state','22023','message','invalid_input','detail',jsonb_build_object('positionId',pg_temp.pos('ACADEMIC-NORTE-1','DEMO-V1-01'),'code','invalid_input')),
 'a correction on a position that is not returned is rejected');
select is(pg_temp.failure(jsonb_build_array(pg_temp.item('ACADEMIC-NORTE-1','DEMO-V1-02',pg_temp.input('16'))),'submitted'),
 jsonb_build_object('state','22023','message','invalid_input','detail',jsonb_build_object('positionId',pg_temp.pos('ACADEMIC-NORTE-1','DEMO-V1-02'),'code','invalid_state')),
 'an already submitted position fails with invalid_state in the detail');
select is(pg_temp.failure(jsonb_build_array(jsonb_set((select items->0 from good),'{expectedVersion}','1')),'stale'),
 jsonb_build_object('state','40001','message','version_conflict','detail',null),'a stale version passes through as 40001');
select is(pg_temp.failure((select items||items||items||items||jsonb_build_array(items->0) from good),'nine'),
 jsonb_build_object('state','22023','message','invalid_input','detail',null),'9 items are rejected');
select is(pg_temp.failure((select jsonb_build_array(items->0,items->0) from good),'twice'),
 jsonb_build_object('state','22023','message','invalid_input','detail',null),'a position cannot appear twice');
select is(pg_temp.state('ACADEMIC-NORTE-1'),(select s from alfa_before),'Alfa is still unchanged after every failure');

-- A valid Alfa batch: 01 = 90 submitted from its draft, 03 corrected to 40.
create temp table sent as select public.submit_unit_batch((select items from good),pg_temp.op('alfa')) r;
select is((select string_agg((i->>'resourceId')||'|'||(i->>'status')||'|'||(i->>'resultValue'),',' order by i->>'resourceId') from sent,jsonb_array_elements(r->'items')i),
 (select string_agg(x,',' order by x) from unnest(array[pg_temp.pos('ACADEMIC-NORTE-1','DEMO-V1-01')||'|enviada|28.42',pg_temp.pos('ACADEMIC-NORTE-1','DEMO-V1-03')||'|enviada|25'])x),
 'the Alfa batch sends 2 items: 01 = 90 scores 28.42 and 03 = 40 scores 25');
select is(pg_temp.state('ACADEMIC-NORTE-1'),'DEMO-V1-01=4/enviada DEMO-V1-02=3/enviada DEMO-V1-03=6/enviada DEMO-V1-04=5/validada','02 and 04 stay out of the batch');
select is(pg_temp.operations('alfa'),4,'the batch records itself and the derived draft, submit and correct operations');
select is((select jsonb_build_object('reason',r->>'reason','explanation',r->>'correctionExplanation','value',r->>'value')
  from jsonb_array_elements(public.get_position_detail(pg_temp.ctx('ACADEMIC-NORTE-1','DEMO-V1-03'),pg_temp.pos('ACADEMIC-NORTE-1','DEMO-V1-03'))->'revisions')r where (r->>'number')::integer=2),
 jsonb_build_object('reason','','explanation','Usei o relatório de outubro.','value','40'),'the correction explanation is stored apart from the reason and is visible in the detail');
select is((select r->>'correctionExplanation' from jsonb_array_elements(public.get_position_detail(pg_temp.ctx('ACADEMIC-NORTE-1','DEMO-V1-01'),pg_temp.pos('ACADEMIC-NORTE-1','DEMO-V1-01'))->'revisions')r),
 null,'a revision that is not a correction has no explanation');
select is(public.submit_unit_batch((select items from good),pg_temp.op('alfa')),(select r from sent),'the same operation and payload return the same receipt');
select is(pg_temp.operations('alfa'),4,'a replay records nothing new');
select is(pg_temp.failure((select jsonb_build_array(items->0) from good),'alfa'),
 jsonb_build_object('state','22023','message','operation_payload_mismatch','detail',null),'the same operation with another payload is a mismatch');

-- A link revoked between the read and the submission denies the batch.
select is((select i->>'status' from jsonb_array_elements(public.get_unit_batch(jsonb_build_array(pg_temp.ctx('ACADEMIC-NORTE-2','DEMO-V1-02')),pg_temp.unit('ACADEMIC-NORTE-2'))->'items')i),
 'ausente','Beta 02 is read with no entry yet');
create temp table beta_item as select pg_temp.item('ACADEMIC-NORTE-2','DEMO-V1-02',pg_temp.input('19')) i;
reset role;
update public.vinculos set ativo=false where id=((select i from beta_item)->'contexto'->>'vinculoId')::uuid;
set local role authenticated;
select is(pg_temp.failure((select jsonb_build_array(i) from beta_item),'revoked'),
 jsonb_build_object('state','42501','message','access_denied','detail',null),'focus 1: a link revoked after the read denies the batch');
select is(pg_temp.state('ACADEMIC-NORTE-2'),(select s from beta_before),'the revoked batch writes nothing');
reset role;

select * from finish();rollback;
