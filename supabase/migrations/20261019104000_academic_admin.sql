begin;
-- Metadata only. No query in this module reads evaluations or Auth credentials.
create function public.get_admin_catalog(p_contexto jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ctx jsonb;result jsonb;
begin
 ctx:=private.require_academic_context(p_contexto,'admin_catalog');
 select jsonb_build_object(
  'scopes',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'codigo',s.codigo,'tipo',s.tipo,'distritoId',s.distrito_id,'ativo',s.ativo,'version',s.lock_version) order by s.codigo,s.id),'[]'::jsonb) from public.escopos s where s.tipo is not null),
  'accounts',(select coalesce(jsonb_agg(jsonb_build_object('actorId',a.ator_id,'label',a.rotulo,'ativo',a.ativo) order by a.rotulo,a.ator_id),'[]'::jsonb) from public.contas_demo a),
  'links',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'actorId',v.actor_id,'role',v.papel,'escopoId',v.escopo_id,'indicadorId',v.indicador_id,'ativo',v.ativo,'vigenciaInicio',v.vigencia_inicio,'vigenciaFim',v.vigencia_fim,'version',v.lock_version) order by v.actor_id,v.papel,v.escopo_id,v.id),'[]'::jsonb) from public.vinculos v join public.contas_demo a on a.ator_id=v.actor_id join public.escopos s on s.id=v.escopo_id and s.tipo is not null where v.indicador_id=(ctx->>'indicadorId')::uuid),
  'indicators',(select jsonb_build_array(jsonb_build_object('id',i.id,'codigo',i.codigo)) from public.indicadores i where i.id=(ctx->>'indicadorId')::uuid)) into result;
 return result;
end;$$;

create function private.administer_academic_metadata(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctx jsonb;inp jsonb;canonical jsonb;old_op public.operacoes_dominio%rowtype;response jsonb;
 s public.escopos%rowtype;link public.vinculos%rowtype;sid uuid;district uuid;actor uuid;indicator uuid;
 code text;kind text;role_name text;active boolean;start_date date;end_date date;expected integer;new_version integer;resource uuid;event_name text;resource_type text;
begin
 ctx:=private.require_academic_context(p_contexto,'admin_write');
 if p_command not in ('save_demo_scope','set_demo_business_link') then raise exception using errcode='42501',message='access_denied';end if;
 if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_payload->'input') is distinct from 'object'
  or jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or (p_payload->>'expectedVersion')!~'^[0-9]+$'
  or (p_payload->>'expectedVersion')::numeric>2147483647 then raise exception using errcode='22023',message='invalid_input';end if;
 expected:=(p_payload->>'expectedVersion')::integer;inp:=p_payload->'input';
 if p_command='save_demo_scope' then
  if (select count(*) from jsonb_object_keys(p_payload))<>3 or not(p_payload?&array['scopeId','expectedVersion','input'])
   or (select count(*) from jsonb_object_keys(inp))<>4 or not(inp?&array['codigo','tipo','distritoId','ativo'])
   or jsonb_typeof(inp->'codigo') is distinct from 'string' or jsonb_typeof(inp->'tipo') is distinct from 'string'
   or jsonb_typeof(inp->'ativo') is distinct from 'boolean' or jsonb_typeof(inp->'distritoId') not in ('string','null')
   or jsonb_typeof(p_payload->'scopeId') not in ('string','null') then raise exception using errcode='22023',message='invalid_input';end if;
  begin sid:=(p_payload->>'scopeId')::uuid;district:=(inp->>'distritoId')::uuid;exception when invalid_text_representation then raise exception using errcode='22023',message='invalid_input';end;
  code:=private.trim_academic_text(inp->>'codigo');kind:=inp->>'tipo';active:=(inp->>'ativo')::boolean;
  if length(code) not between 1 and 100 or kind not in ('unidade','distrito') or (kind='distrito' and district is not null) or (kind='unidade' and district is null) or (sid is not null and sid=district) then raise exception using errcode='22023',message='invalid_input';end if;
  inp:=jsonb_build_object('codigo',code,'tipo',kind,'distritoId',district,'ativo',active);
  canonical:=jsonb_build_object('context',p_contexto,'scopeId',sid,'expectedVersion',expected,'input',inp);
 else
  if (select count(*) from jsonb_object_keys(p_payload))<>3 or not(p_payload?&array['actorId','expectedVersion','input'])
   or (select count(*) from jsonb_object_keys(inp))<>6 or not(inp?&array['role','escopoId','indicadorId','ativo','vigenciaInicio','vigenciaFim']) then raise exception using errcode='22023',message='invalid_input';end if;
  if jsonb_typeof(p_payload->'actorId') is distinct from 'string' or jsonb_typeof(inp->'role') is distinct from 'string'
   or jsonb_typeof(inp->'escopoId') is distinct from 'string' or jsonb_typeof(inp->'indicadorId') is distinct from 'string'
   or jsonb_typeof(inp->'ativo') is distinct from 'boolean' or jsonb_typeof(inp->'vigenciaInicio') is distinct from 'string' or jsonb_typeof(inp->'vigenciaFim') not in ('string','null') then raise exception using errcode='22023',message='invalid_input';end if;
  begin actor:=(p_payload->>'actorId')::uuid;sid:=(inp->>'escopoId')::uuid;indicator:=(inp->>'indicadorId')::uuid;
   if (inp->>'vigenciaInicio')!~'^\d{4}-\d{2}-\d{2}$' or (inp->>'vigenciaFim' is not null and (inp->>'vigenciaFim')!~'^\d{4}-\d{2}-\d{2}$') then raise exception using errcode='22023',message='invalid_input';end if;
   start_date:=(inp->>'vigenciaInicio')::date;end_date:=(inp->>'vigenciaFim')::date;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then raise exception using errcode='22023',message='invalid_input';end;
  role_name:=inp->>'role';active:=(inp->>'ativo')::boolean;
  if actor=auth.uid() or role_name='administrador' or not exists(select 1 from public.contas_demo where ator_id=actor and ativo) then raise exception using errcode='42501',message='access_denied';end if;
  if role_name not in ('area_tecnica','revisor_tecnico','cam','gestor_unidade','gestor_distrital','lideranca') or indicator<>(ctx->>'indicadorId')::uuid or start_date is null or (end_date is not null and end_date<start_date) then raise exception using errcode='22023',message='invalid_input';end if;
  inp:=jsonb_build_object('role',role_name,'escopoId',sid,'indicadorId',indicator,'ativo',active,'vigenciaInicio',start_date::text,'vigenciaFim',end_date::text);
  canonical:=jsonb_build_object('context',p_contexto,'actorId',actor,'expectedVersion',expected,'input',inp);
 end if;
 -- All metadata commands serialize across months. Competence first matches the
 -- domain lock order; the fixed catalogue lock also covers absent natural keys.
 perform id from public.competencias where id=(ctx->>'competenciaId')::uuid for update;
 perform pg_advisory_xact_lock(hashtextextended('academic:admin-catalog',0));
 select * into s from public.escopos where id=sid for update;
 if p_command='set_demo_business_link' then
  perform ator_id from public.contas_demo where ator_id=actor for share;
  select * into link from public.vinculos where actor_id=actor and papel=role_name and escopo_id=sid for update;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_operation_id::text,0));
 ctx:=private.require_academic_context(p_contexto,'admin_write');
 if p_command='set_demo_business_link' and (actor=auth.uid() or role_name='administrador' or not exists(select 1 from public.contas_demo where ator_id=actor and ativo)) then raise exception using errcode='42501',message='access_denied';end if;
 select * into old_op from public.operacoes_dominio where ator_id=auth.uid() and operation_id=p_operation_id;
 if old_op.id is not null then
  if old_op.comando<>p_command or old_op.payload<>canonical then raise exception using errcode='22023',message='operation_payload_mismatch';end if;
  return old_op.resposta;
 end if;
 if p_command='save_demo_scope' then
  if sid is not null and (s.id is null or s.tipo is null) then raise exception using errcode='22023',message='invalid_input';end if;
  if expected<>(case when sid is null then 0 else s.lock_version end) then raise exception using errcode='40001',message='version_conflict';end if;
  if exists(select 1 from public.escopos where codigo=code and (sid is null or id<>sid)) then raise exception using errcode='22023',message='invalid_input';end if;
  if district is not null and not exists(select 1 from public.escopos where id=district and tipo='distrito' and (ativo or (s.id is not null and s.distrito_id=district))) then raise exception using errcode='22023',message='invalid_input';end if;
  -- Current territorial membership may change; past identity/type may not.
  if s.id is not null and s.tipo<>kind and (exists(select 1 from public.posicoes_esperadas where alvo_id=s.id) or exists(select 1 from public.vinculos where escopo_id=s.id) or exists(select 1 from public.territorios_competencia where unidade_id=s.id or distrito_id=s.id) or exists(select 1 from public.entradas where escopo_id=s.id) or exists(select 1 from public.escopos where distrito_id=s.id)) then raise exception using errcode='22023',message='invalid_input';end if;
  if sid is null then
   insert into public.escopos(codigo,tipo,distrito_id,ativo) values(code,kind,district,active) returning id,lock_version into resource,new_version;
  else
   update public.escopos set codigo=code,tipo=kind,distrito_id=district,ativo=active,lock_version=lock_version+1 where id=sid returning id,lock_version into resource,new_version;
  end if;
  event_name:='escopo_demo_salvo';resource_type:='escopo';
 else
  if s.id is null or s.tipo is null or (role_name='gestor_unidade' and s.tipo<>'unidade') or (role_name in ('gestor_distrital','lideranca') and s.tipo<>'distrito') or (link.id is not null and link.indicador_id is distinct from indicator) then raise exception using errcode='22023',message='invalid_input';end if;
  if expected<>coalesce(link.lock_version,0) then raise exception using errcode='40001',message='version_conflict';end if;
  -- Inactive catalogues preserve only the existing authorization interval.
  -- A NULL end is unbounded; restoring an expired/future active link through
  -- date expansion is a new use just like toggling ativo back to true.
  -- Revocation has an empty effective interval and remains permitted.
  if not s.ativo and (link.id is null or (active and (not link.ativo
   or link.vigencia_inicio is null or start_date<link.vigencia_inicio
   or (link.vigencia_fim is not null and (end_date is null or end_date>link.vigencia_fim))))) then raise exception using errcode='22023',message='invalid_input';end if;
  if link.id is null then
   insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,ativo,vigencia_inicio,vigencia_fim) values(actor,role_name,sid,indicator,active,start_date,end_date) returning id,lock_version into resource,new_version;
  else
   update public.vinculos set ativo=active,vigencia_inicio=start_date,vigencia_fim=end_date,lock_version=lock_version+1 where id=link.id returning id,lock_version into resource,new_version;
  end if;
  event_name:='vinculo_demo_alterado';resource_type:='vinculo';
 end if;
 response:=jsonb_build_object('resourceId',resource,'version',new_version,'revisionId',null,'status',case when active then 'ativo' else 'inativo' end,'resultValue',null);
 insert into public.eventos_auditoria(actor_id,acao,recurso_tipo,recurso_id,detalhes,correlacao_id) values(auth.uid(),event_name,resource_type,resource,jsonb_build_object('version',new_version),p_operation_id);
 insert into public.operacoes_dominio(ator_id,operation_id,comando,payload,resposta) values(auth.uid(),p_operation_id,p_command,canonical,response);
 return response;
end;$$;

create or replace function private.run_academic_command(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_command in ('save_draft','submit') then return private.run_academic_submission(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command in ('start_review','review') then return private.review_academic_position(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command in ('correct','authorize_correction','decide_unavailability') then return private.correct_academic_position(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command in ('transition_cycle','publish_cycle_demo') then return private.transition_academic_cycle(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command='get_snapshot_export' then return private.export_academic_snapshot(p_contexto,p_payload,p_operation_id);
 elsif p_command in ('save_demo_scope','set_demo_business_link') then return private.administer_academic_metadata(p_contexto,p_command,p_payload,p_operation_id);
 else raise exception using errcode='42501',message='access_denied';end if;
end;$$;
create function public.save_demo_scope(p_contexto jsonb,p_scope_id uuid,p_expected_version integer,p_input jsonb,p_operation_id uuid) returns jsonb language sql security definer set search_path='' as $$select private.run_academic_command(p_contexto,'save_demo_scope',jsonb_build_object('scopeId',p_scope_id,'expectedVersion',p_expected_version,'input',p_input),p_operation_id);$$;
create function public.set_demo_business_link(p_contexto jsonb,p_actor_id uuid,p_expected_version integer,p_input jsonb,p_operation_id uuid) returns jsonb language sql security definer set search_path='' as $$select private.run_academic_command(p_contexto,'set_demo_business_link',jsonb_build_object('actorId',p_actor_id,'expectedVersion',p_expected_version,'input',p_input),p_operation_id);$$;
revoke all on function private.administer_academic_metadata(jsonb,text,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_admin_catalog(jsonb),public.save_demo_scope(jsonb,uuid,integer,jsonb,uuid),public.set_demo_business_link(jsonb,uuid,integer,jsonb,uuid) from public,anon,service_role;
grant execute on function public.get_admin_catalog(jsonb),public.save_demo_scope(jsonb,uuid,integer,jsonb,uuid),public.set_demo_business_link(jsonb,uuid,integer,jsonb,uuid) to authenticated;
commit;
