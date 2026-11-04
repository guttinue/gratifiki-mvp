import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import type { ContextGroup } from '../pilot/types';
import { toCommandContext } from '../context/contextApi';
import type { RuleCatalog } from '../results/resultsApi';
import { competenceLabel, competenceStateLabels } from '../workspace/displayNames';
import { loadRuleCatalog } from './adminApi';
import { useAdminCatalog } from './useAdminCatalog';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Model-3 administrator painel: counts and names only, never a value or a score.
export function AdminSummary({ client, group, onNavigate }: { client: SupabaseClient; group: ContextGroup; onNavigate: (destination: string) => void }) {
  const context = group.contexts[0];
  const { catalog, error } = useAdminCatalog(client, context);
  const [rules, setRules] = useState<RuleCatalog | null>(null);
  const [rulesError, setRulesError] = useState(false);
  useEffect(() => {
    let current = true;
    setRules(null); setRulesError(false);
    void loadRuleCatalog(client, toCommandContext(context)).then(value => { if (current) setRules(value); }).catch(() => { if (current) setRulesError(true); });
    return () => { current = false; };
  }, [client, context]);
  const set = rules?.ruleSets.find(candidate => candidate.inUse);
  return <>
    <section aria-label="Resumo dos cadastros" className="v3-metrics">
      <div className="v3-metric v3-metric-lead"><span className="v3-label">Vínculos ativos</span>
        {error ? <p role="alert">{error}</p> : !catalog ? <span role="status">Carregando vínculos…</span> : <>
          <strong className="v3-value">{catalog.links.filter(link => link.ativo).length}</strong><span className="v3-sub">{`de ${count(catalog.links.length, 'cadastrado', 'cadastrados')}`}</span></>}</div>
      <div className="v3-metric"><span className="v3-label">Regra em uso</span>
        {rulesError ? <p role="alert">Não foi possível confirmar o catálogo de regras.</p> : !rules ? <span role="status">Carregando catálogo…</span>
          : !set ? <span className="v3-sub">Nenhuma regra em uso.</span> : <>
          <strong className="v3-value">{`${set.code}-v${set.version}`}</strong><span className="v3-sub">{count(set.items.length, 'indicador', 'indicadores')}</span></>}</div>
      <div className="v3-metric"><span className="v3-label">Competência</span>
        <strong className="v3-value">{context.competenciaEstado ? competenceStateLabels[context.competenciaEstado] : '–'}</strong><span className="v3-sub">{competenceLabel(group.competenciaCodigo)}</span></div>
    </section>
    <div className="v3-metrics">
      <section aria-labelledby="admin-rules" className="v3-panel"><h3 id="admin-rules">Indicadores e regras</h3><p>Catálogo, metas, pesos e vigência por competência.</p>
        <button type="button" onClick={() => onNavigate('regras')}>Abrir indicadores e regras</button></section>
      <section aria-labelledby="admin-links" className="v3-panel"><h3 id="admin-links">Usuários e vínculos</h3><p>Quem acessa qual papel, em qual escopo.</p>
        <button type="button" onClick={() => onNavigate('vinculos')}>Abrir usuários e vínculos</button></section>
    </div>
  </>;
}
