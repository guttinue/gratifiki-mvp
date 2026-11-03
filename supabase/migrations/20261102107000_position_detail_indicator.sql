begin;

-- R-28: the reviewer needs to know WHICH indicator a model-3 position is, its
-- target, and last month's accepted value. Read-only; nothing is written.
-- Model-2 payloads gain no key (the model-3 parts are concatenated only when
-- the competence is model 3), so they stay byte-identical.

-- From 20261019092000_expected_positions.sql. Queue rows of a model-3
-- competence also carry the indicator code and name.
create or replace function private.operational_position_rows(p_contexto jsonb)
returns table(id uuid, codigo text, summary jsonb) language plpgsql stable security definer set search_path='' as $$
declare v_context jsonb;
begin
 v_context := private.require_academic_context(p_contexto,'operational_read');
 if v_context->>'role'='cam' then v_context:=private.require_academic_context(p_contexto,'cycle_read'); end if;
 return query select p.id,s.codigo,jsonb_build_object(
  'id',p.id,'escopoId',s.id,'escopoCodigo',s.codigo,'escopoTipo',s.tipo,'aplicavel',p.aplicavel,
  'status',coalesce(e.estado,'ausente'),'estadoDado',case when not p.aplicavel then 'nao_aplicavel' else r.estado_dado end,
  'version',p.lock_version,'revisionId',r.id,'inputValue',trim_scale(r.valor)::text,'resultValue',trim_scale(result.valor)::text)
  ||case when c.modelo=3 then jsonb_build_object('indicatorCode',ind.codigo,'indicatorName',coalesce(rule.nome,ind.codigo)) else '{}'::jsonb end
 from public.posicoes_esperadas p join public.escopos s on s.id=p.alvo_id
 join public.competencias c on c.id=p.competencia_id
 join public.indicadores ind on ind.id=p.indicador_id
 left join public.regras rule on rule.id=p.regra_id
 left join public.entradas e on e.posicao_id=p.id
 left join public.revisoes_entrada r on r.id=e.revisao_atual_id
 left join public.resultados result on result.revisao_id=r.id
 where p.competencia_id=(v_context->>'competenciaId')::uuid and p.indicador_id=(v_context->>'indicadorId')::uuid
  and v_context->'positionIds' ? p.id::text;
end;
$$;

-- From 20261102106000_unit_batch.sql. For a model-3 position the detail adds
-- "indicator" (code, name, target, direction, weight, unit) and "previous":
-- the same unit and indicator in the latest earlier month of the same rule set
-- code, from the frozen snapshot when that month is closed, otherwise from a
-- revision accepted by private.situacao_posicao. Null when there is none.
create or replace function public.get_position_detail(p_contexto jsonb,p_position_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_position jsonb; v_entry uuid; v_revisions jsonb; v_decisions jsonb; v_memories jsonb; v_result jsonb;
 v_current public.posicoes_esperadas%rowtype; v_competence public.competencias%rowtype; v_indicator jsonb; v_previous jsonb;
 v_prev_competence uuid; v_prev_code text; v_prev_position uuid; v_state text; v_value numeric;
begin
 select r.summary into v_position from private.operational_position_rows(p_contexto) r where r.id=p_position_id;
 if v_position is null then raise exception using errcode='42501',message='access_denied'; end if;
 select e.id into v_entry from public.entradas e where e.posicao_id=p_position_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'number',r.numero,'authorId',r.autor_id,
  'estadoDado',r.estado_dado,'value',trim_scale(r.valor)::text,'source',r.origem,'sourcePeriod',r.periodo_fonte,'reason',r.motivo,'submittedAt',r.enviada_em,'correctionExplanation',r.explicacao_correcao) order by r.numero,r.id),'[]'::jsonb)
 into v_revisions from public.revisoes_entrada r where r.entrada_id=v_entry;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'revisionId',d.revisao_id,'actorId',d.ator_id,'type',d.tipo,'reason',d.motivo,'reference',d.referencia,'occurredAt',d.ocorrido_em) order by d.ocorrido_em,d.id),'[]'::jsonb)
 into v_decisions from public.decisoes_entrada d join public.revisoes_entrada r on r.id=d.revisao_id where r.entrada_id=v_entry;
 select coalesce(jsonb_agg(jsonb_build_object('revisionId',r.id,'ruleVersion',rule.versao,'method',rule.metodo,'factor',trim_scale(rule.fator)::text,
  'inputValue',trim_scale(r.valor)::text,'resultValue',trim_scale(result.valor)::text) order by r.numero,r.id),'[]'::jsonb)
 into v_memories from public.resultados result join public.revisoes_entrada r on r.id=result.revisao_id join public.regras rule on rule.id=result.regra_id where r.entrada_id=v_entry;
 v_result:=jsonb_build_object('position',v_position,'revisions',v_revisions,'decisions',v_decisions,'memories',v_memories);

 select * into v_current from public.posicoes_esperadas where id=p_position_id;
 select * into v_competence from public.competencias where id=v_current.competencia_id;
 if v_competence.modelo=3 then
  select jsonb_build_object('code',ind.codigo,'name',coalesce(rule.nome,ind.codigo),'meta',trim_scale(rule.meta)::text,'direction',rule.direcao,
   'weight',trim_scale(it.peso)::text,'unit',rule.unidade_medida)
  into v_indicator from public.indicadores ind join public.regras rule on rule.id=v_current.regra_id
  join public.itens_conjunto it on it.conjunto_id=v_competence.conjunto_id and it.indicador_id=v_current.indicador_id and it.regra_id=v_current.regra_id
  where ind.id=v_current.indicador_id;
  select pc.id,pc.codigo,pp.id into v_prev_competence,v_prev_code,v_prev_position
  from public.competencias pc join public.conjuntos_regra ps on ps.id=pc.conjunto_id
  join public.posicoes_esperadas pp on pp.competencia_id=pc.id and pp.indicador_id=v_current.indicador_id and pp.alvo_id=v_current.alvo_id
  where pc.modelo=3 and pc.referencia<v_competence.referencia and ps.codigo=(select s.codigo from public.conjuntos_regra s where s.id=v_competence.conjunto_id)
  order by pc.referencia desc limit 1;
  if v_prev_position is not null then
   select i.estado_dado,i.valor_entrada into v_state,v_value from public.itens_fechamento i join public.fechamentos f on f.id=i.fechamento_id
   where f.competencia_id=v_prev_competence and i.posicao_id=v_prev_position;
   if not found then
    v_state:=private.situacao_posicao(v_prev_position);
    if v_state='valor' then
     select v.valor into v_value from public.entradas e join public.revisoes_entrada v on v.id=e.revisao_atual_id where e.posicao_id=v_prev_position;
    elsif v_state not in ('indisponivel','nao_aplicavel') then
     v_state:=null;
    end if;
   end if;
   if v_state is not null then
    v_previous:=jsonb_build_object('competencia',v_prev_code,'valor',trim_scale(v_value)::text,'estadoDado',v_state);
   end if;
  end if;
  v_result:=v_result||jsonb_build_object('previous',v_previous);
  if v_indicator is not null then v_result:=v_result||jsonb_build_object('indicator',v_indicator); end if;
 end if;
 return v_result;
end;
$$;

commit;
