begin;
-- Territory is copied, not re-resolved from today's mutable scope catalogue.
alter table public.itens_fechamento add column distrito_id uuid references public.escopos(id),add column distrito_codigo text;

-- One row per authorized EXPECTED position. All joins verify their joint
-- competence/indicator/target/revision/rule identity, not just independent IDs.
create function private.cycle_positions(p_context jsonb)
returns table(position_id uuid,applicable boolean,received boolean,reviewed boolean,unavailable boolean,decided boolean,problem text)
language sql stable set search_path='' as $$
 select p.id,p.aplicavel,
  p.aplicavel and v.enviada_em is not null and e.estado<>'rascunho',
  p.aplicavel and e.estado='validada' and exists(select 1 from public.decisoes_entrada d where d.revisao_id=v.id and d.tipo='validar' and d.ator_id<>v.autor_id),
  p.aplicavel and v.enviada_em is not null and v.estado_dado='indisponivel',
  p.aplicavel and v.estado_dado='indisponivel' and exists(select 1 from public.decisoes_entrada d where d.revisao_id=v.id and d.tipo='decidir_indisponibilidade' and private.trim_academic_text(d.referencia)<>'' and private.trim_academic_text(d.motivo)<>''),
  case
   when rule.id is null or rule.fator<=0 or rule.fator>1 or s.tipo is null or s.tipo not in ('unidade','distrito') then 'rule_inconsistent'
   when s.tipo='unidade' and not exists(select 1 from public.territorios_competencia t join public.escopos district on district.id=t.distrito_id and district.tipo='distrito' where t.competencia_id=p.competencia_id and t.unidade_id=p.alvo_id) then 'territory_missing'
   when not p.aplicavel then null
   when e.id is null or v.id is null or v.enviada_em is null or e.estado in ('rascunho','devolvida') then 'missing_submission'
   when e.estado<>'validada' or not exists(select 1 from public.decisoes_entrada d where d.revisao_id=v.id and d.tipo='validar' and d.ator_id<>v.autor_id) then 'review_pending'
   when v.estado_dado='indisponivel' and (r.id is not null or not exists(select 1 from public.decisoes_entrada d where d.revisao_id=v.id and d.tipo='decidir_indisponibilidade' and private.trim_academic_text(d.referencia)<>'' and private.trim_academic_text(d.motivo)<>'')) then 'unavailability_pending'
   when v.estado_dado='valor' and (r.id is null or r.regra_id<>p.regra_id or r.entrada_id<>e.id or v.valor is null or r.valor<>v.valor*rule.fator or r.memoria is distinct from jsonb_build_object('synthetic',true,'revisionId',v.id,'ruleId',rule.id,'ruleVersion',rule.versao,'factor',trim_scale(rule.fator)::text,'inputValue',trim_scale(v.valor)::text,'resultValue',trim_scale(r.valor)::text)) then 'memory_inconsistent'
   else null end
 from public.posicoes_esperadas p
 join public.escopos s on s.id=p.alvo_id
 left join public.regras rule on rule.id=p.regra_id and rule.indicador_id=p.indicador_id
 left join public.entradas e on e.posicao_id=p.id and e.competencia_id=p.competencia_id and e.indicador_id=p.indicador_id and e.escopo_id=p.alvo_id
 left join public.revisoes_entrada v on v.id=e.revisao_atual_id and v.entrada_id=e.id
 left join public.resultados r on r.revisao_id=v.id
 where p.competencia_id=(p_context->>'competenciaId')::uuid and p.indicador_id=(p_context->>'indicadorId')::uuid and p_context->'positionIds' ? p.id::text;
$$;
create function private.cycle_checklist(p_context jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare c public.competencias%rowtype; f public.fechamentos%rowtype; pub public.publicacoes%rowtype;
 total integer;expected integer;received integer;reviewed integer;unavailable integer;decided integer;na integer;full_coverage boolean;blockers jsonb;problems integer;missing integer;
begin
 select * into c from public.competencias where id=(p_context->>'competenciaId')::uuid;
 select count(*) into total from public.posicoes_esperadas where competencia_id=c.id;
 select count(*),count(*)filter(where x.received),count(*)filter(where x.reviewed),count(*)filter(where x.unavailable),count(*)filter(where x.decided),count(*)filter(where not x.applicable),count(*)filter(where x.problem is not null),count(*)filter(where x.applicable and (not coalesce(x.received,false) or x.problem='missing_submission')) into expected,received,reviewed,unavailable,decided,na,problems,missing from private.cycle_positions(p_context)x;
 full_coverage:=total>0 and expected=total;
 select coalesce(jsonb_agg(jsonb_build_object('positionId',position_id,'code',problem,'message',case problem when 'missing_submission' then 'Envio ausente, rascunho ou devolução pendente.' when 'review_pending' then 'Conferência técnica pendente.' when 'unavailability_pending' then 'Indisponibilidade sem decisão CAM ou com número indevido.' when 'memory_inconsistent' then 'Memória de cálculo inconsistente.' when 'territory_missing' then 'Relação territorial congelada ausente.' else 'Regra ou alvo inconsistente.' end) order by position_id),'[]'::jsonb) into blockers from private.cycle_positions(p_context) where problem is not null;
 if not full_coverage then blockers:=jsonb_build_array(jsonb_build_object('positionId',null,'code','coverage_incomplete','message','Ação global exige cobertura CAM explícita de todo o ciclo.'))||blockers;end if;
 if full_coverage then
  select * into f from public.fechamentos where competencia_id=c.id;
  select * into pub from public.publicacoes where fechamento_id=f.id;
 end if;
 return jsonb_build_object('version',c.lock_version,'state',c.estado,'expected',expected,'received',received,'reviewed',reviewed,'unavailable',unavailable,'decidedUnavailable',decided,'notApplicable',na,'fullCoverage',full_coverage,
  'canConsolidate',full_coverage and c.estado='aberta' and missing=0,'canClose',full_coverage and c.estado='em_consolidacao' and problems=0,
  'snapshotId',f.id,'publication',case when pub.id is not null then 'publicada_demo' else 'nao_publicada' end,'publicationId',pub.id,'blockers',blockers);
end;$$;
create function public.get_cycle_checklist(p_contexto jsonb) returns jsonb
language sql stable security definer set search_path='' as $$select private.cycle_checklist(private.require_academic_context(p_contexto,'cycle_read'));$$;

create function private.transition_academic_cycle(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctx jsonb;c public.competencias%rowtype;f public.fechamentos%rowtype;pub public.publicacoes%rowtype;old_op public.operacoes_dominio%rowtype;
 expected integer;action text;reason text;reference text;sid uuid;canonical jsonb;response jsonb;checklist jsonb;capability text;
begin
 if p_command='transition_cycle' then capability:='cycle_transition';elsif p_command='publish_cycle_demo' then capability:='cycle_publish';else raise exception using errcode='42501',message='access_denied';end if;
 ctx:=private.require_academic_context(p_contexto,capability);
 if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='22023',message='invalid_input';end if;
 if jsonb_typeof(p_payload->'reference') is distinct from 'string' then raise exception using errcode='22023',message='invalid_input';end if;
 reference:=private.trim_academic_text(p_payload->>'reference');
 if length(reference)>500 then raise exception using errcode='22023',message='invalid_input';end if;
 if p_command='transition_cycle' then
  if (select count(*) from jsonb_object_keys(p_payload))<>4 or exists(select 1 from jsonb_object_keys(p_payload)k where k not in ('expectedVersion','action','reason','reference')) or jsonb_typeof(p_payload->'action') is distinct from 'string' or jsonb_typeof(p_payload->'reason') is distinct from 'string' then raise exception using errcode='22023',message='invalid_input';end if;
  begin expected:=(p_payload->>'expectedVersion')::integer;exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='invalid_input';end;
  action:=p_payload->>'action';reason:=private.trim_academic_text(p_payload->>'reason');
  if expected is null or expected<1 or action not in ('consolidate','reopen','close') or length(reason)>1000 or (action='reopen' and reason='') or (action='close' and (reference not like 'DEMO-DECISAO-%' or private.trim_academic_text(substr(reference,14))='')) then raise exception using errcode='22023',message='invalid_input';end if;
  canonical:=jsonb_build_object('context',p_contexto,'expectedVersion',expected,'action',action,'reason',reason,'reference',reference);
 else
  if (select count(*) from jsonb_object_keys(p_payload))<>2 or exists(select 1 from jsonb_object_keys(p_payload)k where k not in ('snapshotId','reference')) then raise exception using errcode='22023',message='invalid_input';end if;
  begin sid:=(p_payload->>'snapshotId')::uuid;exception when invalid_text_representation then raise exception using errcode='22023',message='invalid_input';end;
  if sid is null or reference not like 'DEMO-PUBLICACAO-%' or private.trim_academic_text(substr(reference,17))='' then raise exception using errcode='22023',message='invalid_input';end if;
  canonical:=jsonb_build_object('context',p_contexto,'snapshotId',sid,'reference',reference);
 end if;
 select * into c from public.competencias where id=(ctx->>'competenciaId')::uuid for update;
 perform id from public.posicoes_esperadas where competencia_id=c.id order by id for update;
 perform e.id from public.entradas e join public.posicoes_esperadas p on p.id=e.posicao_id where p.competencia_id=c.id order by e.id for update of e;
 perform v.id from public.revisoes_entrada v join public.entradas e on e.id=v.entrada_id where e.competencia_id=c.id and e.posicao_id is not null order by v.id for update of v;
 select * into f from public.fechamentos where competencia_id=c.id for update;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_operation_id::text,0));
 -- A wait, including one on the operation key, never preserves stale authority.
 ctx:=private.require_academic_context(p_contexto,capability);checklist:=private.cycle_checklist(ctx);
 if not(checklist->>'fullCoverage')::boolean then raise exception using errcode='42501',message='access_denied';end if;
 if p_command='publish_cycle_demo' and (f.id is null or f.id<>sid) then raise exception using errcode='42501',message='access_denied';end if;
 select * into old_op from public.operacoes_dominio where ator_id=auth.uid() and operation_id=p_operation_id;
 if old_op.id is not null then
  if old_op.comando<>p_command or old_op.payload<>canonical then raise exception using errcode='22023',message='operation_payload_mismatch';end if;
  return old_op.resposta;
 end if;
 if p_command='transition_cycle' then
  if c.lock_version<>expected then raise exception using errcode='40001',message='version_conflict';end if;
  if action='consolidate' then
   if not(checklist->>'canConsolidate')::boolean then raise exception using errcode='55000',message='invalid_state';end if;
   update public.competencias set estado='em_consolidacao',lock_version=lock_version+1 where id=c.id returning * into c;
  elsif action='reopen' then
   if c.estado<>'em_consolidacao' or f.id is not null then raise exception using errcode='55000',message='invalid_state';end if;
   update public.competencias set estado='aberta',lock_version=lock_version+1 where id=c.id returning * into c;
  else
   if not(checklist->>'canClose')::boolean or f.id is not null then raise exception using errcode='55000',message='invalid_state';end if;
   insert into public.fechamentos(competencia_id,referencia_demo,ator_id) values(c.id,reference,auth.uid()) returning * into f;
   insert into public.itens_fechamento(fechamento_id,posicao_id,alvo_id,revisao_id,regra_id,alvo_codigo,alvo_tipo,regra_versao,revisao_numero,estado_dado,valor_entrada,fator,valor_resultado,memoria,distrito_id,distrito_codigo)
   select f.id,p.id,p.alvo_id,case when p.aplicavel then v.id end,p.regra_id,s.codigo,s.tipo,rule.versao,case when p.aplicavel then v.numero end,
    case when not p.aplicavel then 'nao_aplicavel' else v.estado_dado end,
    case when p.aplicavel and v.estado_dado='valor' then v.valor end,case when p.aplicavel and v.estado_dado='valor' then rule.fator end,
    case when p.aplicavel and v.estado_dado='valor' then r.valor end,
    case when p.aplicavel and v.estado_dado='valor' then r.memoria else '{}'::jsonb end,t.distrito_id,district.codigo
   from public.posicoes_esperadas p join public.escopos s on s.id=p.alvo_id join public.regras rule on rule.id=p.regra_id and rule.indicador_id=p.indicador_id
   left join public.entradas e on e.posicao_id=p.id and e.competencia_id=p.competencia_id and e.indicador_id=p.indicador_id and e.escopo_id=p.alvo_id
   left join public.revisoes_entrada v on v.id=e.revisao_atual_id and v.entrada_id=e.id left join public.resultados r on r.revisao_id=v.id and r.entrada_id=e.id and r.regra_id=rule.id
   left join public.territorios_competencia t on t.competencia_id=p.competencia_id and t.unidade_id=p.alvo_id and s.tipo='unidade' left join public.escopos district on district.id=t.distrito_id
   where p.competencia_id=c.id;
   update public.competencias set estado='fechada',lock_version=lock_version+1 where id=c.id returning * into c;
  end if;
  response:=jsonb_build_object('resourceId',case when action='close' then f.id else c.id end,'version',c.lock_version,'revisionId',null,'status',c.estado,'resultValue',null);
 else
  if c.estado<>'fechada' or exists(select 1 from public.publicacoes where fechamento_id=f.id) then raise exception using errcode='55000',message='invalid_state';end if;
  insert into public.publicacoes(fechamento_id,referencia_demo,ator_id) values(f.id,reference,auth.uid()) returning * into pub;
  update public.competencias set lock_version=lock_version+1 where id=c.id returning * into c;
  response:=jsonb_build_object('resourceId',f.id,'version',c.lock_version,'revisionId',null,'status','publicada_demo','resultValue',null);
 end if;
 insert into public.eventos_auditoria(actor_id,acao,recurso_tipo,recurso_id,detalhes,correlacao_id) values(auth.uid(),case when p_command='publish_cycle_demo' then 'ciclo_publicado_demo' when action='close' then 'ciclo_fechado' when action='reopen' then 'ciclo_reaberto' else 'ciclo_em_consolidacao' end,'competencia',c.id,jsonb_strip_nulls(jsonb_build_object('version',c.lock_version,'snapshotId',f.id,'reason',reason,'reference',reference)),p_operation_id);
 insert into public.operacoes_dominio(ator_id,operation_id,comando,payload,resposta) values(auth.uid(),p_operation_id,p_command,canonical,response);
 return response;
end;$$;
create function public.transition_cycle(p_contexto jsonb,p_expected_version integer,p_action text,p_reason text,p_reference text,p_operation_id uuid) returns jsonb
language sql security definer set search_path='' as $$select private.run_academic_command(p_contexto,'transition_cycle',jsonb_build_object('expectedVersion',p_expected_version,'action',p_action,'reason',p_reason,'reference',p_reference),p_operation_id);$$;
create function public.publish_cycle_demo(p_contexto jsonb,p_snapshot_id uuid,p_reference text,p_operation_id uuid) returns jsonb
language sql security definer set search_path='' as $$select private.run_academic_command(p_contexto,'publish_cycle_demo',jsonb_build_object('snapshotId',p_snapshot_id,'reference',p_reference),p_operation_id);$$;
create or replace function private.run_academic_command(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_command in ('save_draft','submit') then return private.run_academic_submission(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command in ('start_review','review') then return private.review_academic_position(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command in ('correct','authorize_correction','decide_unavailability') then return private.correct_academic_position(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command in ('transition_cycle','publish_cycle_demo') then return private.transition_academic_cycle(p_contexto,p_command,p_payload,p_operation_id);
 else raise exception using errcode='42501',message='access_denied';end if;
end;$$;

create function private.guard_closed_cycle() returns trigger language plpgsql set search_path='' as $$
declare cid uuid;
begin
 if tg_table_name='competencias' then
  if exists(select 1 from public.fechamentos where competencia_id=old.id) and (tg_op='DELETE' or (new.id,new.codigo,new.referencia,new.estado,new.modelo) is distinct from (old.id,old.codigo,old.referencia,old.estado,old.modelo)) and not(tg_op='UPDATE' and old.estado='em_consolidacao' and new.estado='fechada') then raise exception using errcode='55000',message='closed_cycle_is_immutable';end if;
 elsif tg_table_name in ('posicoes_esperadas','entradas') then
  cid:=case when tg_op='DELETE' then old.competencia_id else new.competencia_id end;
  if exists(select 1 from public.fechamentos where competencia_id=cid or (tg_op='UPDATE' and competencia_id=old.competencia_id)) then raise exception using errcode='55000',message='closed_cycle_is_immutable';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
create trigger closed_position_guard before insert or update or delete on public.posicoes_esperadas for each row execute function private.guard_closed_cycle();
create trigger closed_entry_guard before insert or update or delete on public.entradas for each row execute function private.guard_closed_cycle();
create trigger closed_competence_guard before update or delete on public.competencias for each row execute function private.guard_closed_cycle();
revoke all on function private.cycle_positions(jsonb),private.cycle_checklist(jsonb),private.transition_academic_cycle(jsonb,text,jsonb,uuid),private.guard_closed_cycle() from public,anon,authenticated,service_role;
revoke all on function public.get_cycle_checklist(jsonb),public.transition_cycle(jsonb,integer,text,text,text,uuid),public.publish_cycle_demo(jsonb,uuid,text,uuid) from public,anon,service_role;
grant execute on function public.get_cycle_checklist(jsonb),public.transition_cycle(jsonb,integer,text,text,text,uuid),public.publish_cycle_demo(jsonb,uuid,text,uuid) to authenticated;
create or replace function private.review_academic_position(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_context jsonb; v_capability text; v_id uuid; v_expected integer;
 v_competence public.competencias%rowtype; v_position public.posicoes_esperadas%rowtype;
 v_entry public.entradas%rowtype; v_revision public.revisoes_entrada%rowtype;
 v_claim public.decisoes_entrada%rowtype; v_existing public.operacoes_dominio%rowtype;
 v_canonical jsonb; v_response jsonb; v_reason text; v_decision text;
 v_type text; v_status text; v_result numeric(18,10);
begin
 if p_command='start_review' then v_capability:='start_review';
 elsif p_command='review' then v_capability:='review';
 else raise exception using errcode='42501',message='access_denied'; end if;
 v_context:=private.require_academic_context(p_contexto,v_capability);
 if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='22023',message='invalid_input'; end if;
 begin
  v_id:=(p_payload->>'positionId')::uuid;v_expected:=(p_payload->>'expectedVersion')::integer;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='invalid_input'; end;
 if v_id is null or v_expected is null or v_expected<1 then raise exception using errcode='22023',message='invalid_input'; end if;
 select * into v_competence from public.competencias where id=(v_context->>'competenciaId')::uuid for update;
 select * into v_position from public.posicoes_esperadas where id=v_id and competencia_id=v_competence.id and indicador_id=(v_context->>'indicadorId')::uuid for update;
 if v_position.id is null or not(v_context->'positionIds' ? v_id::text) then raise exception using errcode='42501',message='access_denied'; end if;
 select * into v_entry from public.entradas where posicao_id=v_id for update;
 select * into v_revision from public.revisoes_entrada where id=v_entry.revisao_atual_id for update;
 perform pg_advisory_xact_lock(hashtextextended((auth.uid())::text||':'||p_operation_id::text,0));
 v_context:=private.require_academic_context(p_contexto,v_capability);
 if not(v_context->'positionIds' ? v_id::text) or v_position.revisor_id<>auth.uid() or v_revision.autor_id=auth.uid() then
  raise exception using errcode='42501',message='access_denied';
 end if;
 if p_command='start_review' then
  if (select count(*) from jsonb_object_keys(p_payload))<>2 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('positionId','expectedVersion')) then raise exception using errcode='22023',message='invalid_input'; end if;
  v_reason:='';v_type:='iniciar_revisao';v_status:='em_revisao';
  v_canonical:=jsonb_build_object('context',p_contexto,'positionId',v_id,'expectedVersion',v_expected);
 else
  if (select count(*) from jsonb_object_keys(p_payload))<>4 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('positionId','expectedVersion','decision','reason')) or
   jsonb_typeof(p_payload->'decision') is distinct from 'string' or jsonb_typeof(p_payload->'reason') is distinct from 'string' then raise exception using errcode='22023',message='invalid_input'; end if;
  -- ECMAScript String.trim WhiteSpace + LineTerminator code points, explicitly
  -- independent of database locale. Trim edges only; preserve interior text.
  v_decision:=p_payload->>'decision';
  v_reason:=btrim(p_payload->>'reason',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if v_decision not in ('accept','return') or length(v_reason)>1000 or (v_decision='return' and v_reason='') then raise exception using errcode='22023',message='invalid_input'; end if;
  v_type:=case v_decision when 'accept' then 'validar' else 'devolver' end;
  v_status:=case v_decision when 'accept' then 'validada' else 'devolvida' end;
  v_canonical:=jsonb_build_object('context',p_contexto,'positionId',v_id,'expectedVersion',v_expected,'decision',v_decision,'reason',v_reason);
 end if;
 select * into v_existing from public.operacoes_dominio where ator_id=auth.uid() and operation_id=p_operation_id;
 if v_existing.id is not null then
  if v_existing.comando<>p_command or v_existing.payload<>v_canonical then raise exception using errcode='22023',message='operation_payload_mismatch'; end if;
  return v_existing.resposta;
 end if;
 if v_position.lock_version<>v_expected then raise exception using errcode='40001',message='version_conflict'; end if;
 if v_competence.estado not in ('aberta','em_consolidacao') or not v_position.aplicavel or v_entry.id is null or v_revision.id is null or v_revision.enviada_em is null then raise exception using errcode='55000',message='invalid_state'; end if;
 if p_command='start_review' then
  if v_entry.estado<>'enviada' then raise exception using errcode='55000',message='invalid_state'; end if;
 else
  if v_entry.estado<>'em_revisao' then raise exception using errcode='55000',message='invalid_state'; end if;
  -- A claim belongs to its immutable revision AND original actor. A later
  -- assignment never rewrites that history or transfers an existing claim.
  select * into v_claim from public.decisoes_entrada where revisao_id=v_revision.id and tipo='iniciar_revisao' order by ocorrido_em desc,id desc limit 1;
  if v_claim.id is null then raise exception using errcode='55000',message='invalid_state'; end if;
  if v_claim.ator_id<>auth.uid() then raise exception using errcode='42501',message='access_denied'; end if;
 end if;
 -- Technical acceptance checks evidence, not the CAM's unavailability decision.
 -- In particular, it never creates a number or changes the submitted payload.
 select valor into v_result from public.resultados where revisao_id=v_revision.id;
 insert into public.decisoes_entrada(revisao_id,ator_id,tipo,motivo,ocorrido_em) values(v_revision.id,auth.uid(),v_type,v_reason,clock_timestamp());
 update public.entradas set estado=v_status,lock_version=lock_version+1 where id=v_entry.id;
 update public.posicoes_esperadas set lock_version=lock_version+1 where id=v_id returning * into v_position;
 update public.competencias set lock_version=lock_version+1 where id=v_competence.id;
 v_response:=jsonb_build_object('resourceId',v_id,'version',v_position.lock_version,'revisionId',v_revision.id,'status',v_status,'resultValue',trim_scale(v_result)::text);
 insert into public.eventos_auditoria(actor_id,acao,recurso_tipo,recurso_id,detalhes,correlacao_id)
  values(auth.uid(),'posicao_'||v_status,'posicao',v_id,jsonb_build_object('version',v_position.lock_version,'revisionId',v_revision.id,'estadoDado',v_revision.estado_dado,'reason',v_reason),p_operation_id);
 insert into public.operacoes_dominio(ator_id,operation_id,comando,payload,resposta) values(auth.uid(),p_operation_id,p_command,v_canonical,v_response);
 return v_response;
end;
$$;
revoke all on function private.review_academic_position(jsonb,text,jsonb,uuid) from public,anon,authenticated,service_role;
commit;
