begin;

-- Model-3 cycle and closure. Every replaced body is restated from its latest
-- definition; the model-2 paths are unchanged. Model 3 adds: CAM cycle
-- contexts spanning the set indicators, one acceptance predicate shared by the
-- unit score and the checklist, and frozen unit scores at closing.

-- Frozen model-3 inputs only take known values; model-2 items keep NULL.
alter table public.itens_fechamento
 add constraint itens_fechamento_metodo_check check (metodo in ('fator','meta_peso')),
 add constraint itens_fechamento_direcao_check check (direcao in ('maior_melhor','menor_melhor')),
 add constraint itens_fechamento_modo_ausencia_check check (modo_ausencia in ('zero','redistribuir'));

-- From 20261019101000_academic_closure.sql. A closed competence also keeps its
-- rule set (whose version and mode are frozen by guard_used_rule_set).
create or replace function private.guard_closed_cycle() returns trigger language plpgsql set search_path='' as $$
declare cid uuid;
begin
 if tg_table_name='competencias' then
  if exists(select 1 from public.fechamentos where competencia_id=old.id) and (tg_op='DELETE' or (new.id,new.codigo,new.referencia,new.estado,new.modelo,new.conjunto_id) is distinct from (old.id,old.codigo,old.referencia,old.estado,old.modelo,old.conjunto_id)) and not(tg_op='UPDATE' and old.estado='em_consolidacao' and new.estado='fechada') then raise exception using errcode='55000',message='closed_cycle_is_immutable';end if;
 elsif tg_table_name in ('posicoes_esperadas','entradas') then
  cid:=case when tg_op='DELETE' then old.competencia_id else new.competencia_id end;
  if exists(select 1 from public.fechamentos where competencia_id=cid or (tg_op='UPDATE' and competencia_id=old.competencia_id)) then raise exception using errcode='55000',message='closed_cycle_is_immutable';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;

-- R-10: the single model-3 acceptance predicate. A position counts once the
-- technical review validated its current sent revision and the validator is
-- not the author (the model-2 cycle rule). A state without value also needs
-- the CAM decision with reason and reference. Pending states name the reason:
-- sem_envio, em_conferencia, decisao_pendente.
create function private.situacao_posicao(p_posicao_id uuid) returns text
language sql stable set search_path='' as $$
 select coalesce((select case
   when not p.aplicavel then 'nao_aplicavel'
   when e.id is null or v.id is null or v.enviada_em is null or e.estado in ('rascunho','devolvida') then 'sem_envio'
   when e.estado<>'validada' or not exists(select 1 from public.decisoes_entrada d where d.revisao_id=v.id and d.tipo='validar' and d.ator_id<>v.autor_id) then 'em_conferencia'
   when v.estado_dado='valor' then 'valor'
   when exists(select 1 from public.decisoes_entrada d where d.revisao_id=v.id and d.tipo='decidir_indisponibilidade' and private.trim_academic_text(d.referencia)<>'' and private.trim_academic_text(d.motivo)<>'') then v.estado_dado
   else 'decisao_pendente' end
  from public.posicoes_esperadas p
  left join public.entradas e on e.posicao_id=p.id and e.competencia_id=p.competencia_id and e.indicador_id=p.indicador_id and e.escopo_id=p.alvo_id
  left join public.revisoes_entrada v on v.id=e.revisao_atual_id and v.entrada_id=e.id
  where p.id=p_posicao_id),'sem_envio');
$$;

-- From 20261102101000_rule_set_scoring.sql. Item states now come from
-- private.situacao_posicao (R-10); the scoring is unchanged.
create or replace function private.pontuacao_unidade(p_competencia_id uuid,p_alvo_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare v_mode text;v_result jsonb;
begin
 select s.modo_ausencia into v_mode from public.competencias c join public.conjuntos_regra s on s.id=c.conjunto_id where c.id=p_competencia_id and c.modelo=3;
 if v_mode is null then raise exception using errcode='22023',message='invalid_input'; end if;
 with base as (
  select i.indicador_id,ind.codigo,i.peso,r as regra,v.valor,
   case when x.st in ('valor','indisponivel','nao_aplicavel') then x.st else 'pendente' end estado
  from public.competencias c
  join public.itens_conjunto i on i.conjunto_id=c.conjunto_id
  join public.indicadores ind on ind.id=i.indicador_id
  join public.regras r on r.id=i.regra_id and r.indicador_id=i.indicador_id
  left join public.posicoes_esperadas p on p.competencia_id=c.id and p.indicador_id=i.indicador_id and p.alvo_id=p_alvo_id
  left join public.entradas e on e.posicao_id=p.id
  left join public.revisoes_entrada v on v.id=e.revisao_atual_id and v.entrada_id=e.id
  cross join lateral (select private.situacao_posicao(p.id) st) x
  where c.id=p_competencia_id
 ), weighted as (
  select b.*,case when v_mode='zero' then b.peso
   when b.estado='valor' then round(b.peso*100/sum(b.peso) filter(where b.estado='valor') over(),10) end peso_efetivo
  from base b
 ), scored as (
  select w.*,case when w.estado='valor' then private.calcular_pontos(w.regra,w.peso_efetivo,w.valor) end calculo from weighted w
 ), items as (
  select s.*,case when s.estado='valor' then (s.calculo->>'points')::numeric when s.estado<>'pendente' and v_mode='zero' then 0 end pontos from scored s
 )
 select jsonb_build_object(
  'points',case when v_mode='redistribuir' and count(*) filter(where estado='valor')=0 then null else trim_scale(coalesce(sum(pontos) filter(where estado<>'pendente'),0))::text end,
  'complete',count(*) filter(where estado='pendente')=0,
  'noBase',v_mode='redistribuir' and count(*) filter(where estado='valor')=0,
  'mode',v_mode,
  'items',jsonb_agg(jsonb_build_object('indicatorId',indicador_id,'code',codigo,'state',estado,'weight',trim_scale(peso)::text,
   'effectiveWeight',trim_scale(peso_efetivo)::text,'ratio',calculo->>'ratio','points',trim_scale(pontos)::text) order by codigo))
 into v_result from items;
 return v_result;
end;$$;

-- From 20261019091000_academic_access.sql. On model 3, CAM cycle capabilities
-- gather the positions of every set indicator where the actor holds a CAM
-- context in the competence. Everything else is unchanged.
create or replace function private.require_academic_context(p_contexto jsonb,p_capability text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 v_link uuid; v_competence uuid; v_indicator uuid; v_context record;
 v_scope_ids jsonb; v_position_ids jsonb; v_all_indicators boolean;
begin
 if auth.uid() is null or jsonb_typeof(p_contexto) is distinct from 'object'
  or not (p_contexto ?& array['vinculoId','competenciaId','indicadorId'])
  or (select count(*) from jsonb_object_keys(p_contexto))<>3 then
  raise exception using errcode='42501',message='access_denied';
 end if;
 begin
  v_link:=(p_contexto->>'vinculoId')::uuid;
  v_competence:=(p_contexto->>'competenciaId')::uuid;
  v_indicator:=(p_contexto->>'indicadorId')::uuid;
 exception when invalid_text_representation then
  raise exception using errcode='42501',message='access_denied';
 end;
 select r.* into v_context from private.authorized_context_rows() r
 where r.vinculo_id=v_link and r.competencia_id=v_competence and r.indicador_id=v_indicator and r.mode='academic';
 if not found or not private.academic_capability_allowed(v_context.papel,p_capability) then
  raise exception using errcode='42501',message='access_denied';
 end if;
 v_all_indicators:=v_context.modelo=3 and v_context.papel='cam' and p_capability in ('cycle_read','cycle_transition','cycle_publish','export');

 select coalesce(jsonb_agg(distinct p.alvo_id),'[]'::jsonb),coalesce(jsonb_agg(p.id order by p.id),'[]'::jsonb)
 into v_scope_ids,v_position_ids from public.posicoes_esperadas p
 join public.escopos s on s.id=p.alvo_id
 where p.competencia_id=v_competence and (p.indicador_id=v_indicator or v_all_indicators)
  and (
   (v_context.papel='area_tecnica' and p.alvo_id=v_context.escopo_id and p.informante_id=auth.uid())
   or (v_context.papel='revisor_tecnico' and p.alvo_id=v_context.escopo_id and p.revisor_id=auth.uid() and p.informante_id<>auth.uid())
   or (v_context.papel='cam' and (
    (p.alvo_id=v_context.escopo_id and p.indicador_id=v_indicator) or (p_capability in ('cycle_read','cycle_transition','cycle_publish','export') and exists(
     select 1 from private.authorized_context_rows() r where r.mode='academic' and r.papel='cam'
      and r.competencia_id=v_competence and r.indicador_id=p.indicador_id and r.escopo_id=p.alvo_id))))
   or (v_context.papel='gestor_unidade' and p.alvo_id=v_context.escopo_id)
   or (v_context.papel='gestor_distrital' and (p.alvo_id=v_context.escopo_id or (s.tipo='unidade' and exists(
    select 1 from public.territorios_competencia t where t.competencia_id=v_competence
     and t.distrito_id=v_context.escopo_id and t.unidade_id=p.alvo_id))))
   or (v_context.papel='lideranca' and s.tipo='unidade' and exists(select 1 from public.territorios_competencia t
    where t.competencia_id=v_competence and t.distrito_id=v_context.escopo_id and t.unidade_id=p.alvo_id))
  );
 return jsonb_build_object('actorId',auth.uid(),'role',v_context.papel,'vinculoId',v_link,
  'competenciaId',v_competence,'indicadorId',v_indicator,'escopoId',v_context.escopo_id,
  'scopeIds',v_scope_ids,'positionIds',v_position_ids);
end;
$$;

-- From 20261019101000_academic_closure.sql (return type gains "ready"). Model 3
-- reads every position of the context, uses private.situacao_posicao and
-- checks the stored memory against private.calcular_pontos.
drop function private.cycle_positions(jsonb);
create function private.cycle_positions(p_context jsonb)
returns table(position_id uuid,applicable boolean,received boolean,reviewed boolean,unavailable boolean,decided boolean,problem text,ready boolean)
language sql stable set search_path='' as $$
 select p.id,p.aplicavel,
  p.aplicavel and v.enviada_em is not null and e.estado<>'rascunho',
  case when c.modelo=3 then p.aplicavel and x.st in ('valor','indisponivel','nao_aplicavel','decisao_pendente')
   else p.aplicavel and e.estado='validada' and exists(select 1 from public.decisoes_entrada d where d.revisao_id=v.id and d.tipo='validar' and d.ator_id<>v.autor_id) end,
  case when c.modelo=3 then p.aplicavel and v.enviada_em is not null and v.estado_dado in ('indisponivel','nao_aplicavel')
   else p.aplicavel and v.enviada_em is not null and v.estado_dado='indisponivel' end,
  case when c.modelo=3 then p.aplicavel and x.st in ('indisponivel','nao_aplicavel')
   else p.aplicavel and v.estado_dado='indisponivel' and exists(select 1 from public.decisoes_entrada d where d.revisao_id=v.id and d.tipo='decidir_indisponibilidade' and private.trim_academic_text(d.referencia)<>'' and private.trim_academic_text(d.motivo)<>'') end,
  case when c.modelo=3 then case
    when rule.id is null or rule.metodo<>'meta_peso' or i.regra_id is null or s.tipo is null or s.tipo not in ('unidade','distrito') then 'rule_inconsistent'
    when s.tipo='unidade' and not exists(select 1 from public.territorios_competencia t join public.escopos district on district.id=t.distrito_id and district.tipo='distrito' where t.competencia_id=p.competencia_id and t.unidade_id=p.alvo_id) then 'territory_missing'
    when not p.aplicavel then null
    when x.st='sem_envio' then 'missing_submission'
    when x.st='em_conferencia' then 'review_pending'
    when x.st='decisao_pendente' or (x.st<>'valor' and r.id is not null) then 'unavailability_pending'
    when x.st='valor' and (r.id is null or r.regra_id<>p.regra_id or r.entrada_id<>e.id or r.valor<>(x.memoria->>'points')::numeric or r.memoria is distinct from x.memoria) then 'rule_inconsistent'
    else null end
  else case
   when rule.id is null or rule.fator<=0 or rule.fator>1 or s.tipo is null or s.tipo not in ('unidade','distrito') then 'rule_inconsistent'
   when s.tipo='unidade' and not exists(select 1 from public.territorios_competencia t join public.escopos district on district.id=t.distrito_id and district.tipo='distrito' where t.competencia_id=p.competencia_id and t.unidade_id=p.alvo_id) then 'territory_missing'
   when not p.aplicavel then null
   when e.id is null or v.id is null or v.enviada_em is null or e.estado in ('rascunho','devolvida') then 'missing_submission'
   when e.estado<>'validada' or not exists(select 1 from public.decisoes_entrada d where d.revisao_id=v.id and d.tipo='validar' and d.ator_id<>v.autor_id) then 'review_pending'
   when v.estado_dado='indisponivel' and (r.id is not null or not exists(select 1 from public.decisoes_entrada d where d.revisao_id=v.id and d.tipo='decidir_indisponibilidade' and private.trim_academic_text(d.referencia)<>'' and private.trim_academic_text(d.motivo)<>'')) then 'unavailability_pending'
   when v.estado_dado='valor' and (r.id is null or r.regra_id<>p.regra_id or r.entrada_id<>e.id or v.valor is null or r.valor<>v.valor*rule.fator or r.memoria is distinct from jsonb_build_object('synthetic',true,'revisionId',v.id,'ruleId',rule.id,'ruleVersion',rule.versao,'factor',trim_scale(rule.fator)::text,'inputValue',trim_scale(v.valor)::text,'resultValue',trim_scale(r.valor)::text)) then 'memory_inconsistent'
   else null end end,
  case when c.modelo=3 then x.st in ('valor','indisponivel','nao_aplicavel') end
 from public.posicoes_esperadas p
 join public.competencias c on c.id=p.competencia_id
 join public.escopos s on s.id=p.alvo_id
 left join public.regras rule on rule.id=p.regra_id and rule.indicador_id=p.indicador_id
 left join public.entradas e on e.posicao_id=p.id and e.competencia_id=p.competencia_id and e.indicador_id=p.indicador_id and e.escopo_id=p.alvo_id
 left join public.revisoes_entrada v on v.id=e.revisao_atual_id and v.entrada_id=e.id
 left join public.resultados r on r.revisao_id=v.id
 left join public.itens_conjunto i on c.modelo=3 and i.conjunto_id=c.conjunto_id and i.indicador_id=p.indicador_id and i.regra_id=p.regra_id
 left join public.conjuntos_regra cs on cs.id=c.conjunto_id
 -- Submission memory: scoring output with the item weight plus revision and set.
 cross join lateral (select y.st,case when y.st='valor' and i.regra_id is not null and rule.metodo='meta_peso' then private.calcular_pontos(rule,i.peso,v.valor)||jsonb_build_object('revisionId',v.id,
   'ruleSetId',cs.id,'ruleSetVersion',cs.versao,'mode',cs.modo_ausencia,'effectiveWeight',trim_scale(i.peso)::text) end memoria
  from (select case when c.modelo=3 then private.situacao_posicao(p.id) end st) y) x
 where p.competencia_id=(p_context->>'competenciaId')::uuid and (c.modelo=3 or p.indicador_id=(p_context->>'indicadorId')::uuid) and p_context->'positionIds' ? p.id::text;
$$;

-- From 20261019101000_academic_closure.sql. Model 3 also returns "ready".
create or replace function private.cycle_checklist(p_context jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare c public.competencias%rowtype; f public.fechamentos%rowtype; pub public.publicacoes%rowtype;
 total integer;expected integer;received integer;reviewed integer;unavailable integer;decided integer;na integer;full_coverage boolean;blockers jsonb;problems integer;missing integer;ready integer;
begin
 select * into c from public.competencias where id=(p_context->>'competenciaId')::uuid;
 select count(*) into total from public.posicoes_esperadas where competencia_id=c.id;
 select count(*),count(*)filter(where x.received),count(*)filter(where x.reviewed),count(*)filter(where x.unavailable),count(*)filter(where x.decided),count(*)filter(where not x.applicable),count(*)filter(where x.problem is not null),count(*)filter(where x.applicable and (not coalesce(x.received,false) or x.problem='missing_submission')),count(*)filter(where x.ready) into expected,received,reviewed,unavailable,decided,na,problems,missing,ready from private.cycle_positions(p_context)x;
 full_coverage:=total>0 and expected=total;
 select coalesce(jsonb_agg(jsonb_build_object('positionId',position_id,'code',problem,'message',case problem when 'missing_submission' then 'Envio ausente, rascunho ou devolução pendente.' when 'review_pending' then 'Conferência técnica pendente.' when 'unavailability_pending' then 'Indisponibilidade sem decisão CAM ou com número indevido.' when 'memory_inconsistent' then 'Memória de cálculo inconsistente.' when 'territory_missing' then 'Relação territorial congelada ausente.' else 'Regra ou alvo inconsistente.' end) order by position_id),'[]'::jsonb) into blockers from private.cycle_positions(p_context) where problem is not null;
 if not full_coverage then blockers:=jsonb_build_array(jsonb_build_object('positionId',null,'code','coverage_incomplete','message','Ação global exige cobertura CAM explícita de todo o ciclo.'))||blockers;end if;
 if full_coverage then
  select * into f from public.fechamentos where competencia_id=c.id;
  select * into pub from public.publicacoes where fechamento_id=f.id;
 end if;
 return jsonb_build_object('version',c.lock_version,'state',c.estado,'expected',expected,'received',received,'reviewed',reviewed,'unavailable',unavailable,'decidedUnavailable',decided,'notApplicable',na,'fullCoverage',full_coverage,
  'canConsolidate',full_coverage and c.estado='aberta' and missing=0,'canClose',full_coverage and c.estado='em_consolidacao' and problems=0,
  'snapshotId',f.id,'publication',case when pub.id is not null then 'publicada_demo' else 'nao_publicada' end,'publicationId',pub.id,'blockers',blockers)
  ||case when c.modelo=3 then jsonb_build_object('ready',ready) else '{}'::jsonb end;
end;$$;

-- From 20261019101000_academic_closure.sql. Closing a model-3 competence also
-- freezes each item's calculation and one score per unit from
-- private.pontuacao_unidade, with the set, its version and absence mode.
create or replace function private.transition_academic_cycle(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctx jsonb;c public.competencias%rowtype;f public.fechamentos%rowtype;pub public.publicacoes%rowtype;old_op public.operacoes_dominio%rowtype;
 expected integer;action text;reason text;reference text;sid uuid;canonical jsonb;response jsonb;checklist jsonb;capability text;scores jsonb;
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
   -- One unit score per target, computed once under the cycle locks above.
   if c.modelo=3 then
    select jsonb_object_agg(u.alvo_id,private.pontuacao_unidade(c.id,u.alvo_id)) into scores
    from (select distinct alvo_id from public.posicoes_esperadas where competencia_id=c.id) u;
   end if;
   insert into public.fechamentos(competencia_id,referencia_demo,ator_id) values(c.id,reference,auth.uid()) returning * into f;
   insert into public.itens_fechamento(fechamento_id,posicao_id,alvo_id,revisao_id,regra_id,alvo_codigo,alvo_tipo,regra_versao,revisao_numero,estado_dado,valor_entrada,fator,valor_resultado,memoria,distrito_id,distrito_codigo,
    metodo,meta,direcao,peso,peso_efetivo,razao,pontos,conjunto_id,conjunto_versao,modo_ausencia)
   select f.id,p.id,p.alvo_id,case when p.aplicavel then v.id end,p.regra_id,s.codigo,s.tipo,rule.versao,case when p.aplicavel then v.numero end,
    case when not p.aplicavel then 'nao_aplicavel' else v.estado_dado end,
    case when p.aplicavel and v.estado_dado='valor' then v.valor end,case when p.aplicavel and v.estado_dado='valor' then rule.fator end,
    case when p.aplicavel and v.estado_dado='valor' then r.valor end,
    case when p.aplicavel and v.estado_dado='valor' then r.memoria else '{}'::jsonb end,t.distrito_id,district.codigo,
    case when cs.id is not null then rule.metodo end,case when cs.id is not null then rule.meta end,case when cs.id is not null then rule.direcao end,
    (it.item->>'weight')::numeric,(it.item->>'effectiveWeight')::numeric,(it.item->>'ratio')::numeric,(it.item->>'points')::numeric,cs.id,cs.versao,cs.modo_ausencia
   from public.posicoes_esperadas p join public.escopos s on s.id=p.alvo_id join public.regras rule on rule.id=p.regra_id and rule.indicador_id=p.indicador_id
   left join public.entradas e on e.posicao_id=p.id and e.competencia_id=p.competencia_id and e.indicador_id=p.indicador_id and e.escopo_id=p.alvo_id
   left join public.revisoes_entrada v on v.id=e.revisao_atual_id and v.entrada_id=e.id left join public.resultados r on r.revisao_id=v.id and r.entrada_id=e.id and r.regra_id=rule.id
   left join public.territorios_competencia t on t.competencia_id=p.competencia_id and t.unidade_id=p.alvo_id and s.tipo='unidade' left join public.escopos district on district.id=t.distrito_id
   left join public.conjuntos_regra cs on c.modelo=3 and cs.id=c.conjunto_id
   left join lateral (select i item from jsonb_array_elements(scores->(p.alvo_id::text)->'items') i where i->>'indicatorId'=p.indicador_id::text) it on true
   where p.competencia_id=c.id;
   if c.modelo=3 then
    insert into public.pontuacoes_fechamento(fechamento_id,alvo_id,alvo_codigo,distrito_id,pontos,completo,sem_base,conjunto_id,conjunto_versao)
    select f.id,s.id,s.codigo,t.distrito_id,(u.value->>'points')::numeric,(u.value->>'complete')::boolean,(u.value->>'noBase')::boolean,cs.id,cs.versao
    from jsonb_each(scores) u join public.escopos s on s.id=u.key::uuid join public.conjuntos_regra cs on cs.id=c.conjunto_id
    left join public.territorios_competencia t on t.competencia_id=c.id and t.unidade_id=s.id and s.tipo='unidade';
   end if;
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

revoke all on function private.situacao_posicao(uuid),private.cycle_positions(jsonb) from public,anon,authenticated,service_role;

commit;
