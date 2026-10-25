begin;
select no_plan();
\ir ../support/academic-fixture.psql
insert into auth.users(id,email,aud,role) values(pg_temp.fixture('cam'),'t09-cam@example.invalid','authenticated','authenticated'),(pg_temp.fixture('partial'),'t09-partial@example.invalid','authenticated','authenticated');
insert into public.contas_demo(ator_id,rotulo) select pg_temp.fixture(who),who from unnest(array['actor','reviewer','cam','partial']) who;
insert into public.competencias(id,codigo,referencia,estado,modelo) values(pg_temp.fixture('cycle'),'T09-2026-10','2026-10-01','aberta',2);
insert into public.escopos(id,codigo,tipo) select pg_temp.fixture('scope-'||n),'T09-'||n,case when n in (1,4) then 'distrito' else 'unidade' end from generate_series(1,6)n;
insert into public.territorios_competencia(competencia_id,unidade_id,distrito_id) select pg_temp.fixture('cycle'),pg_temp.fixture('scope-'||n),pg_temp.fixture('scope-'||case when n<4 then 1 else 4 end) from unnest(array[2,3,5,6])n;
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio)
select pg_temp.fixture(who),role,pg_temp.fixture('scope-'||n),'c0de0000-0000-4000-8000-000000000002',current_date-1 from generate_series(1,6)n cross join(values('actor','area_tecnica'),('reviewer','revisor_tecnico'),('cam','cam'))a(who,role);
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio) values(pg_temp.fixture('partial'),'cam',pg_temp.fixture('scope-1'),'c0de0000-0000-4000-8000-000000000002',current_date-1);
insert into public.posicoes_esperadas(id,competencia_id,indicador_id,alvo_id,regra_id,informante_id,revisor_id)
select pg_temp.fixture('pos-'||n),pg_temp.fixture('cycle'),'c0de0000-0000-4000-8000-000000000002',pg_temp.fixture('scope-'||n),'c0de0000-0000-4000-8000-000000000004',pg_temp.fixture('actor'),pg_temp.fixture('reviewer') from generate_series(1,6)n;
create function pg_temp.ctx(who text,n integer default 1) returns jsonb language sql security definer as $$select jsonb_build_object('vinculoId',id,'competenciaId',pg_temp.fixture('cycle'),'indicadorId',indicador_id) from public.vinculos where actor_id=pg_temp.fixture(who) and escopo_id=pg_temp.fixture('scope-'||n) and indicador_id is not null;$$;
create function pg_temp.cycle_flow() returns void language plpgsql security invoker as $$
declare n integer;r jsonb;c jsonb;snapshot uuid;v integer;op uuid:=pg_temp.fixture('close');
begin
 for n in 1..5 loop
  perform pg_temp.login_as('actor');r:=public.save_position_draft(pg_temp.ctx('actor',n),pg_temp.fixture('pos-'||n),1,'{"estadoDado":"valor","valor":"10","fonte":"Synthetic T09","periodoFonte":"2026-10-01","motivo":""}',gen_random_uuid());
  perform public.submit_position(pg_temp.ctx('actor',n),pg_temp.fixture('pos-'||n),(r->>'version')::integer,gen_random_uuid());
 end loop;
 perform pg_temp.login_as('cam');c:=public.get_cycle_checklist(pg_temp.ctx('cam'));
 if c->>'expected'<>'6' or c->>'received'<>'5' or (c->>'canClose')::boolean or (c->>'canConsolidate')::boolean then raise exception 'missing sixth position hidden: %',c;end if;
 begin perform public.transition_cycle(pg_temp.ctx('cam'),(c->>'version')::integer,'consolidate','','',gen_random_uuid());raise exception 'missing accepted';exception when sqlstate '55000' then null;end;
 perform pg_temp.login_as('actor');r:=public.save_position_draft(pg_temp.ctx('actor',6),pg_temp.fixture('pos-6'),1,'{"estadoDado":"indisponivel","valor":null,"fonte":"Synthetic unavailable","periodoFonte":"2026-10-01","motivo":"No source"}',gen_random_uuid());
 perform public.submit_position(pg_temp.ctx('actor',6),pg_temp.fixture('pos-6'),(r->>'version')::integer,gen_random_uuid());
 perform pg_temp.login_as('cam');c:=public.get_cycle_checklist(pg_temp.ctx('cam'));perform public.transition_cycle(pg_temp.ctx('cam'),(c->>'version')::integer,'consolidate','','',gen_random_uuid());
 perform pg_temp.login_as('reviewer');r:=public.start_position_review(pg_temp.ctx('reviewer'),pg_temp.fixture('pos-1'),3,gen_random_uuid());
 perform public.review_position(pg_temp.ctx('reviewer'),pg_temp.fixture('pos-1'),(r->>'version')::integer,'return','Correct synthetic source',gen_random_uuid());
 perform pg_temp.login_as('cam');c:=public.get_cycle_checklist(pg_temp.ctx('cam'));
 if (c->>'canClose')::boolean then raise exception 'returned position eligible';end if;
 begin perform public.transition_cycle(pg_temp.ctx('cam'),(c->>'version')::integer,'reopen',E'\t\n','',gen_random_uuid());raise exception 'blank reopen accepted';exception when sqlstate '22023' then null;end;
 perform public.transition_cycle(pg_temp.ctx('cam'),(c->>'version')::integer,'reopen','Correction required','',gen_random_uuid());
 perform pg_temp.login_as('actor');perform public.correct_position(pg_temp.ctx('actor'),pg_temp.fixture('pos-1'),5,'{"estadoDado":"valor","valor":"12","fonte":"Corrected synthetic","periodoFonte":"2026-10-01","motivo":"Returned"}',gen_random_uuid());
 perform pg_temp.login_as('reviewer');
 for n in 1..6 loop
  v:=case when n=1 then 6 else 3 end;
  r:=public.start_position_review(pg_temp.ctx('reviewer',n),pg_temp.fixture('pos-'||n),v,gen_random_uuid());
  perform public.review_position(pg_temp.ctx('reviewer',n),pg_temp.fixture('pos-'||n),(r->>'version')::integer,'accept','Independent synthetic review',gen_random_uuid());
 end loop;
 perform pg_temp.login_as('cam');c:=public.get_cycle_checklist(pg_temp.ctx('cam'));perform public.transition_cycle(pg_temp.ctx('cam'),(c->>'version')::integer,'consolidate','','',gen_random_uuid());
 c:=public.get_cycle_checklist(pg_temp.ctx('cam'));
 if (c->>'canClose')::boolean or c->>'decidedUnavailable'<>'0' then raise exception 'missing CAM decision hidden';end if;
 perform public.transition_cycle(pg_temp.ctx('cam'),(c->>'version')::integer,'reopen','Explicit unavailable decision','',gen_random_uuid());
 perform public.decide_unavailability(pg_temp.ctx('cam',6),pg_temp.fixture('pos-6'),5,'DEMO-UNAVAILABLE-T09','Accepted evidence',gen_random_uuid());
 c:=public.get_cycle_checklist(pg_temp.ctx('cam'));perform public.transition_cycle(pg_temp.ctx('cam'),(c->>'version')::integer,'consolidate','','',gen_random_uuid());
 c:=public.get_cycle_checklist(pg_temp.ctx('cam'));v:=(c->>'version')::integer;
 if not(c->>'canClose')::boolean or c->>'reviewed'<>'6' or c->>'decidedUnavailable'<>'1' then raise exception 'complete cycle not eligible: %',c;end if;
 begin perform public.transition_cycle(pg_temp.ctx('cam'),v,'close','','DEMO-DECISAO-',op);raise exception 'empty suffix accepted';exception when sqlstate '22023' then null;end;
 r:=public.transition_cycle(pg_temp.ctx('cam'),v,'close','Synthetic only','DEMO-DECISAO-T09',op);snapshot:=(r->>'resourceId')::uuid;
 if r->>'status'<>'fechada' or (r->>'version')::integer<>v+1 then raise exception 'invalid close receipt';end if;
 if public.transition_cycle(pg_temp.ctx('cam'),v,'close',' Synthetic only ',' DEMO-DECISAO-T09 ',op)<>r then raise exception 'close replay changed';end if;
 c:=public.get_cycle_checklist(pg_temp.ctx('cam'));
 if c->>'state'<>'fechada' or c->>'snapshotId'<>snapshot::text or c->>'publication'<>'nao_publicada' then raise exception 'server reload lost closed snapshot: %',c;end if;
 begin perform public.transition_cycle(pg_temp.ctx('cam'),v,'reopen','Synthetic only','DEMO-DECISAO-T09',op);raise exception 'different command replay';exception when sqlstate '22023' then null;end;
 begin perform public.publish_cycle_demo(pg_temp.ctx('cam'),snapshot,'DEMO-PUBLICACAO-',gen_random_uuid());raise exception 'empty pub suffix';exception when sqlstate '22023' then null;end;
 perform public.publish_cycle_demo(pg_temp.ctx('cam'),snapshot,'DEMO-PUBLICACAO-T09',pg_temp.fixture('publish'));
 perform public.publish_cycle_demo(pg_temp.ctx('cam'),snapshot,' DEMO-PUBLICACAO-T09 ',pg_temp.fixture('publish'));
 c:=public.get_cycle_checklist(pg_temp.ctx('cam'));if c->>'publication'<>'publicada_demo' then raise exception 'publication lost on read';end if;
 perform pg_temp.login_as('partial');c:=public.get_cycle_checklist(pg_temp.ctx('partial'));
 if c->>'expected'<>'1' or c->>'snapshotId' is not null or c->>'publicationId' is not null or (c->>'fullCoverage')::boolean then raise exception 'global snapshot leaked: %',c;end if;
 begin perform public.publish_cycle_demo(pg_temp.ctx('partial'),snapshot,'DEMO-PUBLICACAO-X',gen_random_uuid());raise exception 'partial publishes';exception when sqlstate '42501' then null;end;
end;$$;
select has_function('public','get_cycle_checklist',array['jsonb'],'checklist RPC');
set local role authenticated;
select lives_ok('select pg_temp.cycle_flow()','six positions, consolidation review/return, correction, immutable close and separate publication');
reset role;
select is((select count(*)::integer from public.fechamentos where competencia_id=pg_temp.fixture('cycle')),1,'idempotent one snapshot');
select is((select count(*)::integer from public.itens_fechamento i join public.fechamentos f on f.id=i.fechamento_id where f.competencia_id=pg_temp.fixture('cycle')),6,'snapshot holds all six expected positions');
select is((select count(*)::integer from public.itens_fechamento i join public.fechamentos f on f.id=i.fechamento_id where f.competencia_id=pg_temp.fixture('cycle') and estado_dado='valor'),5,'five calculable, no fabricated sixth number');
select is((select trim_scale(valor_resultado)::text from public.itens_fechamento where posicao_id=pg_temp.fixture('pos-1')),'9.6','exact corrected revision frozen');
select throws_ok($$update public.itens_fechamento set alvo_codigo='overwrite' where posicao_id=pg_temp.fixture('pos-1')$$,'55000','immutable_record','snapshot immutable directly');
select throws_ok($$update public.posicoes_esperadas set informante_id=pg_temp.fixture('cam') where id=pg_temp.fixture('pos-1')$$,'55000','closed_cycle_is_immutable','closed assignment immutable directly');
select throws_ok($$update public.entradas set estado='devolvida' where posicao_id=pg_temp.fixture('pos-1')$$,'55000','closed_cycle_is_immutable','closed header immutable directly');
select is((select count(*)::integer from public.publicacoes p join public.fechamentos f on f.id=p.fechamento_id where f.competencia_id=pg_temp.fixture('cycle')),1,'publication retry creates one publication');
select is((select count(*)::integer from public.eventos_auditoria where acao='ciclo_fechado' and recurso_id=pg_temp.fixture('cycle')),1,'one atomic close audit');
select is((select distrito_id from public.itens_fechamento where posicao_id=pg_temp.fixture('pos-2')),pg_temp.fixture('scope-1'),'frozen territory copied into snapshot');
update public.escopos set distrito_id=pg_temp.fixture('scope-4') where id=pg_temp.fixture('scope-2');
select is((select distrito_id from public.itens_fechamento where posicao_id=pg_temp.fixture('pos-2')),pg_temp.fixture('scope-1'),'future catalogue change does not reclassify snapshot');
select throws_ok($$update public.regras set fator=0.5 where id='c0de0000-0000-4000-8000-000000000004'$$,'55000','used_rule_is_immutable','closed pinned rule immutable directly');
select throws_ok($$update public.competencias set estado='aberta' where id=pg_temp.fixture('cycle')$$,'55000','closed_cycle_is_immutable','closed competence cannot reopen directly');
-- A cached response is still confidential after even ONE explicit CAM link is revoked.
update public.vinculos set ativo=false where actor_id=pg_temp.fixture('cam') and escopo_id=pg_temp.fixture('scope-6');
select set_config('t09.close_version',(select payload->>'expectedVersion' from public.operacoes_dominio where operation_id=pg_temp.fixture('close')),true);
select pg_temp.login_as('cam');set local role authenticated;
select is(public.get_cycle_checklist(pg_temp.ctx('cam'))->'snapshotId','null'::jsonb,'lost full coverage hides previously accessible global snapshot');
select throws_ok($$select public.transition_cycle(pg_temp.ctx('cam'),current_setting('t09.close_version')::integer,'close','Synthetic only','DEMO-DECISAO-T09',pg_temp.fixture('close'))$$,'42501','access_denied','cached operation cannot leak after revocation');
reset role;
select ok(not has_function_privilege('anon','public.get_cycle_checklist(jsonb)','execute'),'anonymous denied');
select ok(not has_function_privilege('authenticated','private.cycle_checklist(jsonb)','execute'),'private read helper denied');
-- Separate still-open fixture: non-applicability is explicit, not absence/zero.
update public.posicoes_esperadas set aplicavel=false where id=pg_temp.fixture('other_position');
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio) select pg_temp.fixture('cam'),'cam',pg_temp.fixture(s),'c0de0000-0000-4000-8000-000000000002',current_date-1 from unnest(array['unit','district'])s;
select set_config('t09.na_context',(select jsonb_build_object('vinculoId',id,'competenciaId',pg_temp.fixture('competence'),'indicadorId',indicador_id)::text from public.vinculos where actor_id=pg_temp.fixture('cam') and escopo_id=pg_temp.fixture('unit')),true);
set local role authenticated;
select is(public.get_cycle_checklist(current_setting('t09.na_context')::jsonb)->>'notApplicable','1','non-applicable position counted explicitly');
select is(public.get_cycle_checklist(current_setting('t09.na_context')::jsonb)->>'expected','2','non-applicable remains part of the expected universe');
select is(public.get_cycle_checklist(current_setting('t09.na_context')::jsonb)->>'received','0','non-applicable/draft is not an invented received numeric result');
reset role;
-- Adversarial transaction-only payload/result fixture; the TECHNICAL ACCEPTANCE
-- below still goes through real claim + review RPCs (no forged acceptance).
insert into public.territorios_competencia(competencia_id,unidade_id,distrito_id) values(pg_temp.fixture('competence'),pg_temp.fixture('unit'),pg_temp.fixture('district'));
update public.entradas set estado='enviada',revisao_atual_id=pg_temp.fixture('revision') where id=pg_temp.fixture('entry');
insert into public.resultados(entrada_id,regra_id,valor,memoria,revisao_id) values(pg_temp.fixture('entry'),'c0de0000-0000-4000-8000-000000000004',99,'{"synthetic":true}',pg_temp.fixture('revision'));
insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,vigencia_inicio) values(pg_temp.fixture('reviewer'),'revisor_tecnico',pg_temp.fixture('unit'),'c0de0000-0000-4000-8000-000000000002',current_date-1);
select set_config('t09.review_context',(select jsonb_build_object('vinculoId',id,'competenciaId',pg_temp.fixture('competence'),'indicadorId',indicador_id)::text from public.vinculos where actor_id=pg_temp.fixture('reviewer') and escopo_id=pg_temp.fixture('unit') and indicador_id is not null),true);
select pg_temp.login_as('reviewer');set local role authenticated;
select lives_ok($$select public.start_position_review(current_setting('t09.review_context')::jsonb,pg_temp.fixture('position'),1,pg_temp.fixture('bad-memory-claim'));select public.review_position(current_setting('t09.review_context')::jsonb,pg_temp.fixture('position'),2,'accept','Independent evidence, corrupted old result is not recalculated',pg_temp.fixture('bad-memory-accept'))$$,'independent acceptance uses real workflow for adversarial result fixture');
reset role;select pg_temp.login_as('cam');set local role authenticated;
select is(public.get_cycle_checklist(current_setting('t09.na_context')::jsonb)->'blockers'->0->>'code','memory_inconsistent','joint revision/rule/value/memory validation catches corrupted result');
select public.transition_cycle(current_setting('t09.na_context')::jsonb,(public.get_cycle_checklist(current_setting('t09.na_context')::jsonb)->>'version')::integer,'consolidate','','',pg_temp.fixture('bad-memory-consolidate'));
select throws_ok($$select public.transition_cycle(current_setting('t09.na_context')::jsonb,(public.get_cycle_checklist(current_setting('t09.na_context')::jsonb)->>'version')::integer,'close','','DEMO-DECISAO-BAD',pg_temp.fixture('bad-memory-close'))$$,'55000','invalid_state','technical acceptance alone cannot close inconsistent memory');
reset role;
select * from finish();rollback;
