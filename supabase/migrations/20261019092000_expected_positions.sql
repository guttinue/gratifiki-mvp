begin;
-- Internal projection: no browser grant and no unvalidated target passed by caller.
create function private.operational_position_rows(p_contexto jsonb)
returns table(id uuid, codigo text, summary jsonb) language plpgsql stable security definer set search_path='' as $$
declare v_context jsonb;
begin
 v_context := private.require_academic_context(p_contexto,'operational_read');
 if v_context->>'role'='cam' then v_context:=private.require_academic_context(p_contexto,'cycle_read'); end if;
 return query select p.id,s.codigo,jsonb_build_object(
  'id',p.id,'escopoId',s.id,'escopoCodigo',s.codigo,'escopoTipo',s.tipo,'aplicavel',p.aplicavel,
  'status',coalesce(e.estado,'ausente'),'estadoDado',case when not p.aplicavel then 'nao_aplicavel' else r.estado_dado end,
  'version',p.lock_version,'revisionId',r.id,'inputValue',trim_scale(r.valor)::text,'resultValue',trim_scale(result.valor)::text)
 from public.posicoes_esperadas p join public.escopos s on s.id=p.alvo_id
 left join public.entradas e on e.posicao_id=p.id
 left join public.revisoes_entrada r on r.id=e.revisao_atual_id
 left join public.resultados result on result.revisao_id=r.id
 where p.competencia_id=(v_context->>'competenciaId')::uuid and p.indicador_id=(v_context->>'indicadorId')::uuid
  and v_context->'positionIds' ? p.id::text;
end;
$$;
create function public.get_operational_positions(p_contexto jsonb,p_filters jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_page integer; v_size integer; v_search text; v_status text; v_total integer; v_items jsonb;
begin
 -- Resolve authorization before parsing filters; no role is trusted from JSON.
 perform private.require_academic_context(p_contexto,'operational_read');
 if jsonb_typeof(p_filters) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_filters) k where k not in ('page','pageSize','status','search'))
  or (p_filters ? 'page' and (jsonb_typeof(p_filters->'page')<>'number' or p_filters->>'page' !~ '^[1-9][0-9]*$'))
  or (p_filters ? 'pageSize' and (jsonb_typeof(p_filters->'pageSize')<>'number' or p_filters->>'pageSize' !~ '^[1-9][0-9]*$'))
  or (p_filters ? 'search' and jsonb_typeof(p_filters->'search')<>'string')
  or (p_filters ? 'status' and (jsonb_typeof(p_filters->'status')<>'string' or p_filters->>'status' not in ('ausente','rascunho','enviada','em_revisao','devolvida','validada','invalidada'))) then
  raise exception using errcode='22023',message='invalid_input';
 end if;
 begin v_page:=coalesce((p_filters->>'page')::integer,1); v_size:=coalesce((p_filters->>'pageSize')::integer,25);
 exception when numeric_value_out_of_range then raise exception using errcode='22023',message='invalid_input'; end;
 if v_size>100 then raise exception using errcode='22023',message='invalid_input'; end if;
 v_search:=lower(coalesce(p_filters->>'search','')); v_status:=p_filters->>'status';
 with filtered as (select r.* from private.operational_position_rows(p_contexto) r where
  (v_status is null or r.summary->>'status'=v_status) and position(v_search in lower(r.codigo))>0),
 paged as (select * from filtered order by codigo,id limit v_size offset (v_page::bigint-1)*v_size)
 select (select count(*)::integer from filtered),coalesce(jsonb_agg(summary order by codigo,id),'[]'::jsonb) into v_total,v_items from paged;
 return jsonb_build_object('items',v_items,'total',v_total,'page',v_page,'pageSize',v_size);
end;
$$;
create function public.get_position_detail(p_contexto jsonb,p_position_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_position jsonb; v_entry uuid; v_revisions jsonb; v_decisions jsonb; v_memories jsonb;
begin
 select r.summary into v_position from private.operational_position_rows(p_contexto) r where r.id=p_position_id;
 if v_position is null then raise exception using errcode='42501',message='access_denied'; end if;
 select e.id into v_entry from public.entradas e where e.posicao_id=p_position_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'number',r.numero,'authorId',r.autor_id,
  'estadoDado',r.estado_dado,'value',trim_scale(r.valor)::text,'source',r.origem,'sourcePeriod',r.periodo_fonte,'reason',r.motivo,'submittedAt',r.enviada_em) order by r.numero,r.id),'[]'::jsonb)
 into v_revisions from public.revisoes_entrada r where r.entrada_id=v_entry;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'revisionId',d.revisao_id,'actorId',d.ator_id,'type',d.tipo,'reason',d.motivo,'reference',d.referencia,'occurredAt',d.ocorrido_em) order by d.ocorrido_em,d.id),'[]'::jsonb)
 into v_decisions from public.decisoes_entrada d join public.revisoes_entrada r on r.id=d.revisao_id where r.entrada_id=v_entry;
 select coalesce(jsonb_agg(jsonb_build_object('revisionId',r.id,'ruleVersion',rule.versao,'factor',trim_scale(rule.fator)::text,
  'inputValue',trim_scale(r.valor)::text,'resultValue',trim_scale(result.valor)::text) order by r.numero,r.id),'[]'::jsonb)
 into v_memories from public.resultados result join public.revisoes_entrada r on r.id=result.revisao_id join public.regras rule on rule.id=result.regra_id where r.entrada_id=v_entry;
 return jsonb_build_object('position',v_position,'revisions',v_revisions,'decisions',v_decisions,'memories',v_memories);
end;
$$;
revoke all on function private.operational_position_rows(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.get_operational_positions(jsonb,jsonb),public.get_position_detail(jsonb,uuid) from public,anon,service_role;
grant execute on function public.get_operational_positions(jsonb,jsonb),public.get_position_detail(jsonb,uuid) to authenticated;
commit;
