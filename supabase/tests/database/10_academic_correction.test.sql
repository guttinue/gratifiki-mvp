begin;
select no_plan();
\ir ../support/academic-fixture.psql
insert into auth.users(id,email,aud,role) values(pg_temp.fixture('cam'),'t08-cam@example.invalid','authenticated','authenticated');
insert into public.contas_demo(ator_id,rotulo) values(pg_temp.fixture('actor'),'T08 technical'),(pg_temp.fixture('reviewer'),'T08 reviewer'),(pg_temp.fixture('cam'),'T08 CAM');
insert into public.escopos(id,codigo,tipo) select pg_temp.fixture(label),label,'unidade' from unnest(array['t08','bad-source','bad-reason']) label;
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio)
select pg_temp.fixture(who),role,pg_temp.fixture(label),'c0de0000-0000-4000-8000-000000000002',current_date-1
from unnest(array['t08','bad-source','bad-reason']) label cross join (values('actor','area_tecnica'),('reviewer','revisor_tecnico'),('cam','cam')) a(who,role);
insert into public.posicoes_esperadas(id,competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id)
select pg_temp.fixture(label||'-position'),pg_temp.fixture('competence'),'c0de0000-0000-4000-8000-000000000002',pg_temp.fixture(label),'c0de0000-0000-4000-8000-000000000004',pg_temp.fixture('actor'),pg_temp.fixture('reviewer') from unnest(array['t08','bad-source','bad-reason']) label;
create function pg_temp.ctx(who text,role text,scope text default 't08') returns jsonb language sql security definer set search_path='' as $$select jsonb_build_object('vinculoId',id,'competenciaId',pg_temp.fixture('competence'),'indicadorId',indicador_id) from public.vinculos where actor_id=pg_temp.fixture(who) and papel=role and escopo_id=pg_temp.fixture(scope)$$;
create function pg_temp.metrics(p_id uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('position',to_jsonb(p),'entry',to_jsonb(e),'competenceVersion',c.lock_version,
 'revisions',(select jsonb_agg(to_jsonb(r) order by numero) from public.revisoes_entrada r where r.entrada_id=e.id),
 'results',(select jsonb_agg(to_jsonb(r) order by r.id) from public.resultados r where r.entrada_id=e.id),
 'events',(select count(*) from public.eventos_auditoria where recurso_id=p.id),
 'operations',(select count(*) from public.operacoes_dominio where payload->>'positionId'=p.id::text))
 from public.posicoes_esperadas p join public.competencias c on c.id=p.competencia_id left join public.entradas e on e.posicao_id=p.id where p.id=p_id;
$$;
create function pg_temp.bad_send(scope text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare before_state jsonb;after_state jsonb;code text;msg text;
begin
 before_state:=pg_temp.metrics(pg_temp.fixture(scope||'-position'));
 begin
  perform public.submit_position(pg_temp.ctx('actor','area_tecnica',scope),pg_temp.fixture(scope||'-position'),2,pg_temp.fixture(scope||'-send'));
  code:='success';msg:='unexpected_success';after_state:=pg_temp.metrics(pg_temp.fixture(scope||'-position'));
  raise exception using errcode='P1000';
 exception when sqlstate 'P1000' then null;when others then get stacked diagnostics code=returned_sqlstate,msg=message_text;after_state:=pg_temp.metrics(pg_temp.fixture(scope||'-position'));end;
 return jsonb_build_object('code',code,'message',msg,'changed',before_state<>after_state);
end;$$;
select pg_temp.login_as('actor');set local role authenticated;
select lives_ok($$select public.save_position_draft(pg_temp.ctx('actor','area_tecnica','bad-source'),pg_temp.fixture('bad-source-position'),1,jsonb_build_object('estadoDado','valor','valor','10','fonte',E'\t\n\r'||U&'\00A0','periodoFonte','2026-10-01','motivo',''),pg_temp.fixture('bad-source-save'))$$,'incomplete source can remain a draft');
select is(pg_temp.bad_send('bad-source'),'{"code":"22023","message":"invalid_input","changed":false}'::jsonb,'RPC whitespace-only source rejects atomically without workflow/version/event/operation changes');
select lives_ok($$select public.save_position_draft(pg_temp.ctx('actor','area_tecnica','bad-reason'),pg_temp.fixture('bad-reason-position'),1,jsonb_build_object('estadoDado','indisponivel','valor',null,'fonte','Synthetic','periodoFonte','2026-10-01','motivo',E'\t\n\r'||U&'\00A0'),pg_temp.fixture('bad-reason-save'))$$,'incomplete unavailable reason can remain a draft');
select is(pg_temp.bad_send('bad-reason'),'{"code":"22023","message":"invalid_input","changed":false}'::jsonb,'RPC whitespace-only unavailable reason rejects atomically');
reset role;
create function pg_temp.whitespace_probe(field text,whitespace text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare scope text;input jsonb;r jsonb;before_state jsonb;after_state jsonb;code text;msg text;v integer;
begin
 scope:=case field when 'source' then 'bad-source' else 'bad-reason' end;
 input:=jsonb_build_object('estadoDado',case field when 'source' then 'valor' else 'indisponivel' end,'valor',case field when 'source' then '10' else null end,'fonte',case field when 'source' then whitespace else 'Synthetic' end,'periodoFonte','2026-10-01','motivo',case field when 'source' then '' else whitespace end);
 v:=(pg_temp.metrics(pg_temp.fixture(scope||'-position'))->'position'->>'lock_version')::integer;
 r:=public.save_position_draft(pg_temp.ctx('actor','area_tecnica',scope),pg_temp.fixture(scope||'-position'),v,input,gen_random_uuid());
 before_state:=pg_temp.metrics(pg_temp.fixture(scope||'-position'));
 begin
  perform public.submit_position(pg_temp.ctx('actor','area_tecnica',scope),pg_temp.fixture(scope||'-position'),(r->>'version')::integer,gen_random_uuid());
  code:='success';msg:='unexpected_success';after_state:=pg_temp.metrics(pg_temp.fixture(scope||'-position'));
  raise exception using errcode='P1000';
 exception when sqlstate 'P1000' then null;when others then get stacked diagnostics code=returned_sqlstate,msg=message_text;after_state:=pg_temp.metrics(pg_temp.fixture(scope||'-position'));end;
 return jsonb_build_object('code',code,'message',msg,'changed',before_state<>after_state);
end;$$;
set local role authenticated;
select is(pg_temp.whitespace_probe(field,whitespace),'{"code":"22023","message":"invalid_input","changed":false}'::jsonb,field||'/'||label||': raw RPC whitespace rejects atomically')
from (values('source'),('reason')) f(field) cross join (values('tab',E'\t'),('lf',E'\n'),('cr',E'\r'),('nbsp',U&'\00A0'),('all-js25',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) w(label,whitespace);
select lives_ok($$select public.save_position_draft(pg_temp.ctx('actor','area_tecnica'),pg_temp.fixture('t08-position'),1,jsonb_build_object('estadoDado','valor','valor','10','fonte',E'\t Synthetic\tsource\ntext '||U&'\00A0','periodoFonte','2026-10-01','motivo',E'\t note \n'),pg_temp.fixture('save'))$$,'valid surrounded source is normalized');
select lives_ok($$select public.save_position_draft(pg_temp.ctx('actor','area_tecnica'),pg_temp.fixture('t08-position'),1,jsonb_build_object('estadoDado','valor','valor','10','fonte',E'Synthetic\tsource\ntext','periodoFonte','2026-10-01','motivo','note'),pg_temp.fixture('save'))$$,'normalized draft replays with the original version');
select is(public.submit_position(pg_temp.ctx('actor','area_tecnica'),pg_temp.fixture('t08-position'),2,pg_temp.fixture('send'))->>'resultValue','8','old revision starts with exact 10 to 8');
reset role;select pg_temp.login_as('reviewer');set local role authenticated;
select is(public.start_position_review(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('t08-position'),3,pg_temp.fixture('claim'))->>'version','4','claim old revision');
select is(public.review_position(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('t08-position'),4,'return','Correct synthetic input',pg_temp.fixture('return'))->>'version','5','return old revision');
select pg_temp.login_as('actor');
select throws_ok($$select public.correct_position(pg_temp.ctx('actor','area_tecnica'),pg_temp.fixture('t08-position'),5,'{"estadoDado":"valor","valor":"12","fonte":"Synthetic correction","periodoFonte":"2026-10-01","motivo":"Correction","explanation":"Model 3 only"}',pg_temp.fixture('m2-explanation'))$$,
 '22023','invalid_input','R-25: a model-2 correction accepts no explanation key');
reset role;
select has_function('public','correct_position',array['jsonb','uuid','integer','jsonb','uuid'],'correction RPC exists');
select has_function('public','authorize_position_correction',array['jsonb','uuid','integer','text','uuid'],'CAM rectification RPC exists');
select has_function('public','decide_unavailability',array['jsonb','uuid','integer','text','text','uuid'],'CAM unavailable decision RPC exists');
-- The rest of the behavioral acceptance runs as one caught TAP assertion so
-- the preimplementation RED also records the absent command without aborting.
create function pg_temp.correction_flow() returns void language plpgsql security invoker set search_path='' as $$
declare old_id uuid;new_id uuid;r jsonb;
begin
 perform pg_temp.login_as('actor');
 old_id:=(public.get_position_detail(pg_temp.ctx('actor','area_tecnica'),pg_temp.fixture('t08-position'))->'position'->>'revisionId')::uuid;
 r:=public.correct_position(pg_temp.ctx('actor','area_tecnica'),pg_temp.fixture('t08-position'),5,'{"estadoDado":"valor","valor":"12","fonte":"Synthetic correction","periodoFonte":"2026-10-01","motivo":"Correction"}',pg_temp.fixture('correct'));
 if r->>'resultValue'<>'9.6' or r->>'version'<>'6' or r->>'status'<>'enviada' then raise exception 'wrong new result/version/status: %',r;end if;
 new_id:=(r->>'revisionId')::uuid;if new_id=old_id then raise exception 'old revision overwritten';end if;
 if public.correct_position(pg_temp.ctx('actor','area_tecnica'),pg_temp.fixture('t08-position'),5,'{"estadoDado":"valor","valor":"12.0000","fonte":" Synthetic correction ","periodoFonte":"2026-10-01","motivo":"Correction"}',pg_temp.fixture('correct'))<>r then raise exception 'replay changed';end if;
 perform pg_temp.login_as('reviewer');
 begin perform public.review_position(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('t08-position'),6,'accept','',pg_temp.fixture('no-new-claim'));raise exception 'inherited claim';exception when sqlstate '55000' then null;end;
 perform public.start_position_review(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('t08-position'),6,pg_temp.fixture('claim2'));
 perform public.review_position(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('t08-position'),7,'accept','Independent acceptance',pg_temp.fixture('accept2'));
 perform pg_temp.login_as('cam');
 begin perform public.authorize_position_correction(pg_temp.ctx('cam','cam'),pg_temp.fixture('t08-position'),8,E'\t\n'||U&'\00A0',pg_temp.fixture('blank-cam'));raise exception 'blank CAM reason accepted';exception when sqlstate '22023' then null;end;
 r:=public.authorize_position_correction(pg_temp.ctx('cam','cam'),pg_temp.fixture('t08-position'),8,'  Reopen for synthetic rectification  ',pg_temp.fixture('rectify'));
 if r->>'status'<>'devolvida' or r->>'version'<>'9' then raise exception 'not returned';end if;
 if public.authorize_position_correction(pg_temp.ctx('cam','cam'),pg_temp.fixture('t08-position'),8,'Reopen for synthetic rectification',pg_temp.fixture('rectify'))<>r then raise exception 'CAM replay changed';end if;
 perform pg_temp.login_as('actor');
 r:=public.correct_position(pg_temp.ctx('actor','area_tecnica'),pg_temp.fixture('t08-position'),9,'{"estadoDado":"indisponivel","valor":null,"fonte":"Synthetic unavailable","periodoFonte":"2026-10-01","motivo":"Missing synthetic data"}',pg_temp.fixture('correct-unavailable'));
 if r->>'resultValue' is not null then raise exception 'unavailability became a number';end if;
 perform pg_temp.login_as('cam');
 begin perform public.decide_unavailability(pg_temp.ctx('cam','cam'),pg_temp.fixture('t08-position'),10,'DEMO-REF','Reason',pg_temp.fixture('premature'));raise exception 'no independent acceptance';exception when sqlstate '55000' then null;end;
 perform pg_temp.login_as('reviewer');
 perform public.start_position_review(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('t08-position'),10,pg_temp.fixture('claim3'));
 perform public.review_position(pg_temp.ctx('reviewer','revisor_tecnico'),pg_temp.fixture('t08-position'),11,'accept','Evidence checked',pg_temp.fixture('accept3'));
 perform pg_temp.login_as('cam');
 begin perform public.decide_unavailability(pg_temp.ctx('cam','cam'),pg_temp.fixture('t08-position'),12,E'\t\n','Reason',pg_temp.fixture('blank-ref'));raise exception 'blank ref';exception when sqlstate '22023' then null;end;
 r:=public.decide_unavailability(pg_temp.ctx('cam','cam'),pg_temp.fixture('t08-position'),12,' DEMO-REF ',' Reason ',pg_temp.fixture('decide'));
 if r->>'version'<>'13' or r->>'resultValue' is not null or r->>'status'<>'validada' then raise exception 'wrong unavailability decision';end if;
 if public.decide_unavailability(pg_temp.ctx('cam','cam'),pg_temp.fixture('t08-position'),12,'DEMO-REF','Reason',pg_temp.fixture('decide'))<>r then raise exception 'decision replay changed';end if;
end;$$;
set local role authenticated;
select lives_ok('select pg_temp.correction_flow()','versioned correction, new independent claim, CAM return and explicit null decision');
reset role;
select is((select trim_scale(r.valor)::text from public.resultados r join public.revisoes_entrada v on v.id=r.revisao_id join public.entradas e on e.id=v.entrada_id where e.posicao_id=pg_temp.fixture('t08-position') and v.numero=1),'8','previous result preserved by revision ID');
select is((select trim_scale(r.valor)::text from public.resultados r join public.revisoes_entrada v on v.id=r.revisao_id join public.entradas e on e.id=v.entrada_id where e.posicao_id=pg_temp.fixture('t08-position') and v.numero=2),'9.6','new result remains separate');
select is((select count(*)::integer from public.decisoes_entrada d join public.revisoes_entrada v on v.id=d.revisao_id join public.entradas e on e.id=v.entrada_id where e.posicao_id=pg_temp.fixture('t08-position') and v.numero=2 and d.tipo='validar'),1,'old technical acceptance retained for prior exact revision');
select is((select count(*)::integer from public.resultados r join public.revisoes_entrada v on v.id=r.revisao_id join public.entradas e on e.id=v.entrada_id where e.posicao_id=pg_temp.fixture('t08-position') and v.numero=3),0,'unavailable revision has no result/memory');
select is((select origem from public.revisoes_entrada v join public.entradas e on e.id=v.entrada_id where e.posicao_id=pg_temp.fixture('t08-position') and v.numero=1),E'Synthetic\tsource\ntext','source edges normalized before send, interior tab/newline preserved');
select is((select lock_version from public.posicoes_esperadas where id=pg_temp.fixture('t08-position')),13,'each correction/CAM command increments position once; retries do not');
select is((select count(*)::integer from public.eventos_auditoria where recurso_id=pg_temp.fixture('t08-position')),12,'exactly one event per successful mutation');
select is((select count(*)::integer from public.operacoes_dominio where payload->>'positionId'=pg_temp.fixture('t08-position')::text),12,'exactly one operation per mutation');
select pg_temp.login_as('cam');set local role authenticated;
select throws_ok($$select public.authorize_position_correction(pg_temp.ctx('cam','cam','bad-source'),pg_temp.fixture('t08-position'),13,'wrong selected scope',pg_temp.fixture('wrong-scope'))$$,'42501','access_denied','CAM cycle-wide read never broadens selected command target');
select throws_ok($$select public.decide_unavailability(pg_temp.ctx('cam','cam'),pg_temp.fixture('t08-position'),13,'DEMO-REF','Reason',pg_temp.fixture('second-decision'))$$,'55000','invalid_state','same revision cannot receive second CAM unavailability decision');
select throws_ok($$select public.decide_unavailability(pg_temp.ctx('cam','cam'),pg_temp.fixture('t08-position'),12,'DEMO-REF','Changed',pg_temp.fixture('decide'))$$,'22023','operation_payload_mismatch','canonical reason changes never replay another payload');
select throws_ok($$select public.authorize_position_correction(pg_temp.ctx('cam','cam'),pg_temp.fixture('t08-position'),8,'Reopen for synthetic rectification',pg_temp.fixture('stale-cam'))$$,'40001','version_conflict','new operation with old version rejects');
select is(public.authorize_position_correction(pg_temp.ctx('cam','cam'),pg_temp.fixture('t08-position'),13,'Another correction',pg_temp.fixture('rectify-again'))->>'version','14','CAM may return a decided unavailable revision without deleting history');
reset role;select pg_temp.login_as('actor');set local role authenticated;
select throws_ok($$select public.correct_position(pg_temp.ctx('actor','area_tecnica'),pg_temp.fixture('t08-position'),5,'{"estadoDado":"valor","valor":"12","fonte":"Synthetic correction","periodoFonte":"2026-10-01","motivo":"Correction"}',pg_temp.fixture('stale-correct'))$$,'40001','version_conflict','new correction cannot overwrite old expected version');
select throws_ok($$select public.correct_position(pg_temp.ctx('actor','area_tecnica'),pg_temp.fixture('t08-position'),14,'{"estadoDado":"valor","valor":"12","fonte":"\t\n\r ","periodoFonte":"2026-10-01","motivo":"Correction"}',pg_temp.fixture('bad-correction'))$$,'22023','invalid_input','correction must contain a real source');
reset role;
update public.competencias set estado='em_consolidacao' where id=pg_temp.fixture('competence');
set local role authenticated;
select throws_ok($$select public.correct_position(pg_temp.ctx('actor','area_tecnica'),pg_temp.fixture('t08-position'),14,'{"estadoDado":"valor","valor":"12","fonte":"Synthetic","periodoFonte":"2026-10-01","motivo":""}',pg_temp.fixture('consolidating'))$$,'55000','invalid_state','consolidating cycle cannot accept correction');
reset role;update public.competencias set estado='fechada' where id=pg_temp.fixture('competence');set local role authenticated;
select throws_ok($$select public.correct_position(pg_temp.ctx('actor','area_tecnica'),pg_temp.fixture('t08-position'),14,'{"estadoDado":"valor","valor":"12","fonte":"Synthetic","periodoFonte":"2026-10-01","motivo":""}',pg_temp.fixture('closed'))$$,'55000','invalid_state','closed cycle cannot accept correction');
reset role;update public.competencias set estado='aberta' where id=pg_temp.fixture('competence');
-- Administrative reassignment is only a transactional fixture until T13.
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio) values(pg_temp.fixture('reviewer'),'area_tecnica',pg_temp.fixture('t08'),'c0de0000-0000-4000-8000-000000000002',current_date-1);
update public.posicoes_esperadas set informante_id=pg_temp.fixture('reviewer'),revisor_id=pg_temp.fixture('cam') where id=pg_temp.fixture('t08-position');
set local role authenticated;
select throws_ok($$select public.correct_position(pg_temp.ctx('actor','area_tecnica'),pg_temp.fixture('t08-position'),5,'{"estadoDado":"valor","valor":"12","fonte":"Synthetic correction","periodoFonte":"2026-10-01","motivo":"Correction"}',pg_temp.fixture('correct'))$$,'42501','access_denied','lost assignee cannot recover cached correction response');
reset role;select pg_temp.login_as('reviewer');set local role authenticated;
select is(jsonb_array_length(public.get_position_detail(pg_temp.ctx('reviewer','area_tecnica'),pg_temp.fixture('t08-position'))->'revisions'),3,'current reassigned informant sees necessary earlier evidence');
select is(public.correct_position(pg_temp.ctx('reviewer','area_tecnica'),pg_temp.fixture('t08-position'),14,jsonb_build_object('estadoDado','valor','valor','12','fonte',E'\t New\tsource\ntext'||U&'\FEFF','periodoFonte',E'\t2026-10-01\n','motivo',E'\t New reason\n'),pg_temp.fixture('replacement-correct'))->>'resultValue','9.6','new informant corrects with pinned rule and valid surrounded fields');
select is(public.correct_position(pg_temp.ctx('reviewer','area_tecnica'),pg_temp.fixture('t08-position'),14,jsonb_build_object('estadoDado','valor','valor','12','fonte',E'New\tsource\ntext','periodoFonte','2026-10-01','motivo','New reason'),pg_temp.fixture('replacement-correct'))->>'version','15','surrounded correction replays preserving interior whitespace');
reset role;
select is((select v.autor_id from public.revisoes_entrada v join public.entradas e on e.id=v.entrada_id where e.posicao_id=pg_temp.fixture('t08-position') and v.numero=1),pg_temp.fixture('actor'),'reassignment does not transfer past authorship');
select is((select v.autor_id from public.revisoes_entrada v join public.entradas e on e.id=v.entrada_id where e.posicao_id=pg_temp.fixture('t08-position') and v.numero=4),pg_temp.fixture('reviewer'),'new revision belongs only to current informant');
select throws_ok($$update public.revisoes_entrada set origem='overwrite' where entrada_id=(select id from public.entradas where posicao_id=pg_temp.fixture('t08-position')) and numero=1$$,'55000','sent_revision_is_immutable','old sent payload is physically immutable');
select throws_ok($$update public.decisoes_entrada set motivo='overwrite' where tipo='validar' and revisao_id=(select id from public.revisoes_entrada where entrada_id=(select id from public.entradas where posicao_id=pg_temp.fixture('t08-position')) and numero=2)$$,'55000','immutable_record','old acceptance remains physically immutable');
select ok(not has_function_privilege('authenticated','private.correct_academic_position(jsonb,text,jsonb,uuid)','EXECUTE'),'correction handler not browser executable');
select ok(not has_function_privilege('service_role','private.correction_input(jsonb)','EXECUTE'),'input helper not service-role executable');
select ok(not has_function_privilege('anon','public.correct_position(jsonb,uuid,integer,jsonb,uuid)','EXECUTE'),'anonymous correction denied');
select * from finish();rollback;
