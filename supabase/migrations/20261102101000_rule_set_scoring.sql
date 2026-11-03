begin;

-- Points of one indicator. Model-2 functions keep their own value × factor
-- arithmetic; the factor branch exists only for completeness.
create function private.calcular_pontos(p_regra public.regras,p_peso numeric,p_valor numeric) returns jsonb
language plpgsql immutable set search_path='' as $$
declare v_ratio numeric;v_exact numeric;v_points numeric;v_expression text;
begin
 if p_regra.id is null or p_valor is null or p_valor<0 then raise exception using errcode='22023',message='invalid_input';end if;
 if p_regra.metodo='fator' then return jsonb_build_object('resultValue',trim_scale(p_valor*p_regra.fator)::text);end if;
 if p_peso is null or p_peso<=0 then raise exception using errcode='22023',message='invalid_input';end if;
 v_ratio:=round(case when p_regra.direcao='maior_melhor' then least(p_valor/p_regra.meta,1) when p_valor=0 then 1 else least(p_regra.meta/p_valor,1) end,10);
 v_exact:=v_ratio*p_peso;
 v_points:=round(v_exact,2);
 v_expression:=case
  when p_regra.direcao='menor_melhor' and p_valor=0 then format('valor zero no indicador descendente = peso integral (%s)',replace(trim_scale(p_peso)::text,'.',','))
  when p_regra.direcao='maior_melhor' then format('min(%s ÷ %s; 1) × %s',replace(trim_scale(p_valor)::text,'.',','),replace(trim_scale(p_regra.meta)::text,'.',','),replace(trim_scale(p_peso)::text,'.',','))
  else format('min(%s ÷ %s; 1) × %s',replace(trim_scale(p_regra.meta)::text,'.',','),replace(trim_scale(p_valor)::text,'.',','),replace(trim_scale(p_peso)::text,'.',',')) end;
 return jsonb_build_object('synthetic',true,'method','meta_peso','ruleId',p_regra.id,'ruleVersion',p_regra.versao,
  'meta',trim_scale(p_regra.meta)::text,'direction',p_regra.direcao,'weight',trim_scale(p_peso)::text,'inputValue',trim_scale(p_valor)::text,
  'ratio',trim_scale(v_ratio)::text,'points',trim_scale(v_points)::text,'exactPoints',trim_scale(v_exact)::text,'expression',v_expression);
end;$$;

-- Unit score over 100 for a model-3 competence. An item counts only with an
-- accepted current revision; states without value also need the CAM decision.
-- A position marked not applicable is a decided nao_aplicavel.
create function private.pontuacao_unidade(p_competencia_id uuid,p_alvo_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare v_mode text;v_result jsonb;
begin
 select s.modo_ausencia into v_mode from public.competencias c join public.conjuntos_regra s on s.id=c.conjunto_id where c.id=p_competencia_id and c.modelo=3;
 if v_mode is null then raise exception using errcode='22023',message='invalid_input';end if;
 with base as (
  select i.indicador_id,ind.codigo,i.peso,r as regra,v.valor,
   case when p.id is null then 'pendente'
    when not p.aplicavel then 'nao_aplicavel'
    when e.estado<>'validada' or v.enviada_em is null then 'pendente'
    when v.estado_dado='valor' then 'valor'
    when exists(select 1 from public.decisoes_entrada d where d.revisao_id=v.id and d.tipo='decidir_indisponibilidade') then v.estado_dado
    else 'pendente' end estado
  from public.competencias c
  join public.itens_conjunto i on i.conjunto_id=c.conjunto_id
  join public.indicadores ind on ind.id=i.indicador_id
  join public.regras r on r.id=i.regra_id and r.indicador_id=i.indicador_id
  left join public.posicoes_esperadas p on p.competencia_id=c.id and p.indicador_id=i.indicador_id and p.alvo_id=p_alvo_id
  left join public.entradas e on e.posicao_id=p.id
  left join public.revisoes_entrada v on v.id=e.revisao_atual_id and v.entrada_id=e.id
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

-- R-9: model-3 positions are allowed, pinned to the rule of their set item.
-- Entry, revision and result branches are unchanged.
create or replace function private.guard_academic_model() returns trigger language plpgsql set search_path='' as $$
declare v_modelo integer; v_posicao uuid; v_conjunto uuid;
begin
 if tg_table_name='posicoes_esperadas' then
  select modelo,conjunto_id into v_modelo,v_conjunto from public.competencias where id=new.competencia_id;
  if v_modelo not in (2,3) then raise exception using errcode='23514',message='academic_position_requires_academic_competence'; end if;
  if v_modelo=3 and not exists(select 1 from public.itens_conjunto i where i.conjunto_id=v_conjunto and i.indicador_id=new.indicador_id and i.regra_id=new.regra_id) then
   raise exception using errcode='23514',message='academic_position_rule_outside_rule_set';
  end if;
 elsif tg_table_name='entradas' then
  select modelo into v_modelo from public.competencias where id=new.competencia_id;
  if (v_modelo=1)<>(new.posicao_id is null) then raise exception using errcode='23514',message='entry_model_mismatch'; end if;
 elsif tg_table_name='revisoes_entrada' then
  select posicao_id into v_posicao from public.entradas where id=new.entrada_id;
  if v_posicao is null then raise exception using errcode='23514',message='revision_requires_academic_entry'; end if;
 elsif tg_table_name='resultados' then
  select posicao_id into v_posicao from public.entradas where id=new.entrada_id;
  if (v_posicao is null)<>(new.revisao_id is null) then raise exception using errcode='23514',message='result_model_mismatch'; end if;
 end if;
 return new;
end;
$$;

-- R-8: a rule inside a set that a competence references is frozen like the
-- set itself. The existing checks and their message are unchanged.
create or replace function private.guard_used_rule() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.itens_conjunto i join public.competencias c on c.conjunto_id=i.conjunto_id where i.regra_id=old.id) then
  raise exception using errcode='55000',message='immutable_record';
 end if;
 if exists(select 1 from public.resultados where regra_id=old.id) or exists(select 1 from public.posicoes_esperadas where regra_id=old.id)
  or exists(select 1 from public.ativacoes_regra where regra_id=old.id) then
  raise exception using errcode='55000',message='used_rule_is_immutable';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;

revoke all on function private.calcular_pontos(public.regras,numeric,numeric),private.pontuacao_unidade(uuid,uuid) from public,anon,authenticated,service_role;

commit;
