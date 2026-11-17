import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import type { ContextGroup } from '../pilot/types';
import { toCommandContext } from '../context/contextApi';
import type { RuleCatalog } from '../results/resultsApi';
import { formatDecimal, sumDecimals } from '../pilot/decimal';
import { competenceLabel, competenceStateLabels, plural, stateTones } from '../workspace/displayNames';
import { ActivityFeed, StageTiles, TodoList, UnitCard } from '../workspace/v4Parts';
import { businessLinks, loadRuleCatalog } from './adminApi';
import { useAdminCatalog } from './useAdminCatalog';

// Model-3 administrator painel: counts and names only, never a value or a score.
export function AdminSummary({ client, group, onNavigate, onOpenHistory }: { client: SupabaseClient; group: ContextGroup; onNavigate: (destination: string) => void; onOpenHistory: () => void }) {
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
  // Count what "Usuários e vínculos" lists.
  const links = catalog ? businessLinks(catalog, context.actorId) : [];
  const active = links.filter(link => link.ativo).length;
  const inactive = links.length - active;
  const units = catalog?.scopes.filter(scope => scope.ativo && scope.tipo === 'unidade').length;
  const districts = catalog?.scopes.filter(scope => scope.ativo && scope.tipo === 'distrito').length;
  const ruleName = set && `${set.code}-v${set.version}`;
    return <>
    <StageTiles label="Resumo dos cadastros" tiles={[
      { label: 'Vínculos ativos', value: catalog ? active : '–', sub: catalog ? `de ${plural(links.length, 'cadastrado', 'cadastrados')}` : error ? 'Indisponível' : 'Carregando vínculos…', tone: 'ok' },
      { label: 'Regra em uso', value: ruleName ?? '–', text: true, tone: 'info',
        sub: set ? `${plural(set.items.length, 'indicador', 'indicadores')} · pesos somam ${formatDecimal(sumDecimals(set.items.map(item => item.weight)))}` : rulesError ? 'Indisponível' : rules ? 'Nenhuma regra em uso.' : 'Carregando catálogo…' },
      { label: 'Competência', value: context.competenciaEstado ? competenceStateLabels[context.competenciaEstado] : '–', text: true, tone: context.competenciaEstado && stateTones[context.competenciaEstado], sub: competenceLabel(group.competenciaCodigo) },
      { label: 'Unidades', value: units ?? '–', sub: districts === undefined ? (error ? 'Indisponível' : 'Carregando…') : `em ${plural(districts, 'distrito', 'distritos')}` }]} />
    {error && <p role="alert">{error}</p>}
    {rulesError && <p role="alert">Não foi possível confirmar o catálogo de regras.</p>}
    <div className="dash"><div className="stack">
      {catalog && <TodoList title="Para fazer" empty={<strong>Nada pendente nos cadastros.</strong>}
        items={inactive ? [{ tone: 'warn', title: `Revisar ${plural(inactive, 'vínculo inativo', 'vínculos inativos')}`, sub: 'Confira se continuam sem acesso.',
          action: { label: 'Ver vínculos', ariaLabel: 'Ver vínculos inativos', onClick: () => onNavigate('vinculos') } }] : []} />}
      <section className="block" aria-labelledby="admin-cadastros"><div className="block-head"><h3 id="admin-cadastros">Cadastros</h3></div><div className="cards">
        <UnitCard title="Indicadores e regras" sub="Catálogo, metas, pesos e vigência por competência." big={ruleName ?? '–'}
          action={{ label: 'Abrir indicadores e regras', onClick: () => onNavigate('regras') }} />
        <UnitCard title="Usuários e vínculos" sub="Quem acessa qual papel, em qual escopo." big={catalog ? active : '–'}
          foot="vínculos ativos" action={{ label: 'Abrir usuários e vínculos', onClick: () => onNavigate('vinculos') }} />
      </div></section>
    </div>
    <ActivityFeed client={client} group={group} onOpenHistory={onOpenHistory} /></div>
  </>;
}
