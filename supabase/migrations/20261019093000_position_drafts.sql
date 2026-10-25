begin;
-- Fixed dispatcher. No client-selected function names or dynamic SQL.
create function private.run_academic_command(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_context jsonb; v_position public.posicoes_esperadas%rowtype; v_competence public.competencias%rowtype;
 v_entry public.entradas%rowtype; v_revision public.revisoes_entrada%rowtype; v_existing public.operacoes_dominio%rowtype;
 v_input jsonb; v_value numeric; v_text text; v_source text; v_period text; v_reason text;
 v_canonical jsonb; v_response jsonb; v_expected integer; v_id uuid;
begin
 if p_command is distinct from 'save_draft' then raise exception using errcode='42501',message='access_denied'; end if;
 v_context:=private.require_academic_context(p_contexto,'draft');
 if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='22023',message='invalid_input'; end if;
 begin
  v_id:=(p_payload->>'positionId')::uuid;
  v_expected:=(p_payload->>'expectedVersion')::integer;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='invalid_input'; end;
 if v_id is null or v_expected is null or v_expected<1 then raise exception using errcode='22023',message='invalid_input'; end if;
 -- All writes lock competence, position/header, then revision. Re-authorize inside.
 select * into v_competence from public.competencias where id=(v_context->>'competenciaId')::uuid for update;
 select * into v_position from public.posicoes_esperadas where id=v_id and competencia_id=v_competence.id and indicador_id=(v_context->>'indicadorId')::uuid for update;
 v_context:=private.require_academic_context(p_contexto,'draft');
 if v_position.id is null or not(v_context->'positionIds' ? v_id::text) then raise exception using errcode='42501',message='access_denied'; end if;
 select * into v_entry from public.entradas where posicao_id=v_id for update;
 select * into v_revision from public.revisoes_entrada where id=v_entry.revisao_atual_id for update;
 v_input:=p_payload->'input';
 if jsonb_typeof(v_input) is distinct from 'object' or
  (select count(*) from jsonb_object_keys(v_input))<>5 or
  exists(select 1 from jsonb_object_keys(v_input) k where k not in ('estadoDado','valor','fonte','periodoFonte','motivo')) or
  jsonb_typeof(v_input->'estadoDado') is distinct from 'string' or v_input->>'estadoDado' not in ('valor','indisponivel') or
  jsonb_typeof(v_input->'fonte') is distinct from 'string' or jsonb_typeof(v_input->'periodoFonte') is distinct from 'string' or
  jsonb_typeof(v_input->'motivo') is distinct from 'string' or not(v_input ? 'valor') then
  raise exception using errcode='22023',message='invalid_input';
 end if;
 v_source:=btrim(v_input->>'fonte');v_period:=btrim(v_input->>'periodoFonte');v_reason:=btrim(v_input->>'motivo');
 if char_length(v_source)>500 or char_length(v_reason)>1000 then raise exception using errcode='22023',message='invalid_input'; end if;
 if v_period<>'' then
  if v_period !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='22023',message='invalid_input'; end if;
  begin
   if (v_period::date)::text<>v_period then raise exception using errcode='22023',message='invalid_input'; end if;
  exception when datetime_field_overflow or invalid_datetime_format then raise exception using errcode='22023',message='invalid_input'; end;
 end if;
 if v_input->'valor'<>'null'::jsonb then
  if jsonb_typeof(v_input->'valor') is distinct from 'string' then raise exception using errcode='22023',message='invalid_input'; end if;
  v_text:=replace(btrim(v_input->>'valor'),',','.');
  if v_text !~ '^[0-9]+(\.[0-9]{1,4})?$' or char_length(v_text)>100 then raise exception using errcode='22023',message='invalid_input'; end if;
  v_value:=v_text::numeric;
  if v_value>99999999.9999 then raise exception using errcode='22023',message='invalid_input'; end if;
 end if;
 if v_input->>'estadoDado'='indisponivel' and v_value is not null then raise exception using errcode='22023',message='invalid_input'; end if;
 v_canonical:=jsonb_build_object('context',p_contexto,'positionId',v_id,'expectedVersion',v_expected,'input',
  jsonb_build_object('estadoDado',v_input->>'estadoDado','valor',trim_scale(v_value)::text,'fonte',v_source,'periodoFonte',v_period,'motivo',v_reason));
 -- Serializes actor/key even if concurrent retries target different competences.
 perform pg_advisory_xact_lock(hashtextextended((auth.uid())::text||':'||p_operation_id::text,0));
 select * into v_existing from public.operacoes_dominio where ator_id=auth.uid() and operation_id=p_operation_id;
 if v_existing.id is not null then
  if v_existing.comando<>p_command or v_existing.payload<>v_canonical then raise exception using errcode='22023',message='operation_payload_mismatch'; end if;
  return v_existing.resposta;
 end if;
 if v_position.lock_version<>v_expected then raise exception using errcode='40001',message='version_conflict'; end if;
 if v_competence.estado<>'aberta' or not v_position.aplicavel or
  (v_entry.id is not null and (v_entry.estado<>'rascunho' or v_revision.enviada_em is not null or v_revision.autor_id<>auth.uid())) then
  raise exception using errcode='55000',message='invalid_state';
 end if;
 if v_entry.id is null then
  insert into public.entradas(competencia_id,indicador_id,escopo_id,autor_id,valor,estado,revisao,operation_id,posicao_id)
   values(v_position.competencia_id,v_position.indicador_id,v_position.alvo_id,auth.uid(),null,'rascunho',1,p_operation_id,v_id) returning * into v_entry;
 end if;
 if v_revision.id is null then
  insert into public.revisoes_entrada(entrada_id,numero,autor_id,estado_dado,valor,origem,periodo_fonte,motivo)
   values(v_entry.id,1,auth.uid(),v_input->>'estadoDado',v_value,v_source,v_period,v_reason) returning * into v_revision;
 else
  update public.revisoes_entrada set estado_dado=v_input->>'estadoDado',valor=v_value,origem=v_source,periodo_fonte=v_period,motivo=v_reason where id=v_revision.id;
 end if;
 update public.entradas set revisao_atual_id=v_revision.id,lock_version=lock_version+1 where id=v_entry.id;
 update public.posicoes_esperadas set lock_version=lock_version+1 where id=v_id returning * into v_position;
 update public.competencias set lock_version=lock_version+1 where id=v_competence.id;
 v_response:=jsonb_build_object('resourceId',v_id,'version',v_position.lock_version,'revisionId',v_revision.id,'status','rascunho','resultValue',null);
 insert into public.eventos_auditoria(actor_id,acao,recurso_tipo,recurso_id,detalhes,correlacao_id)
  values(auth.uid(),'rascunho_salvo','posicao',v_id,jsonb_build_object('version',v_position.lock_version,'revisionId',v_revision.id),p_operation_id);
 insert into public.operacoes_dominio(ator_id,operation_id,comando,payload,resposta) values(auth.uid(),p_operation_id,p_command,v_canonical,v_response);
 return v_response;
end;
$$;
create function public.save_position_draft(p_contexto jsonb,p_position_id uuid,p_expected_version integer,p_input jsonb,p_operation_id uuid)
returns jsonb language sql security definer set search_path='' as $$
 select private.run_academic_command(p_contexto,'save_draft',jsonb_build_object('positionId',p_position_id,'expectedVersion',p_expected_version,'input',p_input),p_operation_id);
$$;
revoke all on function private.run_academic_command(jsonb,text,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.save_position_draft(jsonb,uuid,integer,jsonb,uuid) from public,anon,service_role;
grant execute on function public.save_position_draft(jsonb,uuid,integer,jsonb,uuid) to authenticated;
commit;
