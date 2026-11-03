import type { SupabaseClient } from '@supabase/supabase-js';
import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ContextGroup } from '../pilot/types';
import { formatDecimal } from '../pilot/decimal';
import { toCommandContext } from '../context/contextApi';
import { monthName, unitDisplayNames } from '../workspace/displayNames';
import { CalculationExplainer, directionSymbol } from './CalculationExplainer';
import { loadUnitResults, type ReviewStatus, type UnitResult, type UnitResults } from './resultsApi';

const statusLabels: Record<ReviewStatus, string> = { valor: 'Aceita', indisponivel: 'Indisponível', nao_aplicavel: 'Não se aplica',
  sem_envio: 'Não enviada', em_conferencia: 'Em conferência', decisao_pendente: 'Aguardando decisão da CAM' };
const stateLabels: Record<UnitResults['state'], string> = { aberta: 'Aberta', em_consolidacao: 'Em consolidação', fechada: 'Fechada' };
const unitName = (code: string) => unitDisplayNames[code] ?? code;
const signed = (delta: string) => delta.startsWith('-') ? `−${formatDecimal(delta.slice(1), 2)}` : `+${formatDecimal(delta, 2)}`;

function Score({ unit, previousLabel }: { unit: UnitResult; previousLabel: string }) {
  // Review focus 3: a partial score never shows a comparison or a previous
  // score, even when the server still sends `previous`.
  const showPrevious = !unit.partial && unit.previous?.points != null;
  const accepted = unit.items.filter(item => item.state !== 'pendente').length;
  return <div className="v3-metrics">
    <div className="v3-metric v3-metric-lead">
      <span className="v3-label">{unit.partial ? 'Pontuação parcial' : 'Pontuação fictícia'}</span>
      {unit.points === null ? <span className="v3-score-empty">Sem base de cálculo</span>
        : <strong className="v3-score">{formatDecimal(unit.points, 2)}<span className="v3-score-max"> / 100</span></strong>}
      {unit.delta !== null && unit.previous && <span className={`v3-delta ${unit.delta.startsWith('-') ? 'down' : 'up'}`}>{`${signed(unit.delta)} vs. ${monthName(unit.previous.competencia)}`}</span>}
      {unit.partial && <span className="v3-sub">Os demais indicadores ainda não somam pontos. A comparação aparece quando todos forem aceitos.</span>}
    </div>
    <div className="v3-metric"><span className="v3-label">Indicadores aceitos</span><strong className="v3-value">{`${accepted} de ${unit.items.length}`}</strong>
      <span className="v3-sub">{unit.complete ? 'Todos conferidos' : 'Pendências não viram zero'}</span></div>
    {showPrevious && unit.previous?.points != null && <div className="v3-metric"><span className="v3-label">{previousLabel}</span>
      <strong className="v3-value">{formatDecimal(unit.previous.points, 2)}</strong><span className="v3-sub">Publicado na demonstração</span></div>}
  </div>;
}

export function ResultsPage({ client, group }: { client: SupabaseClient; group: ContextGroup }) {
  const [data, setData] = useState<UnitResults | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [explaining, setExplaining] = useState<string | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    let current = true;
    setData(null); setError(false); setExplaining(null);
    // Model 3 reads the whole rule set from any one context of the group.
    void loadUnitResults(client, toCommandContext(group.contexts[0])).then(value => { if (current) setData(value); }).catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [client, group, retry]);

  const units = data?.units ?? [];
  const unit = units.find(candidate => candidate.unitId === selected) ?? units[0];
  function select(unitId: string) { setSelected(unitId); setExplaining(null); }
  function moveTab(event: KeyboardEvent, index: number) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = units[(index + step + units.length) % units.length];
    select(next.unitId);
    tabs.current.get(next.unitId)?.focus();
  }
  const phase = data && `${stateLabels[data.state]}${data.publication === 'publicada_demo' ? ' · publicada na demonstração' : ''}`;

  return <section aria-label="Resultados autorizados" className="v3-page">
    <h2>Resultados</h2>
    <p>{`${group.competenciaCodigo} · só entradas aceitas geram pontos. Pendências não viram zero.`}</p>
    {error ? <p role="alert">Não foi possível confirmar os resultados autorizados.</p>
      : !data ? <p role="status">Carregando resultados…</p>
      : !unit ? <p>Nenhuma unidade autorizada nesta competência.</p> : <>
      {units.length > 1 && <div role="tablist" aria-label="Unidade" className="v3-tabs">{units.map((candidate, index) =>
        <button key={candidate.unitId} type="button" role="tab" id={`v3-tab-${candidate.unitId}`} aria-selected={candidate.unitId === unit.unitId} aria-controls="v3-unit-panel"
          tabIndex={candidate.unitId === unit.unitId ? 0 : -1} ref={node => { if (node) tabs.current.set(candidate.unitId, node); else tabs.current.delete(candidate.unitId); }}
          onClick={() => select(candidate.unitId)} onKeyDown={event => moveTab(event, index)}>{unitName(candidate.unitCode)}</button>)}</div>}
      <section id="v3-unit-panel" role={units.length > 1 ? 'tabpanel' : undefined} aria-labelledby={units.length > 1 ? `v3-tab-${unit.unitId}` : undefined} className="v3-panel">
        <header><h3>{unitName(unit.unitCode)}</h3><span className="v3-status">{`Situação da competência: ${phase}`}</span></header>
        <Score unit={unit} previousLabel={unit.previous ? monthName(unit.previous.competencia).replace(/^./, letter => letter.toUpperCase()) : ''} />
        <div className="table-scroll"><table className="v3-table" aria-label="Indicadores">
          <thead><tr><th scope="col">Indicador</th><th scope="col">Meta</th><th scope="col" className="r">Valor validado</th><th scope="col" className="r">Pontos</th><th scope="col">Situação</th><th scope="col">Memória</th></tr></thead>
          <tbody>{unit.items.map(item => {
            const key = `${unit.unitId}:${item.indicatorCode}`, open = explaining === key;
            return <Fragment key={item.indicatorCode}><tr>
              <td id={`v3-ind-${key}`}><strong>{item.indicatorCode}</strong><span className="v3-cell-sub">{item.name}</span></td>
              <td>{`${directionSymbol(item.direction)} ${formatDecimal(item.meta)}`}</td>
              <td className="r">{item.inputValue === null ? '–' : formatDecimal(item.inputValue)}</td>
              <td className="r">{item.points === null ? '–' : <strong>{formatDecimal(item.points, 2)}</strong>}<span className="v3-cell-sub">{`/ ${formatDecimal(item.weight)}`}</span></td>
              <td><span className={`v3-badge v3-badge-${item.reviewStatus}`}>{statusLabels[item.reviewStatus]}</span></td>
              <td>{item.expression !== null
                ? <button type="button" aria-expanded={open} aria-controls={`v3-calc-${key}`} aria-describedby={`v3-ind-${key}`} ref={node => { if (node) triggers.current.set(key, node); else triggers.current.delete(key); }}
                    onClick={() => setExplaining(open ? null : key)}>Como foi calculado?</button>
                : <span className="v3-cell-sub">{item.state === 'pendente' ? 'Aguardando aceite' : 'Sem cálculo numérico: situação decidida pela CAM'}</span>}</td>
            </tr>{open && <tr id={`v3-calc-${key}`}><td colSpan={6}><CalculationExplainer item={item} mode={data.mode} onClose={() => { setExplaining(null); triggers.current.get(key)?.focus(); }} /></td></tr>}</Fragment>;
          })}</tbody></table></div>
      </section>
      {group.role !== 'cam' && <p className="v3-note">Discordou do resultado? A contestação formal segue o canal institucional externo; esta demonstração não registra contestações.</p>}
    </>}
    <button type="button" onClick={() => setRetry(n => n + 1)}>Atualizar resultados</button>
  </section>;
}
