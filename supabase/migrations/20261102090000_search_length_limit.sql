begin;
-- Search is matched against short scope codes; cap it at the 100 characters the
-- screens allow so an authenticated caller cannot force scans with huge strings.
create or replace function private.read_model_filters(filters jsonb, statuses text[]) returns jsonb
language plpgsql immutable set search_path='' as $$
declare p integer;s integer;
begin
 if jsonb_typeof(filters) is distinct from 'object' or exists(select 1 from jsonb_object_keys(filters) k where k not in ('page','pageSize','status','search'))
 or (filters?'page' and (jsonb_typeof(filters->'page')<>'number' or filters->>'page'!~'^[1-9][0-9]*$'))
 or (filters?'pageSize' and (jsonb_typeof(filters->'pageSize')<>'number' or filters->>'pageSize'!~'^[1-9][0-9]*$'))
 or (filters?'search' and (jsonb_typeof(filters->'search')<>'string' or length(filters->>'search')>100))
 or (filters?'status' and (jsonb_typeof(filters->'status')<>'string' or not(filters->>'status'=any(statuses)))) then raise exception using errcode='22023',message='invalid_input';end if;
 begin p:=coalesce((filters->>'page')::integer,1);s:=coalesce((filters->>'pageSize')::integer,25);
 exception when numeric_value_out_of_range then raise exception using errcode='22023',message='invalid_input';end;
 if s>100 then raise exception using errcode='22023',message='invalid_input';end if;
 return jsonb_build_object('page',p,'pageSize',s,'search',lower(coalesce(filters->>'search','')),'status',filters->>'status');
end;$$;

create or replace function public.get_operational_positions(p_contexto jsonb,p_filters jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_page integer; v_size integer; v_search text; v_status text; v_total integer; v_items jsonb;
begin
 -- Resolve authorization before parsing filters; no role is trusted from JSON.
 perform private.require_academic_context(p_contexto,'operational_read');
 if jsonb_typeof(p_filters) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_filters) k where k not in ('page','pageSize','status','search'))
  or (p_filters ? 'page' and (jsonb_typeof(p_filters->'page')<>'number' or p_filters->>'page' !~ '^[1-9][0-9]*$'))
  or (p_filters ? 'pageSize' and (jsonb_typeof(p_filters->'pageSize')<>'number' or p_filters->>'pageSize' !~ '^[1-9][0-9]*$'))
  or (p_filters ? 'search' and (jsonb_typeof(p_filters->'search')<>'string' or length(p_filters->>'search')>100))
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
commit;
