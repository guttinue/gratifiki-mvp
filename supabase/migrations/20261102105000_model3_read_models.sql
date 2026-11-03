begin;

-- Model-3 read models: unit results, leadership aggregates, export rows and the
-- read-only rule catalogue. Open months are scored live by
-- private.pontuacao_unidade; closed months read only the frozen snapshot
-- (itens_fechamento, pontuacoes_fechamento). Model-2 paths are unchanged.

-- From 20261019091000_academic_access.sql. Adds unit_results (managers and
-- CAM) and rule_catalog (administrator and CAM); the rest is unchanged.
create or replace function private.academic_capability_allowed(p_role text,p_capability text)
returns boolean language sql immutable set search_path='' as $$
 select case p_capability
  when 'context' then p_role in ('area_tecnica','revisor_tecnico','cam','gestor_unidade','gestor_distrital','administrador','lideranca')
  when 'operational_read' then p_role in ('area_tecnica','revisor_tecnico','cam')
  when 'dashboard' then p_role in ('area_tecnica','revisor_tecnico','cam')
  when 'operational_audit' then p_role in ('area_tecnica','revisor_tecnico','cam')
  when 'draft' then p_role='area_tecnica'
  when 'submit' then p_role='area_tecnica'
  when 'correct' then p_role='area_tecnica'
  when 'start_review' then p_role='revisor_tecnico'
  when 'review' then p_role='revisor_tecnico'
  when 'authorize_correction' then p_role='cam'
  when 'decide_unavailability' then p_role='cam'
  when 'cycle_read' then p_role='cam'
  when 'cycle_transition' then p_role='cam'
  when 'cycle_publish' then p_role='cam'
  when 'export' then p_role='cam'
  when 'evaluations' then p_role in ('gestor_unidade','gestor_distrital')
  when 'evaluation_history' then p_role in ('gestor_unidade','gestor_distrital')
  when 'leadership_aggregates' then p_role='lideranca'
  when 'aggregate_dashboard' then p_role='lideranca'
  when 'admin_catalog' then p_role='administrador'
  when 'admin_write' then p_role='administrador'
  when 'admin_audit' then p_role='administrador'
  when 'unit_results' then p_role in ('cam','gestor_unidade','gestor_distrital')
  when 'rule_catalog' then p_role in ('administrador','cam')
  else false end;
$$;

-- Units an actor may read in a model-3 competence, with the frozen territory.
-- A unit counts only when the actor holds an authorized context of the same
-- role for EVERY indicator of the competence set, so a unit score never mixes
-- in an indicator outside the actor's links. Scope per role: the unit manager's
-- own unit, the district manager's district units, the CAM's unit links and
-- the units of every district where leadership holds links.
create function private.result_unit_ids(p_role text,p_escopo_id uuid,p_competencia_id uuid)
returns table(unidade_id uuid,distrito_id uuid)
language sql stable security definer set search_path='' as $$
 with c as (select id,conjunto_id from public.competencias where id=p_competencia_id and modelo=3),
 covered as (
  select r.escopo_id from private.authorized_context_rows() r
  join c on c.id=r.competencia_id
  join public.itens_conjunto i on i.conjunto_id=c.conjunto_id and i.indicador_id=r.indicador_id
  where r.mode='academic' and r.papel=p_role and (p_role in ('cam','lideranca') or r.escopo_id=p_escopo_id)
  group by r.escopo_id
  having count(distinct r.indicador_id)=(select count(*) from public.itens_conjunto i join c on i.conjunto_id=c.conjunto_id))
 select distinct t.unidade_id,t.distrito_id from public.territorios_competencia t
 join public.escopos u on u.id=t.unidade_id and u.tipo='unidade'
 join covered k on k.escopo_id=case when p_role in ('cam','gestor_unidade') then t.unidade_id else t.distrito_id end
 where t.competencia_id=p_competencia_id;
$$;

-- One row per readable unit: score and items. Live for an open competence,
-- frozen once closed (points and weights from the columns, never from the
-- submission-time memory, which differs in redistribuir mode). Values appear
-- only for accepted items; reviewStatus is private.situacao_posicao.
create function private.unit_result_rows(p_competencia_id uuid,p_role text,p_escopo_id uuid)
returns table(unit_id uuid,unit_code text,district_code text,points numeric,complete boolean,no_base boolean,items jsonb)
language plpgsql stable security definer set search_path='' as $$
#variable_conflict use_column
declare v_set uuid;v_closure uuid;
begin
 select c.conjunto_id,f.id into v_set,v_closure from public.competencias c left join public.fechamentos f on f.competencia_id=c.id where c.id=p_competencia_id and c.modelo=3;
 if v_set is null then raise exception using errcode='22023',message='invalid_input';end if;
 if v_closure is not null then
  return query
  select u.unidade_id,s.alvo_codigo,
   (select i.distrito_codigo from public.itens_fechamento i where i.fechamento_id=v_closure and i.alvo_id=u.unidade_id and i.distrito_codigo is not null limit 1),
   s.pontos,s.completo,s.sem_base,
   (select jsonb_agg(jsonb_build_object('indicatorCode',i.indicador_codigo,'name',coalesce(r.nome,i.indicador_codigo),'state',i.estado_dado,
     'inputValue',trim_scale(i.valor_entrada)::text,'meta',trim_scale(i.meta)::text,'direction',i.direcao,'weight',trim_scale(i.peso)::text,
     'effectiveWeight',trim_scale(i.peso_efetivo)::text,'points',trim_scale(i.pontos)::text,
     'expression',case when i.estado_dado='valor' then private.calcular_pontos(r,i.peso_efetivo,i.valor_entrada)->>'expression' end,
     'reviewStatus',private.situacao_posicao(i.posicao_id)) order by i.indicador_codigo collate "C")
    from public.itens_fechamento i join public.regras r on r.id=i.regra_id
    where i.fechamento_id=v_closure and i.alvo_id=u.unidade_id)
  from private.result_unit_ids(p_role,p_escopo_id,p_competencia_id) u
  join public.pontuacoes_fechamento s on s.fechamento_id=v_closure and s.alvo_id=u.unidade_id;
 else
  return query
  select u.unidade_id,s.codigo,d.codigo,(x.sc->>'points')::numeric,(x.sc->>'complete')::boolean,(x.sc->>'noBase')::boolean,
   (select jsonb_agg(jsonb_build_object('indicatorCode',it->>'code','name',coalesce(r.nome,it->>'code'),'state',it->>'state',
     'inputValue',case when it->>'state'='valor' then trim_scale(v.valor)::text end,'meta',trim_scale(r.meta)::text,'direction',r.direcao,
     'weight',it->>'weight','effectiveWeight',it->>'effectiveWeight','points',it->>'points',
     'expression',case when it->>'state'='valor' then private.calcular_pontos(r,(it->>'effectiveWeight')::numeric,v.valor)->>'expression' end,
     'reviewStatus',private.situacao_posicao(p.id)) order by it->>'code' collate "C")
    from jsonb_array_elements(x.sc->'items') it
    join public.itens_conjunto i on i.conjunto_id=v_set and i.indicador_id=(it->>'indicatorId')::uuid
    join public.regras r on r.id=i.regra_id and r.indicador_id=i.indicador_id
    left join public.posicoes_esperadas p on p.competencia_id=p_competencia_id and p.indicador_id=i.indicador_id and p.alvo_id=u.unidade_id
    left join public.entradas e on e.posicao_id=p.id
    left join public.revisoes_entrada v on v.id=e.revisao_atual_id and v.entrada_id=e.id)
  from private.result_unit_ids(p_role,p_escopo_id,p_competencia_id) u
  join public.escopos s on s.id=u.unidade_id
  join public.escopos d on d.id=u.distrito_id
  cross join lateral (select private.pontuacao_unidade(p_competencia_id,u.unidade_id) sc) x;
 end if;
end;$$;

-- Unit results for managers and the CAM. A context of any set indicator
-- expands to the whole set. "previous" is the latest earlier PUBLISHED month
-- of the same set code (frozen score, unit readable there too); "delta" only
-- when both scores are complete (focus 3).
create function public.get_unit_results(p_contexto jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ctx jsonb;c public.competencias%rowtype;prev public.competencias%rowtype;prev_closure uuid;published boolean;units jsonb;
begin
 ctx:=private.require_academic_context(p_contexto,'unit_results');
 select * into c from public.competencias where id=(ctx->>'competenciaId')::uuid;
 if c.modelo<>3 then raise exception using errcode='22023',message='invalid_input';end if;
 published:=exists(select 1 from public.fechamentos f join public.publicacoes pub on pub.fechamento_id=f.id where f.competencia_id=c.id);
 select pc.* into prev from public.competencias pc join public.conjuntos_regra ps on ps.id=pc.conjunto_id
 where pc.modelo=3 and pc.referencia<c.referencia and ps.codigo=(select s.codigo from public.conjuntos_regra s where s.id=c.conjunto_id)
  and exists(select 1 from public.fechamentos f join public.publicacoes pub on pub.fechamento_id=f.id where f.competencia_id=pc.id)
 order by pc.referencia desc limit 1;
 select f.id into prev_closure from public.fechamentos f where f.competencia_id=prev.id;
 select jsonb_agg(jsonb_build_object('unitId',u.unit_id,'unitCode',u.unit_code,'districtCode',u.district_code,'points',trim_scale(u.points)::text,
   'complete',u.complete,'noBase',u.no_base,'partial',not u.complete,
   'previous',case when pv.alvo_id is not null then jsonb_build_object('points',trim_scale(pv.pontos)::text,'competencia',prev.codigo) end,
   'delta',case when u.complete and u.points is not null and pv.completo and pv.pontos is not null then round(u.points-pv.pontos,2)::text end,
   'items',u.items) order by u.unit_code collate "C")
 into units
 from private.unit_result_rows(c.id,ctx->>'role',(ctx->>'escopoId')::uuid) u
 left join (select s.alvo_id,s.pontos,s.completo from public.pontuacoes_fechamento s
  join private.result_unit_ids(ctx->>'role',(ctx->>'escopoId')::uuid,prev.id) pu on pu.unidade_id=s.alvo_id
  where s.fechamento_id=prev_closure) pv on pv.alvo_id=u.unit_id;
 if units is null then raise exception using errcode='42501',message='access_denied';end if;
 return jsonb_build_object('competencia',c.codigo,'state',c.estado,'publication',case when published then 'publicada_demo' else 'nao_publicada' end,'units',units);
end;$$;

-- From 20261019102000_academic_read_models.sql. Model 3 returns the accepted
-- percentage, the simple average of complete unit scores per district and the
-- units that need action (pending item count). No person, no individual value.
-- The model-2 body is unchanged.
create or replace function public.get_leadership_aggregates(p_contexto jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c jsonb;result jsonb;
begin
 c:=private.require_academic_context(p_contexto,'leadership_aggregates');
 if (select modelo from public.competencias where id=(c->>'competenciaId')::uuid)=3 then
  with u as materialized (select * from private.unit_result_rows((c->>'competenciaId')::uuid,'lideranca',(c->>'escopoId')::uuid)),
  it as (select u.unit_code,x->>'reviewStatus' in ('valor','indisponivel','nao_aplicavel') accepted from u cross join jsonb_array_elements(u.items) x)
  select jsonb_build_object(
   'acceptedPercent',(select round(100.0*count(*) filter(where accepted)/count(*),2)::text from it),
   'districts',(select jsonb_agg(d order by code collate "C") from (
     select u.district_code code,jsonb_build_object('districtCode',u.district_code,'average',round(avg(u.points) filter(where u.complete and u.points is not null),2)::text,
      'completeUnits',count(*) filter(where u.complete)::integer,'totalUnits',count(*)::integer) d
     from u group by u.district_code) g),
   'attention',(select coalesce(jsonb_agg(jsonb_build_object('unitCode',unit_code,'pending',pending) order by unit_code collate "C"),'[]'::jsonb) from (
     select unit_code,count(*) filter(where not accepted)::integer pending from it group by unit_code) a where pending>0))
  into result where exists(select 1 from u);
  if result is null then raise exception using errcode='42501',message='access_denied';end if;
  return result;
 end if;
 select coalesce(jsonb_agg(row),'[]'::jsonb) into result from (
 select jsonb_build_object('competencia',comp.codigo,'distritoCodigo',i.distrito_codigo,'unidadeMedida','pontos sintéticos','publishedUnits',count(*)::integer,
 'calculableUnits',count(*) filter(where i.estado_dado='valor')::integer,'resultSum',trim_scale(sum(i.valor_resultado) filter(where i.estado_dado='valor'))::text) row
 from public.fechamentos f join public.publicacoes pub on pub.fechamento_id=f.id join public.itens_fechamento i on i.fechamento_id=f.id join public.competencias comp on comp.id=f.competencia_id
 join public.posicoes_esperadas p on p.id=i.posicao_id
 where f.competencia_id=(c->>'competenciaId')::uuid and p.indicador_id=(c->>'indicadorId')::uuid and c->'positionIds'?p.id::text and i.alvo_tipo='unidade' and i.distrito_id=(c->>'escopoId')::uuid
 group by comp.codigo,i.distrito_codigo order by comp.codigo,i.distrito_codigo) grouped;
 return result;
end;$$;

-- From 20261019103000_academic_export.sql. A model-3 snapshot spans every set
-- indicator (the CAM export context already covers them, T6) and exports
-- contract version 2: frozen state, value, target, weights, points, set code,
-- set version and synthetic flag per row; totals sum the frozen points. The
-- model-2 checks, rows and contract version 1 are unchanged.
create or replace function private.export_academic_snapshot(p_contexto jsonb,p_payload jsonb,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctx jsonb;c public.competencias%rowtype;f public.fechamentos%rowtype;old_op public.operacoes_dominio%rowtype;
 sid uuid;canonical jsonb;response jsonb;rows jsonb;totals jsonb;versions jsonb;publication_version integer;contract integer;
 position_count integer;calculable_count integer;unavailable_count integer;na_count integer;
begin
 ctx:=private.require_academic_context(p_contexto,'export');
 -- Possessing one district CAM context never implies coverage of its units.
 if not exists(select 1 from public.posicoes_esperadas where competencia_id=(ctx->>'competenciaId')::uuid) or exists(select 1 from public.posicoes_esperadas p where p.competencia_id=(ctx->>'competenciaId')::uuid and not(ctx->'positionIds'?p.id::text)) then raise exception using errcode='42501',message='access_denied';end if;
 if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_payload))<>1 or not(p_payload?'snapshotId') or jsonb_typeof(p_payload->'snapshotId') is distinct from 'string' then raise exception using errcode='22023',message='invalid_input';end if;
 begin sid:=(p_payload->>'snapshotId')::uuid;exception when invalid_text_representation then raise exception using errcode='22023',message='invalid_input';end;
 if sid is null then raise exception using errcode='22023',message='invalid_input';end if;
 canonical:=jsonb_build_object('context',p_contexto,'snapshotId',sid);
 -- Same order as cycle writers; authority is re-resolved after every wait.
 select * into c from public.competencias where id=(ctx->>'competenciaId')::uuid for update;
 perform id from public.posicoes_esperadas where competencia_id=c.id order by id for update;
 perform e.id from public.entradas e join public.posicoes_esperadas p on p.id=e.posicao_id where p.competencia_id=c.id order by e.id for update of e;
 perform v.id from public.revisoes_entrada v join public.entradas e on e.id=v.entrada_id where e.competencia_id=c.id and e.posicao_id is not null order by v.id for update of v;
 select * into f from public.fechamentos where competencia_id=c.id for update;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_operation_id::text,0));
 ctx:=private.require_academic_context(p_contexto,'export');
 if not exists(select 1 from public.posicoes_esperadas where competencia_id=c.id) or exists(select 1 from public.posicoes_esperadas p where p.competencia_id=c.id and not(ctx->'positionIds'?p.id::text)) then raise exception using errcode='42501',message='access_denied';end if;
 if c.estado<>'fechada' then raise exception using errcode='55000',message='invalid_state';end if;
 if f.id is null or f.id<>sid then raise exception using errcode='42501',message='access_denied';end if;
 -- Export is entirely snapshot-based, including labels. Missing metadata on
 -- a pre-upgrade snapshot is not repaired or substituted with today's labels.
 if f.competencia_codigo is null or exists(select 1 from public.itens_fechamento where fechamento_id=f.id and (indicador_id is null or indicador_codigo is null or unidade_medida is null
   or (c.modelo=3 and (metodo is distinct from 'meta_peso' or meta is null or peso is null or conjunto_id is null or conjunto_versao is null)))) then raise exception using errcode='55000',message='snapshot_metadata_unavailable';end if;
 if not exists(select 1 from public.itens_fechamento where fechamento_id=f.id) or exists(select 1 from public.itens_fechamento i where i.fechamento_id=f.id and ((c.modelo<>3 and i.indicador_id<>(ctx->>'indicadorId')::uuid) or not(ctx->'positionIds'?i.posicao_id::text))) then raise exception using errcode='42501',message='access_denied';end if;
 select * into old_op from public.operacoes_dominio where ator_id=auth.uid() and operation_id=p_operation_id;
 if old_op.id is not null then
  if old_op.comando<>'get_snapshot_export' or old_op.payload<>canonical then raise exception using errcode='22023',message='operation_payload_mismatch';end if;
  return old_op.resposta;
 end if;
 publication_version:=case when exists(select 1 from public.publicacoes where fechamento_id=f.id) then 1 else 0 end;
 contract:=case when c.modelo=3 then 2 else 1 end;
 select count(*)::integer,count(*)filter(where i.estado_dado='valor')::integer,count(*)filter(where i.estado_dado='indisponivel')::integer,count(*)filter(where i.estado_dado='nao_aplicavel')::integer,
  jsonb_agg(case when contract=2 then
   jsonb_build_object('snapshotId',f.id,'competencia',f.competencia_codigo,'indicador',i.indicador_codigo,'alvoTipo',i.alvo_tipo,'alvoCodigo',i.alvo_codigo,'regraVersao',i.regra_versao,'revisao',i.revisao_numero,
    'situacaoDado',i.estado_dado,'valor',trim_scale(i.valor_entrada)::text,'meta',trim_scale(i.meta)::text,'peso',trim_scale(i.peso)::text,'pesoEfetivo',trim_scale(i.peso_efetivo)::text,'pontos',trim_scale(i.pontos)::text,
    'conjunto',cs.codigo,'conjuntoVersao',i.conjunto_versao,'sintetico',cs.sintetico,'publicacao',case publication_version when 1 then 'publicada_demo' else 'nao_publicada' end)
  else
   jsonb_build_object('snapshotId',f.id,'competencia',f.competencia_codigo,'indicador',i.indicador_codigo,'alvoTipo',i.alvo_tipo,'alvoCodigo',i.alvo_codigo,'regraVersao',i.regra_versao,'revisao',i.revisao_numero,'estadoDado',i.estado_dado,'entrada',trim_scale(i.valor_entrada)::text,'fator',trim_scale(i.fator)::text,'resultado',trim_scale(i.valor_resultado)::text,'publicacao',case publication_version when 1 then 'publicada_demo' else 'nao_publicada' end)
  end order by i.alvo_tipo collate "C",i.alvo_codigo collate "C",i.indicador_codigo collate "C")
 into position_count,calculable_count,unavailable_count,na_count,rows
 from public.itens_fechamento i left join public.conjuntos_regra cs on contract=2 and cs.id=i.conjunto_id where i.fechamento_id=f.id;
 select jsonb_agg(versao order by versao) into versions from(select distinct regra_versao versao from public.itens_fechamento where fechamento_id=f.id)v;
 select coalesce(jsonb_agg(jsonb_build_object('tipo',alvo_tipo,'unidadeMedida',unidade_medida,'sum',trim_scale(soma)::text) order by alvo_tipo collate "C",unidade_medida collate "C"),'[]'::jsonb) into totals
 from(select alvo_tipo,unidade_medida,sum(case when contract=2 then pontos else valor_resultado end) soma from public.itens_fechamento where fechamento_id=f.id and estado_dado='valor' group by alvo_tipo,unidade_medida)t;
 response:=jsonb_build_object('contractVersion',contract,'snapshotId',f.id,'rows',rows,'manifest',jsonb_build_object('competencia',f.competencia_codigo,'ruleVersions',versions,'publicationVersion',publication_version,'positionCount',position_count,'calculableCount',calculable_count,'unavailableCount',unavailable_count,'notApplicableCount',na_count,'totals',totals));
 insert into public.eventos_auditoria(actor_id,acao,recurso_tipo,recurso_id,detalhes,correlacao_id) values(auth.uid(),'snapshot_exportado_demo','competencia',c.id,jsonb_build_object('version',c.lock_version,'snapshotId',f.id,'contractVersion',contract,'publicationVersion',publication_version),p_operation_id);
 insert into public.operacoes_dominio(ator_id,operation_id,comando,payload,resposta) values(auth.uid(),p_operation_id,'get_snapshot_export',canonical,response);
 return response;
end;$$;

-- Read-only rule catalogue (administrator and CAM): every rule set with its
-- version, absence mode, validity, reference and whether a competence uses it,
-- plus its items. Metadata only, no evaluation value.
create function public.get_rule_catalog(p_contexto jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_academic_context(p_contexto,'rule_catalog');
 return jsonb_build_object('ruleSets',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'code',s.codigo,'version',s.versao,'mode',s.modo_ausencia,'synthetic',s.sintetico,
   'validFrom',s.vigencia_inicio,'reference',s.referencia,'inUse',exists(select 1 from public.competencias c where c.conjunto_id=s.id),
   'items',(select coalesce(jsonb_agg(jsonb_build_object('indicatorCode',ind.codigo,'name',coalesce(r.nome,ind.codigo),'meta',trim_scale(r.meta)::text,'direction',r.direcao,
     'decimals',r.casas_decimais,'maximum',trim_scale(r.valor_maximo)::text,'unit',r.unidade_medida,'weight',trim_scale(i.peso)::text) order by ind.codigo collate "C"),'[]'::jsonb)
    from public.itens_conjunto i join public.indicadores ind on ind.id=i.indicador_id join public.regras r on r.id=i.regra_id and r.indicador_id=i.indicador_id
    where i.conjunto_id=s.id)) order by s.codigo collate "C",s.versao) from public.conjuntos_regra s),'[]'::jsonb));
end;$$;

revoke all on function private.result_unit_ids(text,uuid,uuid),private.unit_result_rows(uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_unit_results(jsonb),public.get_rule_catalog(jsonb) from public,anon,service_role;
grant execute on function public.get_unit_results(jsonb),public.get_rule_catalog(jsonb) to authenticated;

commit;
