import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import type { ContextGroup } from '../pilot/types';
import { formatDecimal, sumDecimals } from '../pilot/decimal';
import { toCommandContext } from '../context/contextApi';
import { directionSymbol } from '../results/CalculationExplainer';
import type { RuleCatalog, RuleSetItem } from '../results/resultsApi';
import { loadRuleCatalog } from './adminApi';

const measure = (unit: string | null) => unit === '%' ? 'Percentual' : unit === 'h' ? 'Horas' : 'Contagem';
const formula = (direction: RuleSetItem['direction']) => direction === 'maior_melhor' ? 'min(valor ÷ meta; 1) × peso' : 'min(meta ÷ valor; 1) × peso';
const date = (iso: string) => iso.split('-').reverse().join('/');

// Read only by design: rule sets of model 3 are created by migration or seed,
// never from the screen.
export function RuleCatalogPage({ client, group }: { client: SupabaseClient; group: ContextGroup }) {
  const [catalog, setCatalog] = useState<RuleCatalog | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setCatalog(null); setError(false);
    void loadRuleCatalog(client, toCommandContext(group.contexts[0])).then(value => { if (current) setCatalog(value); }).catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [client, group, retry]);
  return <section aria-label="Indicadores e regras" className="v3-page">
    <p>Catálogo da regra fictícia. Uma regra em uso não muda; mudanças valem só para competências futuras e entram por migração ou carga de dados.</p>
    {error ? <p role="alert">Não foi possível confirmar o catálogo de regras.</p>
      : !catalog ? <p role="status">Carregando catálogo…</p>
      : !catalog.ruleSets.length ? <p>Nenhuma regra cadastrada.</p>
      : catalog.ruleSets.map(set => {
        const name = `${set.code}-v${set.version}`;
        return <section key={set.id} className="v3-panel" aria-label={`Regra ${name}`}>
          <header><div><h3>{name}</h3><p className="v3-cell-sub">{`Vigência a partir de ${date(set.validFrom)} · ${set.reference}`}</p></div>
            <span className={`v3-badge ${set.inUse ? 'v3-badge-valor' : 'v3-badge-sem_envio'}`}>{set.inUse ? 'Regra em uso · bloqueada' : 'Disponível · ainda não usada'}</span></header>
          <div className="table-scroll"><table className="v3-table" aria-label={`Indicadores da regra ${name}`}>
            <thead><tr><th scope="col">Indicador</th><th scope="col">Unidade de medida</th><th scope="col">Meta</th><th scope="col" className="r">Peso</th><th scope="col">Cálculo</th></tr></thead>
            <tbody>{set.items.map(item => <tr key={item.indicatorCode}>
              <td><strong>{item.indicatorCode}</strong><span className="v3-cell-sub">{item.name}</span></td>
              <td>{measure(item.unit)}</td>
              <td>{`${directionSymbol(item.direction)} ${formatDecimal(item.meta)}${item.unit ? ` ${item.unit}` : ''}`}</td>
              <td className="r">{formatDecimal(item.weight)}</td>
              <td>{formula(item.direction)}</td></tr>)}</tbody></table></div>
          <p className="v3-note">{`Pesos somam ${formatDecimal(sumDecimals(set.items.map(item => item.weight)))}`}</p>
          <p className="v3-note">{`${set.mode === 'zero' ? 'Modo de ausência: ausências valem zero.' : 'Modo de ausência: pesos redistribuídos entre os indicadores aceitos.'} Arredondamento: centésimos, metade para cima.${set.synthetic ? ' Dados e regra sintéticos.' : ''}`}</p>
        </section>;
      })}
    <button type="button" onClick={() => setRetry(n => n + 1)}>Atualizar catálogo</button>
  </section>;
}
