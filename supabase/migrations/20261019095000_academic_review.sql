begin;
-- Keep the accepted save/submit implementation intact and route only explicit
-- command names. No dynamic SQL or browser-executable private handlers.
alter function private.run_academic_command(jsonb,text,jsonb,uuid) rename to run_academic_submission;
create function private.review_academic_position(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
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
 if v_competence.estado<>'aberta' or not v_position.aplicavel or v_entry.id is null or v_revision.id is null or v_revision.enviada_em is null then raise exception using errcode='55000',message='invalid_state'; end if;
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
create function private.run_academic_command(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_command in ('save_draft','submit') then return private.run_academic_submission(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command in ('start_review','review') then return private.review_academic_position(p_contexto,p_command,p_payload,p_operation_id);
 else raise exception using errcode='42501',message='access_denied'; end if;
end;
$$;
create or replace function public.save_position_draft(p_contexto jsonb,p_position_id uuid,p_expected_version integer,p_input jsonb,p_operation_id uuid)
returns jsonb language sql security definer set search_path='' as $$ select private.run_academic_command(p_contexto,'save_draft',jsonb_build_object('positionId',p_position_id,'expectedVersion',p_expected_version,'input',p_input),p_operation_id); $$;
create or replace function public.submit_position(p_contexto jsonb,p_position_id uuid,p_expected_version integer,p_operation_id uuid)
returns jsonb language sql security definer set search_path='' as $$ select private.run_academic_command(p_contexto,'submit',jsonb_build_object('positionId',p_position_id,'expectedVersion',p_expected_version),p_operation_id); $$;
create function public.start_position_review(p_contexto jsonb,p_position_id uuid,p_expected_version integer,p_operation_id uuid)
returns jsonb language sql security definer set search_path='' as $$ select private.run_academic_command(p_contexto,'start_review',jsonb_build_object('positionId',p_position_id,'expectedVersion',p_expected_version),p_operation_id); $$;
create function public.review_position(p_contexto jsonb,p_position_id uuid,p_expected_version integer,p_decision text,p_reason text,p_operation_id uuid)
returns jsonb language sql security definer set search_path='' as $$ select private.run_academic_command(p_contexto,'review',jsonb_build_object('positionId',p_position_id,'expectedVersion',p_expected_version,'decision',p_decision,'reason',p_reason),p_operation_id); $$;
revoke all on function private.run_academic_submission(jsonb,text,jsonb,uuid),private.review_academic_position(jsonb,text,jsonb,uuid),private.run_academic_command(jsonb,text,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.start_position_review(jsonb,uuid,integer,uuid),public.review_position(jsonb,uuid,integer,text,text,uuid) from public,anon,service_role;
grant execute on function public.start_position_review(jsonb,uuid,integer,uuid),public.review_position(jsonb,uuid,integer,text,text,uuid) to authenticated;
commit;
