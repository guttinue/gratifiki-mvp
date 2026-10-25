begin;
-- Preserve the applied draft implementation as a fixed private handler. The
-- dispatcher below owns the common locked authorization boundary.
alter function private.run_academic_command(jsonb,text,jsonb,uuid) rename to save_academic_draft;
create function private.run_academic_command(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_context jsonb; v_capability text; v_id uuid; v_expected integer;
 v_competence public.competencias%rowtype; v_position public.posicoes_esperadas%rowtype;
 v_entry public.entradas%rowtype; v_revision public.revisoes_entrada%rowtype;
 v_rule public.regras%rowtype; v_existing public.operacoes_dominio%rowtype;
 v_canonical jsonb; v_response jsonb; v_result numeric(18,10); v_memory jsonb;
begin
 if p_command='save_draft' then v_capability:='draft';
 elsif p_command='submit' then v_capability:='submit';
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
 -- Acquire actor/key serialization before the last current-access check too:
 -- a wait on another competence must not make a prior check authorize replay.
 perform pg_advisory_xact_lock(hashtextextended((auth.uid())::text||':'||p_operation_id::text,0));
 -- Never recover a cached response without current authorization under all
 -- domain locks. Actor and assignment are resolved on the server, not payload.
 v_context:=private.require_academic_context(p_contexto,v_capability);
 if v_position.id is null or not(v_context->'positionIds' ? v_id::text) then raise exception using errcode='42501',message='access_denied'; end if;
 if p_command='save_draft' then
  return private.save_academic_draft(p_contexto,'save_draft',p_payload,p_operation_id);
 end if;
 if (select count(*) from jsonb_object_keys(p_payload))<>2 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('positionId','expectedVersion')) then raise exception using errcode='22023',message='invalid_input'; end if;
 v_canonical:=jsonb_build_object('context',p_contexto,'positionId',v_id,'expectedVersion',v_expected);
 select * into v_existing from public.operacoes_dominio where ator_id=auth.uid() and operation_id=p_operation_id;
 if v_existing.id is not null then
  if v_existing.comando<>p_command or v_existing.payload<>v_canonical then raise exception using errcode='22023',message='operation_payload_mismatch'; end if;
  return v_existing.resposta;
 end if;
 if v_position.lock_version<>v_expected then raise exception using errcode='40001',message='version_conflict'; end if;
 if v_competence.estado<>'aberta' or not v_position.aplicavel or v_entry.id is null or v_entry.estado<>'rascunho' or v_revision.id is null or v_revision.enviada_em is not null or v_revision.autor_id<>auth.uid() then
  raise exception using errcode='55000',message='invalid_state';
 end if;
 if btrim(v_revision.origem)='' or v_revision.periodo_fonte !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or
  (v_revision.estado_dado='valor' and v_revision.valor is null) or
  (v_revision.estado_dado='indisponivel' and (v_revision.valor is not null or btrim(v_revision.motivo)='')) then
  raise exception using errcode='22023',message='invalid_input';
 end if;
 begin
  if (v_revision.periodo_fonte::date)::text<>v_revision.periodo_fonte then raise exception using errcode='22023',message='invalid_input'; end if;
 exception when datetime_field_overflow or invalid_datetime_format then raise exception using errcode='22023',message='invalid_input'; end;
 select * into v_rule from public.regras where id=v_position.regra_id and indicador_id=v_position.indicador_id;
 if v_rule.id is null or v_rule.fator<=0 or v_rule.fator>1 then raise exception using errcode='22023',message='rule_unavailable'; end if;
 -- No temporal lookup, floating point or institutional formula. The position
 -- pins its immutable synthetic rule. Unavailability never becomes zero.
 if v_revision.estado_dado='valor' then
  v_result:=v_revision.valor*v_rule.fator;
  v_memory:=jsonb_build_object('synthetic',true,'revisionId',v_revision.id,'ruleId',v_rule.id,'ruleVersion',v_rule.versao,
   'factor',trim_scale(v_rule.fator)::text,'inputValue',trim_scale(v_revision.valor)::text,'resultValue',trim_scale(v_result)::text);
 end if;
 update public.revisoes_entrada set enviada_em=clock_timestamp() where id=v_revision.id;
 update public.entradas set estado='enviada',lock_version=lock_version+1 where id=v_entry.id;
 if v_revision.estado_dado='valor' then
  insert into public.resultados(entrada_id,regra_id,valor,memoria,revisao_id) values(v_entry.id,v_rule.id,v_result,v_memory,v_revision.id);
 end if;
 update public.posicoes_esperadas set lock_version=lock_version+1 where id=v_id returning * into v_position;
 update public.competencias set lock_version=lock_version+1 where id=v_competence.id;
 v_response:=jsonb_build_object('resourceId',v_id,'version',v_position.lock_version,'revisionId',v_revision.id,'status','enviada','resultValue',trim_scale(v_result)::text);
 insert into public.eventos_auditoria(actor_id,acao,recurso_tipo,recurso_id,detalhes,correlacao_id)
  values(auth.uid(),'posicao_enviada','posicao',v_id,jsonb_build_object('version',v_position.lock_version,'revisionId',v_revision.id,'estadoDado',v_revision.estado_dado,'ruleVersion',v_rule.versao),p_operation_id);
 insert into public.operacoes_dominio(ator_id,operation_id,comando,payload,resposta) values(auth.uid(),p_operation_id,p_command,v_canonical,v_response);
 return v_response;
end;
$$;
-- Replace SQL wrapper too: its original parsed function binding must not keep
-- calling the renamed T05 handler and bypass the common locked guard.
create or replace function public.save_position_draft(p_contexto jsonb,p_position_id uuid,p_expected_version integer,p_input jsonb,p_operation_id uuid)
returns jsonb language sql security definer set search_path='' as $$
 select private.run_academic_command(p_contexto,'save_draft',jsonb_build_object('positionId',p_position_id,'expectedVersion',p_expected_version,'input',p_input),p_operation_id);
$$;
create function public.submit_position(p_contexto jsonb,p_position_id uuid,p_expected_version integer,p_operation_id uuid)
returns jsonb language sql security definer set search_path='' as $$
 select private.run_academic_command(p_contexto,'submit',jsonb_build_object('positionId',p_position_id,'expectedVersion',p_expected_version),p_operation_id);
$$;
revoke all on function private.save_academic_draft(jsonb,text,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function private.run_academic_command(jsonb,text,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.submit_position(jsonb,uuid,integer,uuid) from public,anon,service_role;
grant execute on function public.submit_position(jsonb,uuid,integer,uuid) to authenticated;
commit;
