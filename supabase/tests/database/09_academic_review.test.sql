begin;
select no_plan();
\ir ../support/academic-fixture.psql
insert into public.contas_demo(ator_id,rotulo) values(pg_temp.fixture('actor'),'Technical'),(pg_temp.fixture('reviewer'),'Reviewer');
update public.vinculos set indicador_id='c0de0000-0000-4000-8000-000000000002',vigencia_inicio=current_date-1 where actor_id=pg_temp.fixture('actor');
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio)
select pg_temp.fixture(who),role,pg_temp.fixture('unit'),'c0de0000-0000-4000-8000-000000000002',current_date-1 from (values('reviewer','revisor_tecnico'),('actor','revisor_tecnico'),('actor','cam')) as a(who,role);
-- A separate position is sent using real commands; fixture draft roots remain unchanged.
insert into public.escopos(id,codigo,tipo) values(pg_temp.fixture('review-unit'),'REVIEW-UNIT','unidade');
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio)
select pg_temp.fixture(who),role,pg_temp.fixture('review-unit'),'c0de0000-0000-4000-8000-000000000002',current_date-1 from (values('actor','area_tecnica'),('reviewer','revisor_tecnico'),('actor','revisor_tecnico'),('actor','cam')) as a(who,role);
insert into public.posicoes_esperadas(id,competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id)
values(pg_temp.fixture('review-position'),pg_temp.fixture('competence'),'c0de0000-0000-4000-8000-000000000002',pg_temp.fixture('review-unit'),'c0de0000-0000-4000-8000-000000000004',pg_temp.fixture('actor'),pg_temp.fixture('reviewer'));
create function pg_temp.ctx(who text,role text) returns jsonb language sql security definer set search_path='' as $$ select jsonb_build_object('vinculoId',id,'competenciaId',pg_temp.fixture('competence'),'indicadorId',indicador_id) from public.vinculos where actor_id=pg_temp.fixture(who) and papel=role and escopo_id=pg_temp.fixture('review-unit'); $$;
-- Observe the real RPC effects before rolling back an unexpectedly successful
-- negative probe. Each whitespace case stays independent even in the RED run.
create function pg_temp.review_metrics() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('status',e.estado,'positionVersion',p.lock_version,'competenceVersion',c.lock_version,
  'decisions',(select count(*) from public.decisoes_entrada where revisao_id=e.revisao_atual_id),
  'events',(select count(*) from public.eventos_auditoria where recurso_id=p.id),
  'operations',(select count(*) from public.operacoes_dominio where payload->>'positionId'=p.id::text))
 from public.posicoes_esperadas p join public.competencias c on c.id=p.competencia_id join public.entradas e on e.posicao_id=p.id where p.id=pg_temp.fixture('review-position');
$$;
create function pg_temp.review_reason_probe(p_reason text,p_operation_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_state text;v_message text;v_observed jsonb;
begin
 begin
  perform public.review_position(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('review-position'),4,'return',p_reason,p_operation_id);
  v_state:='success';v_message:='unexpected_success';v_observed:=pg_temp.review_metrics();
  raise exception using errcode='P1000',message='rollback_invalid_reason_probe';
 exception when sqlstate 'P1000' then null;
 when others then get stacked diagnostics v_state=returned_sqlstate,v_message=message_text;v_observed:=pg_temp.review_metrics();
 end;
 return jsonb_build_object('code',v_state,'message',v_message,'observed',v_observed);
end;
$$;
select pg_temp.login_as('actor');
set local role authenticated;
select is(public.save_position_draft(pg_temp.ctx('actor','area_tecnica'),pg_temp.fixture('review-position'),1,'{"estadoDado":"valor","valor":"10","fonte":"Synthetic source","periodoFonte":"2026-10-01","motivo":""}',pg_temp.fixture('save'))->>'version','2','save before review');
select is(public.submit_position(pg_temp.ctx('actor','area_tecnica'),pg_temp.fixture('review-position'),2,pg_temp.fixture('send'))->>'resultValue','8','submit preserves exact result');
select throws_ok($$select public.start_position_review(pg_temp.ctx('actor','area_tecnica'),pg_temp.fixture('review-position'),3,pg_temp.fixture('denied-tech'))$$,'42501','access_denied','technical cannot call review directly');
select throws_ok($$select public.start_position_review(pg_temp.ctx('actor','cam'),pg_temp.fixture('review-position'),3,pg_temp.fixture('denied-cam'))$$,'42501','access_denied','CAM cannot call technical review');
reset role;
-- Historical author now has a reviewer role and current assignment. This is not
-- a reassignment API: it tests independence against immutable revision author.
update public.posicoes_esperadas set informante_id=pg_temp.fixture('reviewer'),revisor_id=pg_temp.fixture('actor') where id=pg_temp.fixture('review-position');
set local role authenticated;
select throws_ok($$select public.start_position_review(pg_temp.ctx('actor','revisor_tecnico'),pg_temp.fixture('review-position'),3,pg_temp.fixture('self'))$$,'42501','access_denied','author_cannot_review_even_with_second_role');
reset role;
update public.posicoes_esperadas set informante_id=pg_temp.fixture('actor'),revisor_id=pg_temp.fixture('reviewer') where id=pg_temp.fixture('review-position');
select pg_temp.login_as('reviewer');
set local role authenticated;
select throws_ok($$select public.review_position(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('review-position'),3,'accept','',pg_temp.fixture('before-claim'))$$,'55000','invalid_state','decision requires claim');
select is(public.start_position_review(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('review-position'),3,pg_temp.fixture('claim'))->>'status','em_revisao','assigned reviewer claims exact revision');
select is(public.start_position_review(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('review-position'),3,pg_temp.fixture('claim'))->>'version','4','authorized replay before version check');
reset role;
insert into auth.users(id,email,aud,role) values(pg_temp.fixture('replacement'),'replacement@example.invalid','authenticated','authenticated');
insert into public.contas_demo(ator_id,rotulo) values(pg_temp.fixture('replacement'),'Replacement reviewer');
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio) values(pg_temp.fixture('replacement'),'revisor_tecnico',pg_temp.fixture('review-unit'),'c0de0000-0000-4000-8000-000000000002',current_date-1);
update public.posicoes_esperadas set revisor_id=pg_temp.fixture('replacement') where id=pg_temp.fixture('review-position');
select pg_temp.login_as('replacement');
set local role authenticated;
select throws_ok($$select public.review_position(pg_temp.ctx('replacement','revisor_tecnico'),pg_temp.fixture('review-position'),4,'accept','',pg_temp.fixture('other-reviewer'))$$,'42501','access_denied','new assignee cannot inherit original reviewers claim');
reset role;
update public.posicoes_esperadas set revisor_id=pg_temp.fixture('reviewer') where id=pg_temp.fixture('review-position');
select pg_temp.login_as('reviewer');
set local role authenticated;
select throws_ok($$select public.review_position(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('review-position'),4,'accept','',pg_temp.fixture('claim'))$$,'22023','operation_payload_mismatch','same key cannot cross command');
select throws_ok($$select public.review_position(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('review-position'),4,'return','  ',pg_temp.fixture('blank'))$$,'22023','invalid_input','return requires trimmed reason');
select is(pg_temp.review_reason_probe(reason,pg_temp.fixture(label)),
 '{"code":"22023","message":"invalid_input","observed":{"status":"em_revisao","positionVersion":4,"competenceVersion":4,"decisions":1,"events":3,"operations":3}}'::jsonb,
 label||': whitespace-only RPC rejection leaves workflow, decisions, events, operations and both versions unchanged')
from (values ('blank-tab',E'\t'),('blank-lf',E'\n'),('blank-cr',E'\r'),('blank-mixed',E'\t\n\r '),('blank-nbsp',U&'\00A0'),('blank-unicode',U&'\1680\2003\2028\2029\202F\205F\3000\FEFF'))a(label,reason);
select throws_ok($$select public.review_position(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('review-position'),4,'return',repeat('x',1001),pg_temp.fixture('long'))$$,'22023','invalid_input','reason limited to 1000');
select throws_ok($$select public.review_position(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('review-position'),3,'accept','',pg_temp.fixture('stale'))$$,'40001','version_conflict','fresh stale decision rejected');
select is(public.review_position(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('review-position'),4,'return',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'||E'Corrigir\tfonte\nsintética'||U&'\FEFF\3000\205F\202F\2029\2028\200A\2009\2008\2007\2006\2005\2004\2003\2002\2001\2000\1680\00A0\0020\000D\000C\000B\000A\0009',pg_temp.fixture('return'))->>'status','devolvida','valid reason accepts every ECMAScript trim edge whitespace');
select is(public.review_position(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('review-position'),4,'return',E'Corrigir\tfonte\nsintética',pg_temp.fixture('return'))->>'version','5','normalized reason replays canonically preserving interior tab and newline');
select is(public.get_position_detail(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('review-position'))->'decisions'->1->>'reason',E'Corrigir\tfonte\nsintética','persisted reason trims only edges and preserves meaningful interior whitespace');
reset role;
select is((select count(*)::integer from public.decisoes_entrada where revisao_id=(select revisao_atual_id from public.entradas where posicao_id=pg_temp.fixture('review-position'))),2,'claim and decision append once');
select is((select lock_version from public.competencias where id=pg_temp.fixture('competence')),5,'four mutations increment competence once each');
select is((select count(*)::integer from public.resultados where entrada_id=(select id from public.entradas where posicao_id=pg_temp.fixture('review-position'))),1,'review never adds or changes numeric result');
select is((select origem from public.revisoes_entrada where id=(select revisao_atual_id from public.entradas where posicao_id=pg_temp.fixture('review-position'))),'Synthetic source','sent payload unchanged');
select is((select count(*)::integer from public.eventos_auditoria where recurso_id=pg_temp.fixture('review-position')),4,'one event per mutation');
select is((select count(*)::integer from public.operacoes_dominio where payload->>'positionId'=pg_temp.fixture('review-position')::text),4,'one completed operation per mutation');
select is((select payload->>'reason' from public.operacoes_dominio where ator_id=pg_temp.fixture('reviewer') and operation_id=pg_temp.fixture('return')),E'Corrigir\tfonte\nsintética','operation stores the same normalized reason as decision');
select ok(not has_function_privilege('authenticated','private.run_academic_command(jsonb,text,jsonb,uuid)','EXECUTE'),'dispatcher remains private');
select ok(not has_function_privilege('authenticated','private.review_academic_position(jsonb,text,jsonb,uuid)','EXECUTE'),'review handler remains private');
select ok(not has_function_privilege('service_role','private.run_academic_submission(jsonb,text,jsonb,uuid)','EXECUTE'),'earlier handler remains private');
select ok(not has_function_privilege('anon','public.start_position_review(jsonb,uuid,integer,uuid)','EXECUTE'),'anonymous has no review grant');
-- Numeric and unavailable acceptance each starts from a real draft and submit.
insert into public.escopos(id,codigo,tipo) select pg_temp.fixture(label),label,'unidade' from unnest(array['accept-value','accept-unavailable'])label;
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio)
select pg_temp.fixture(who),role,pg_temp.fixture(label),'c0de0000-0000-4000-8000-000000000002',current_date-1 from unnest(array['accept-value','accept-unavailable'])label cross join (values('actor','area_tecnica'),('reviewer','revisor_tecnico'))a(who,role);
insert into public.posicoes_esperadas(id,competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id)
select pg_temp.fixture(label||'-position'),pg_temp.fixture('competence'),'c0de0000-0000-4000-8000-000000000002',pg_temp.fixture(label),'c0de0000-0000-4000-8000-000000000004',pg_temp.fixture('actor'),pg_temp.fixture('reviewer') from unnest(array['accept-value','accept-unavailable'])label;
create function pg_temp.variant_ctx(who text,label text) returns jsonb language sql security definer set search_path='' as $$ select jsonb_build_object('vinculoId',id,'competenciaId',pg_temp.fixture('competence'),'indicadorId',indicador_id) from public.vinculos where actor_id=pg_temp.fixture(who) and escopo_id=pg_temp.fixture(label); $$;
select pg_temp.login_as('actor');
set local role authenticated;
select is(public.save_position_draft(pg_temp.variant_ctx('actor','accept-value'),pg_temp.fixture('accept-value-position'),1,'{"estadoDado":"valor","valor":"0","fonte":"Synthetic","periodoFonte":"2026-10-01","motivo":""}',pg_temp.fixture('value-save'))->>'version','2','save zero');
select is(public.submit_position(pg_temp.variant_ctx('actor','accept-value'),pg_temp.fixture('accept-value-position'),2,pg_temp.fixture('value-send'))->>'resultValue','0','submit zero');
select is(public.save_position_draft(pg_temp.variant_ctx('actor','accept-unavailable'),pg_temp.fixture('accept-unavailable-position'),1,'{"estadoDado":"indisponivel","valor":null,"fonte":"Synthetic","periodoFonte":"2026-10-01","motivo":"Source unavailable"}',pg_temp.fixture('unavailable-save'))->>'version','2','save unavailable');
select is(public.submit_position(pg_temp.variant_ctx('actor','accept-unavailable'),pg_temp.fixture('accept-unavailable-position'),2,pg_temp.fixture('unavailable-send'))->>'status','enviada','submit unavailable');
reset role;
select pg_temp.login_as('reviewer');
set local role authenticated;
select is(public.start_position_review(pg_temp.variant_ctx('reviewer','accept-value'),pg_temp.fixture('accept-value-position'),3,pg_temp.fixture('value-claim'))->>'status','em_revisao','claim zero');
select is(public.review_position(pg_temp.variant_ctx('reviewer','accept-value'),pg_temp.fixture('accept-value-position'),4,'accept','',pg_temp.fixture('value-accept'))->>'status','validada','accepted status validada');
select is(public.review_position(pg_temp.variant_ctx('reviewer','accept-value'),pg_temp.fixture('accept-value-position'),4,'accept','',pg_temp.fixture('value-accept'))->>'resultValue','0','replay preserves zero');
select is(public.start_position_review(pg_temp.variant_ctx('reviewer','accept-unavailable'),pg_temp.fixture('accept-unavailable-position'),3,pg_temp.fixture('unavailable-claim'))->>'status','em_revisao','claim unavailable');
select is(public.review_position(pg_temp.variant_ctx('reviewer','accept-unavailable'),pg_temp.fixture('accept-unavailable-position'),4,'accept','Evidence checked',pg_temp.fixture('unavailable-accept'))->>'status','validada','unavailable evidence accepted');
reset role;
select is((select count(*)::integer from public.resultados r join public.entradas e on e.id=r.entrada_id where e.posicao_id=pg_temp.fixture('accept-unavailable-position')),0,'unavailable technical acceptance creates no number');
select is((select count(*)::integer from public.decisoes_entrada d join public.revisoes_entrada r on r.id=d.revisao_id join public.entradas e on e.id=r.entrada_id where e.posicao_id=pg_temp.fixture('accept-unavailable-position') and d.tipo='decidir_indisponibilidade'),0,'technical acceptance never makes CAM decision');
select is((select count(*)::integer from public.revisoes_entrada r join public.entradas e on e.id=r.entrada_id where e.posicao_id=pg_temp.fixture('review-position')),1,'review does not create correction revision');
select pg_temp.login_as('reviewer');
update public.vinculos set ativo=false where actor_id=pg_temp.fixture('reviewer');
set local role authenticated;
select throws_ok($$select public.review_position(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('review-position'),4,'return',E'Corrigir\tfonte\nsintética',pg_temp.fixture('return'))$$,'42501','access_denied','revoked reviewer cannot recover cached receipt');
reset role;
select * from finish();
rollback;
