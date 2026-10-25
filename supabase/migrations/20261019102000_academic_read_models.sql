begin;
-- Private filter parser shared only by these read models. Authorize before use.
create function private.read_model_filters(filters jsonb, statuses text[]) returns jsonb
language plpgsql immutable set search_path='' as $$
declare p integer;s integer;
begin
 if jsonb_typeof(filters) is distinct from 'object' or exists(select 1 from jsonb_object_keys(filters) k where k not in ('page','pageSize','status','search'))
 or (filters?'page' and (jsonb_typeof(filters->'page')<>'number' or filters->>'page'!~'^[1-9][0-9]*$'))
 or (filters?'pageSize' and (jsonb_typeof(filters->'pageSize')<>'number' or filters->>'pageSize'!~'^[1-9][0-9]*$'))
 or (filters?'search' and jsonb_typeof(filters->'search')<>'string')
 or (filters?'status' and (jsonb_typeof(filters->'status')<>'string' or not(filters->>'status'=any(statuses)))) then raise exception using errcode='22023',message='invalid_input';end if;
 begin p:=coalesce((filters->>'page')::integer,1);s:=coalesce((filters->>'pageSize')::integer,25);
 exception when numeric_value_out_of_range then raise exception using errcode='22023',message='invalid_input';end;
 if s>100 then raise exception using errcode='22023',message='invalid_input';end if;
 return jsonb_build_object('page',p,'pageSize',s,'search',lower(coalesce(filters->>'search','')),'status',filters->>'status');
end;$$;

create function public.get_dashboard(p_contexto jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c jsonb;n integer;received integer;reviewed integer;unavailable integer;cards jsonb;is_leader boolean;
begin
 c:=private.require_academic_context(p_contexto,'context');is_leader:=c->>'role'='lideranca';
 c:=private.require_academic_context(p_contexto,case when is_leader then 'aggregate_dashboard' else 'dashboard' end);
 if c->>'role'='cam' then c:=private.require_academic_context(p_contexto,'cycle_read');end if;
 select count(*)::integer,count(*) filter(where p.aplicavel and r.enviada_em is not null and e.estado<>'rascunho')::integer,
 count(*) filter(where p.aplicavel and e.estado='validada' and exists(select 1 from public.decisoes_entrada d where d.revisao_id=r.id and d.tipo='validar' and d.ator_id<>r.autor_id))::integer,
 count(*) filter(where p.aplicavel and r.enviada_em is not null and r.estado_dado='indisponivel')::integer
 into n,received,reviewed,unavailable from public.posicoes_esperadas p left join public.entradas e on e.posicao_id=p.id left join public.revisoes_entrada r on r.id=e.revisao_atual_id
 where p.competencia_id=(c->>'competenciaId')::uuid and p.indicador_id=(c->>'indicadorId')::uuid and c->'positionIds'?p.id::text;
 if is_leader then cards:='[]'::jsonb;
 else
  select coalesce(jsonb_agg(jsonb_build_object('id',state,'label',state,'count',amount,'filter',case when state='todas' then jsonb_build_object('page',1,'pageSize',25) else jsonb_build_object('status',state,'page',1,'pageSize',25) end) order by rank),'[]'::jsonb) into cards
  from (select 'todas'::text state,n amount,0 rank union all select states.state,count(rows.id)::integer,states.rank from (values('ausente',1),('rascunho',2),('enviada',3),('em_revisao',4),('devolvida',5),('validada',6),('invalidada',7)) states(state,rank)
   left join private.operational_position_rows(p_contexto) rows on rows.summary->>'status'=states.state group by states.state,states.rank) counts;
 end if;
 return jsonb_build_object('expected',n,'received',received,'reviewed',reviewed,'unavailable',unavailable,'cards',cards);
end;$$;

create function private.evaluation_rows(p_contexto jsonb,p_view text) returns table(id uuid,codigo text,summary jsonb)
language plpgsql stable security definer set search_path='' as $$
declare c jsonb;
begin
 c:=private.require_academic_context(p_contexto,'evaluations');
 if p_view is null or p_view not in ('own','territory') then raise exception using errcode='22023',message='invalid_input';end if;
 if p_view='territory' and c->>'role'<>'gestor_distrital' then raise exception using errcode='42501',message='access_denied';end if;
 return query
 select p.id,case when pub.id is not null then i.alvo_codigo else s.codigo end,jsonb_build_object(
 'id',p.id,'escopoId',p.alvo_id,'escopoCodigo',case when pub.id is not null then i.alvo_codigo else s.codigo end,'escopoTipo',case when pub.id is not null then i.alvo_tipo else s.tipo end,
 'estadoDado',case when pub.id is not null then i.estado_dado when not p.aplicavel then 'nao_aplicavel' else r.estado_dado end,
 'inputValue',trim_scale(case when pub.id is not null then i.valor_entrada when p.aplicavel then r.valor end)::text,
 'resultValue',trim_scale(case when pub.id is not null then i.valor_resultado when p.aplicavel then result.valor end)::text,
 'ruleVersion',case when pub.id is not null then i.regra_versao else rule.versao end,
 'publication',case when pub.id is not null then 'publicada_demo' else 'preliminar' end,'snapshotId',case when pub.id is not null then f.id end,
 'factor',trim_scale(case when pub.id is not null then i.fator when p.aplicavel and r.estado_dado='valor' then rule.fator end)::text,'unidadeMedida','pontos sintéticos')
 from public.posicoes_esperadas p join public.escopos s on s.id=p.alvo_id join public.regras rule on rule.id=p.regra_id
 left join public.entradas e on e.posicao_id=p.id left join public.revisoes_entrada r on r.id=e.revisao_atual_id and r.entrada_id=e.id
 left join public.resultados result on result.revisao_id=r.id and result.regra_id=p.regra_id
 left join public.fechamentos f on f.competencia_id=p.competencia_id left join public.publicacoes pub on pub.fechamento_id=f.id
 left join public.itens_fechamento i on i.fechamento_id=f.id and i.posicao_id=p.id
 where p.competencia_id=(c->>'competenciaId')::uuid and p.indicador_id=(c->>'indicadorId')::uuid and c->'positionIds'?p.id::text
 and ((p_view='own' and p.alvo_id=(c->>'escopoId')::uuid) or (p_view='territory' and s.tipo='unidade' and p.alvo_id<>(c->>'escopoId')::uuid))
 and ((pub.id is not null and i.id is not null) or (pub.id is null and (not p.aplicavel or (e.estado='validada' and r.enviada_em is not null and exists(select 1 from public.decisoes_entrada d where d.revisao_id=r.id and d.tipo='validar' and d.ator_id<>r.autor_id)))));
end;$$;
create function public.get_my_evaluations(p_contexto jsonb,p_view text,p_filters jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f jsonb;n integer;items jsonb;
begin
 perform private.require_academic_context(p_contexto,'evaluations');
 f:=private.read_model_filters(p_filters,array['preliminar','publicada_demo']);
 with filtered as(select * from private.evaluation_rows(p_contexto,p_view) r where position(f->>'search' in lower(r.codigo))>0 and (f->>'status' is null or r.summary->>'publication'=f->>'status')),
 paged as(select * from filtered order by codigo,id limit (f->>'pageSize')::integer offset ((f->>'page')::bigint-1)*(f->>'pageSize')::integer)
 select (select count(*)::integer from filtered),coalesce(jsonb_agg(summary order by codigo,id),'[]'::jsonb) into n,items from paged;
 return jsonb_build_object('items',items,'total',n,'page',f->'page','pageSize',f->'pageSize');
end;$$;

create function public.get_leadership_aggregates(p_contexto jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c jsonb;result jsonb;
begin
 c:=private.require_academic_context(p_contexto,'leadership_aggregates');
 select coalesce(jsonb_agg(row),'[]'::jsonb) into result from (
 select jsonb_build_object('competencia',comp.codigo,'distritoCodigo',i.distrito_codigo,'unidadeMedida','pontos sintéticos','publishedUnits',count(*)::integer,
 'calculableUnits',count(*) filter(where i.estado_dado='valor')::integer,'resultSum',trim_scale(sum(i.valor_resultado) filter(where i.estado_dado='valor'))::text) row
 from public.fechamentos f join public.publicacoes pub on pub.fechamento_id=f.id join public.itens_fechamento i on i.fechamento_id=f.id join public.competencias comp on comp.id=f.competencia_id
 join public.posicoes_esperadas p on p.id=i.posicao_id
 where f.competencia_id=(c->>'competenciaId')::uuid and p.indicador_id=(c->>'indicadorId')::uuid and c->'positionIds'?p.id::text and i.alvo_tipo='unidade' and i.distrito_id=(c->>'escopoId')::uuid
 group by comp.codigo,i.distrito_codigo order by comp.codigo,i.distrito_codigo) grouped;
 return result;
end;$$;

create function public.get_scoped_audit(p_contexto jsonb,p_filters jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c jsonb;f jsonb;role_name text;actions text[];items jsonb;n integer;
begin
 c:=private.require_academic_context(p_contexto,'context');role_name:=c->>'role';
 c:=private.require_academic_context(p_contexto,case when role_name='administrador' then 'admin_audit' when role_name in ('gestor_unidade','gestor_distrital') then 'evaluation_history' else 'operational_audit' end);
 if role_name='cam' then c:=private.require_academic_context(p_contexto,'cycle_read');end if;
 actions:=case when role_name='administrador' then array['escopo_demo_salvo','vinculo_demo_alterado','competencia_demo_aberta','posicao_demo_reatribuida','regra_demo_agendada']
 when role_name in ('gestor_unidade','gestor_distrital') then array['posicao_validada','ciclo_publicado_demo']
 else array['rascunho_salvo','posicao_enviada','posicao_em_revisao','posicao_validada','posicao_devolvida','retificacao_autorizada','posicao_corrigida','indisponibilidade_decidida','ciclo_em_consolidacao','ciclo_reaberto','ciclo_fechado','ciclo_publicado_demo'] end;
 f:=private.read_model_filters(p_filters,actions);
 with scoped as (
 select a.* from public.eventos_auditoria a where a.acao=any(actions)
 and (role_name='administrador' or (a.recurso_tipo='posicao' and c->'positionIds'?a.recurso_id::text
 and (role_name not in ('gestor_unidade','gestor_distrital') or exists(select 1 from private.evaluation_rows(p_contexto,'own') ev where ev.id=a.recurso_id)))
 or (a.recurso_tipo='competencia' and a.recurso_id=(c->>'competenciaId')::uuid and role_name='cam'
 and not exists(select 1 from public.posicoes_esperadas p where p.competencia_id=(c->>'competenciaId')::uuid and not(c->'positionIds'?p.id::text))))),
 filtered as (
 select a.id,a.ocorrido_em,jsonb_build_object('id',a.id,'occurredAt',a.ocorrido_em,'action',a.acao,'resourceId',a.recurso_id,
 'version',case when jsonb_typeof(a.detalhes->'version')='number' and a.detalhes->>'version'~'^[1-9][0-9]{0,8}$' then (a.detalhes->>'version')::integer end,
 'reason',case when role_name not in ('administrador','gestor_unidade','gestor_distrital') and jsonb_typeof(a.detalhes->'reason')='string' then a.detalhes->>'reason' end) summary
 from scoped a where (f->>'status' is null or a.acao=f->>'status')
 and (position(f->>'search' in lower(a.acao))>0 or
  (role_name in ('gestor_unidade','gestor_distrital') and a.recurso_tipo='posicao' and exists(
   select 1 from private.evaluation_rows(p_contexto,'own') ev where ev.id=a.recurso_id and position(f->>'search' in lower(ev.codigo))>0)) or
  (role_name in ('area_tecnica','revisor_tecnico','cam') and a.recurso_tipo='posicao' and exists(
   select 1 from public.posicoes_esperadas p join public.escopos s on s.id=p.alvo_id
   where p.id=a.recurso_id and c->'positionIds'?p.id::text and position(f->>'search' in lower(s.codigo))>0)))),
 paged as(select * from filtered order by ocorrido_em,id limit (f->>'pageSize')::integer offset ((f->>'page')::bigint-1)*(f->>'pageSize')::integer)
 select (select count(*)::integer from filtered),coalesce(jsonb_agg(summary order by ocorrido_em,id),'[]'::jsonb) into n,items from paged;
 return jsonb_build_object('items',items,'total',n,'page',f->'page','pageSize',f->'pageSize');
end;$$;
revoke all on function private.read_model_filters(jsonb,text[]),private.evaluation_rows(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.get_dashboard(jsonb),public.get_my_evaluations(jsonb,text,jsonb),public.get_leadership_aggregates(jsonb),public.get_scoped_audit(jsonb,jsonb) from public,anon,service_role;
grant execute on function public.get_dashboard(jsonb),public.get_my_evaluations(jsonb,text,jsonb),public.get_leadership_aggregates(jsonb),public.get_scoped_audit(jsonb,jsonb) to authenticated;
commit;
