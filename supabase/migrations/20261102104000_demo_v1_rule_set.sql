begin;

-- DEMO-v1: the fictitious academic rule set of model 3 (synthetic data, no
-- institutional effect). Rules are registered only here, never by a command.
-- The legacy model-2 indicator keeps the code DEMO-01 (seed.sql), so the model-3
-- indicators use DEMO-V1-0N; their V3 names live in regras.nome.
insert into public.indicadores(id,codigo) values
 ('c0de0000-0000-4000-8000-000000000101','DEMO-V1-01'),
 ('c0de0000-0000-4000-8000-000000000102','DEMO-V1-02'),
 ('c0de0000-0000-4000-8000-000000000103','DEMO-V1-03'),
 ('c0de0000-0000-4000-8000-000000000104','DEMO-V1-04');

insert into public.regras(id,indicador_id,versao,metodo,meta,direcao,casas_decimais,valor_maximo,unidade_medida,nome,vigencia_inicio) values
 ('c0de0000-0000-4000-8000-000000000111','c0de0000-0000-4000-8000-000000000101',1,'meta_peso',95,'maior_melhor',2,100,'%','Registros conferidos','2026-09-01'),
 ('c0de0000-0000-4000-8000-000000000112','c0de0000-0000-4000-8000-000000000102',1,'meta_peso',20,'maior_melhor',0,999999,null,'Rotinas concluídas','2026-09-01'),
 ('c0de0000-0000-4000-8000-000000000113','c0de0000-0000-4000-8000-000000000103',1,'meta_peso',48,'menor_melhor',2,8760,'h','Tempo de resposta','2026-09-01'),
 ('c0de0000-0000-4000-8000-000000000114','c0de0000-0000-4000-8000-000000000104',1,'meta_peso',12,'maior_melhor',0,999999,null,'Verificações realizadas','2026-09-01');

-- The deferred total check (weights sum to 100) runs at commit.
insert into public.conjuntos_regra(id,codigo,versao,modo_ausencia,sintetico,vigencia_inicio,referencia) values
 ('c0de0000-0000-4000-8000-000000000100','DEMO',1,'zero',true,'2026-09-01','DEMO-v1 · regra fictícia acadêmica');
insert into public.itens_conjunto(conjunto_id,indicador_id,regra_id,peso) values
 ('c0de0000-0000-4000-8000-000000000100','c0de0000-0000-4000-8000-000000000101','c0de0000-0000-4000-8000-000000000111',30),
 ('c0de0000-0000-4000-8000-000000000100','c0de0000-0000-4000-8000-000000000102','c0de0000-0000-4000-8000-000000000112',25),
 ('c0de0000-0000-4000-8000-000000000100','c0de0000-0000-4000-8000-000000000103','c0de0000-0000-4000-8000-000000000113',25),
 ('c0de0000-0000-4000-8000-000000000100','c0de0000-0000-4000-8000-000000000104','c0de0000-0000-4000-8000-000000000114',20);

-- The first persistent meta/weight rules would leak into the model-1 pilot:
-- legacy links (no indicator) reach every indicator with a rule valid at the
-- model-1 reference, and the pilot reads rules directly. Both paths now only
-- consider factor rules. Administrator links (no position check) would also
-- cross models: a DEMO-v1 link reached model-2 months and the legacy link
-- reached model-3 months. Everything else is restated unchanged.
-- From 20261102102000_model3_commands.sql.
create or replace function private.authorized_context_rows()
returns table(vinculo_id uuid,actor_id uuid,papel text,competencia_id uuid,indicador_id uuid,
 escopo_id uuid,escopo_codigo text,competencia_codigo text,mode text,modelo integer)
language sql stable security definer set search_path='' as $$
 select v.id,v.actor_id,v.papel,c.id,i.id,s.id,s.codigo,c.codigo,
  case when c.modelo=1 then 'legacy' else 'academic' end,c.modelo
 from public.vinculos v
 join public.escopos s on s.id=v.escopo_id
 cross join public.competencias c
 join public.indicadores i on (v.indicador_id=i.id or v.indicador_id is null)
 where auth.uid() is not null and v.actor_id=auth.uid() and v.ativo
  and (v.vigencia_inicio is null or v.vigencia_inicio<=current_date)
  and (v.vigencia_fim is null or v.vigencia_fim>=current_date)
  and (
   (c.modelo=1 and v.indicador_id is null and s.tipo is null and v.papel in ('area_tecnica','cam')
    and exists(select 1 from public.regras r where r.indicador_id=i.id and r.metodo='fator' and not exists(select 1 from public.ativacoes_regra a where a.regra_id=r.id) and c.referencia>=r.vigencia_inicio
     and (r.vigencia_fim is null or c.referencia<=r.vigencia_fim)))
   or
   (c.modelo in (2,3) and v.indicador_id=i.id and v.vigencia_inicio is not null
    and exists(select 1 from public.contas_demo a where a.ator_id=auth.uid() and a.ativo)
    and (
     -- An administrator link reaches only competences that use its indicator:
     -- model 3 through the set items, model 2 for indicators outside any set.
     (v.papel='administrador' and case when c.modelo=3
       then exists(select 1 from public.itens_conjunto it where it.conjunto_id=c.conjunto_id and it.indicador_id=i.id)
       else not exists(select 1 from public.itens_conjunto it where it.indicador_id=i.id) end)
     or (v.papel in ('area_tecnica','revisor_tecnico','cam','gestor_unidade')
      and (v.papel<>'gestor_unidade' or s.tipo='unidade')
      and exists(select 1 from public.posicoes_esperadas p where p.competencia_id=c.id and p.indicador_id=i.id and p.alvo_id=s.id
       and (v.papel<>'area_tecnica' or p.informante_id=auth.uid())
       and (v.papel<>'revisor_tecnico' or (p.revisor_id=auth.uid() and p.informante_id<>auth.uid()))))
     or (v.papel in ('gestor_distrital','lideranca') and s.tipo='distrito'
      and exists(select 1 from public.posicoes_esperadas p where p.competencia_id=c.id and p.indicador_id=i.id
       and ((v.papel='gestor_distrital' and p.alvo_id=s.id) or exists(select 1 from public.territorios_competencia t
        join public.escopos unit_scope on unit_scope.id=t.unidade_id and unit_scope.tipo='unidade'
        where t.competencia_id=c.id and t.distrito_id=s.id and t.unidade_id=p.alvo_id))))
    ))
  );
$$;
revoke all on function private.authorized_context_rows() from public,anon,authenticated,service_role;

-- From 20261019105000_academic_configuration.sql. The legacy pilot reads rules
-- directly (RLS); meta/weight rules are read only through model-3 RPCs.
create or replace function private.legacy_rule_visible(p_rule_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.has_pilot_link(null::text,null::uuid)
 and exists(select 1 from public.regras r where r.id=p_rule_id and r.metodo='fator' and not exists(select 1 from public.ativacoes_regra a where a.regra_id=r.id));
$$;
revoke all on function private.legacy_rule_visible(uuid) from public,anon,service_role;
grant execute on function private.legacy_rule_visible(uuid) to authenticated;

commit;
