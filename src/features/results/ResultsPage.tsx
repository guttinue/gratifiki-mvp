import type { SupabaseClient } from '@supabase/supabase-js';
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ContextGroup } from '../pilot/types';
import { formatDecimal } from '../pilot/decimal';
import { toCommandContext } from '../context/contextApi';
import { competenceLabel, competenceStateLabels, monthName, plural, scopeName, stateTones, type Tone } from '../workspace/displayNames';
import { ActivityFeed, StageTiles, UnitCard } from '../workspace/v4Parts';
import { absenceCopy, CalculationExplainer, directionSymbol } from './CalculationExplainer';
import { loadUnitResults, type ReviewStatus, type UnitResult, type UnitResults } from './resultsApi';

const statusLabels: Record<ReviewStatus, string> = { valor: 'Aceita', indisponivel: 'Indisponível', nao_aplicavel: 'Não se aplica',
  sem_envio: 'Não enviada', em_conferencia: 'Em conferência', decisao_pendente: 'Aguardando decisão da CAM' };
const signed = (delta: string) => delta.startsWith('-') ? `−${formatDecimal(delta.slice(1), 2)}` : `+${formatDecimal(delta, 2)}`;

// Hero phase (spec §5.1): the publication wins over the competence state.
export function phaseLabel(state: UnitResults['state'], publication: UnitResults['publication']): { text: string; tone: Tone } {
  if (publication === 'publicada_demo') return { text: 'Publicado na demonstração', tone: 'ok' };
  return state === 'fechada' ? { text: 'Fechado', tone: 'vio' } : { text: 'Preliminar', tone: 'warn' };
}
const Phase = ({ data }: { data: UnitResults }) => { const phase = phaseLabel(data.state, data.publication); return <span className={`v3-badge t-${phase.tone}`}>{phase.text}</span>; };
// The arrow is decoration; the text read is "+4,80 vs. setembro".
function Delta({ unit }: { unit: UnitResult }) {
  if (unit.delta === null || !unit.previous) return null;
  const down = unit.delta.startsWith('-');
  return <><span className={`delta ${down ? 'down' : 'up'}`} aria-hidden="true">{down ? '↓ ' : '↑ '}</span><span className={`delta ${down ? 'down' : 'up'}`}>{`${signed(unit.delta)} vs. ${monthName(unit.previous.competencia)}`}</span></>;
}
const acceptedCount = (unit: UnitResult) => `${unit.items.filter(item => item.state !== 'pendente').length} de ${unit.items.length}`;

function Hero({ unit, data }: { unit: UnitResult; data: UnitResults }) {
  const titleId = useId();
  // Review focus 3: a partial score never shows a comparison or a previous
  // score, even when the server still sends `previous`.
  const previous = !unit.partial && unit.previous?.points != null ? unit.previous : null;
  return <section className="box hero" aria-labelledby={titleId}><div>
    <div className="hero-top"><h3 id={titleId}>{`${scopeName(unit.unitCode)} · ${competenceLabel(data.competencia)}`}</h3><Phase data={data} /></div>
    <p className="score-label">{unit.partial ? 'Pontuação parcial fictícia' : 'Pontuação fictícia'}</p>
    {/* v3-score stays for the E2E journey locator (preflight F15). */}
    <p className="score">{unit.points === null ? <span className="score-empty">Sem base de cálculo</span>
      : <><span className="score-n v3-score">{formatDecimal(unit.points, 2)}</span> <span className="score-of">/ 100</span></>}</p>
    <p className="delta-line">{unit.partial ? <span className="sub">Os demais indicadores ainda não somam pontos. A comparação aparece quando todos forem aceitos.</span> : <Delta unit={unit} />}</p>
  </div>
  <dl className="hero-stats"><div><dt>Indicadores aceitos</dt><dd>{acceptedCount(unit)}</dd></div>
    {previous?.points != null && <div><dt>{monthName(previous.competencia).replace(/^./, letter => letter.toUpperCase())}</dt><dd>{formatDecimal(previous.points, 2)}</dd></div>}</dl>
  </section>;
}

const contestNote = <p className="v3-note">Discordou do resultado? A contestação formal segue o canal institucional externo; esta demonstração não registra contestações.</p>;

// GD-01: one card per unit; no average is computed here (spec §5.2).
function DistrictPanel({ client, group, data, onOpenUnit, onOpenHistory }: { client: SupabaseClient; group: ContextGroup; data: UnitResults; onOpenUnit?: (unitId: string) => void; onOpenHistory?: () => void }) {
  const titleId = useId();
  return <>
    <StageTiles label="Resumo do distrito" tiles={[
      { label: 'Unidades completas', value: `${data.units.filter(unit => unit.complete).length} de ${data.units.length}`, sub: 'com todos os indicadores aceitos', tone: 'ok' },
      { label: 'Etapa do ciclo', value: competenceStateLabels[data.state], sub: `competência ${competenceLabel(data.competencia)}`, tone: stateTones[data.state], text: true }]} />
    <div className="dash"><div className="stack">
      <section className="block" aria-labelledby={titleId}><div className="block-head"><h3 id={titleId}>Unidades do distrito</h3></div><div className="cards">
        {data.units.map(unit => { const name = scopeName(unit.unitCode);
          return <UnitCard key={unit.unitId} title={name} sub={`${acceptedCount(unit)} indicadores aceitos`} badge={<Phase data={data} />}
            big={unit.points === null ? <small>Sem base de cálculo</small> : <>{formatDecimal(unit.points, 2)} <small>/ 100</small></>}
            foot={unit.partial ? 'Pontuação parcial; comparação quando todos forem aceitos' : unit.delta !== null ? <Delta unit={unit} /> : undefined}
            action={{ label: 'Ver detalhe', ariaLabel: `Ver detalhe ${name}`, onClick: () => onOpenUnit?.(unit.unitId) }} />; })}
      </div></section>
      {contestNote}
    </div><ActivityFeed client={client} group={group} onOpenHistory={onOpenHistory} /></div>
  </>;
}

// panel: the painel of the unit manager (result and activity) or of the district manager (DistrictPanel); none is the Resultados page.
export function ResultsPage({ client, group, initialUnitId, onOpenHistory, onOpenUnit, panel }: { client: SupabaseClient; group: ContextGroup;
  initialUnitId?: string; onOpenHistory?: () => void; onOpenUnit?: (unitId: string) => void; panel?: 'unit' | 'district' }) {
  const [data, setData] = useState<UnitResults | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(initialUnitId ?? null);
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
  const noNumber = unit?.items.filter(item => item.state === 'indisponivel' || item.state === 'nao_aplicavel').length ?? 0;
  const main = data && unit && <>
    {units.length > 1 && <div role="tablist" aria-label="Unidade" className="chip-tabs">{units.map((candidate, index) =>
      <button key={candidate.unitId} type="button" role="tab" id={`v3-tab-${candidate.unitId}`} aria-selected={candidate.unitId === unit.unitId} aria-controls="v3-unit-panel"
        tabIndex={candidate.unitId === unit.unitId ? 0 : -1} ref={node => { if (node) tabs.current.set(candidate.unitId, node); else tabs.current.delete(candidate.unitId); }}
        onClick={() => select(candidate.unitId)} onKeyDown={event => moveTab(event, index)}>{scopeName(candidate.unitCode)}</button>)}</div>}
    <div id="v3-unit-panel" role={units.length > 1 ? 'tabpanel' : undefined} aria-labelledby={units.length > 1 ? `v3-tab-${unit.unitId}` : undefined} className="stack">
      <Hero unit={unit} data={data} />
      {noNumber > 0 && <p className="notice warning">{`${plural(noNumber, 'indicador aceito', 'indicadores aceitos')} como indisponível ou não aplicável ${noNumber === 1 ? 'não gera' : 'não geram'} pontos numéricos. ${absenceCopy[data.mode]}`}</p>}
      <section className="block" aria-labelledby="v3-by-indicator"><div className="block-head"><h3 id="v3-by-indicator">Por indicador</h3></div>
        <div className="v4-tbl"><table aria-label="Indicadores">
          <thead><tr><th scope="col">Indicador</th><th scope="col">Meta</th><th scope="col" className="r">Valor validado</th><th scope="col" className="r">Pontos</th><th scope="col">Situação</th><th scope="col">Memória</th></tr></thead>
          <tbody>{unit.items.map(item => {
            const key = `${unit.unitId}:${item.indicatorCode}`, open = explaining === key;
            // Bar width only (aria-hidden); the official points stay the server's text.
            const share = item.points === null || !Number(item.weight) ? 0 : Math.min(100, Number(item.points) / Number(item.weight) * 100);
            return <Fragment key={item.indicatorCode}><tr>
              <td id={`v3-ind-${key}`}><strong>{item.indicatorCode}</strong><span className="sub">{item.name}</span></td>
              <td data-label="Meta">{`${directionSymbol(item.direction)} ${formatDecimal(item.meta)}`}</td>
              <td data-label="Valor validado" className="r">{item.inputValue === null ? '–' : formatDecimal(item.inputValue)}</td>
              <td data-label="Pontos" className="r">{item.points === null ? '–' : <strong>{formatDecimal(item.points, 2)}</strong>}<span className="v3-cell-sub">{` / ${formatDecimal(item.weight)}`}</span>
                <span className="pts-bar" aria-hidden="true"><span style={{ width: `${share}%` }} /></span></td>
              <td data-label="Situação"><span className={`v3-badge v3-badge-${item.reviewStatus}`}>{statusLabels[item.reviewStatus]}</span></td>
              <td data-label="Memória">{item.expression !== null
                ? <button type="button" className="link" aria-expanded={open} aria-controls={`v3-calc-${key}`} aria-describedby={`v3-ind-${key}`} ref={node => { if (node) triggers.current.set(key, node); else triggers.current.delete(key); }}
                    onClick={() => setExplaining(open ? null : key)}>Como foi calculado?</button>
                : <span className="sub">{item.state === 'pendente' ? 'Aguardando aceite' : 'Sem cálculo numérico: situação decidida pela CAM'}</span>}</td>
            </tr>{open && <tr id={`v3-calc-${key}`}><td colSpan={6}><CalculationExplainer item={item} mode={data.mode} onClose={() => { setExplaining(null); triggers.current.get(key)?.focus(); }} /></td></tr>}</Fragment>;
          })}</tbody></table></div>
      </section>
      {group.role !== 'cam' && contestNote}
    </div>
  </>;

  return <section aria-label="Resultados autorizados" className="v3-page">
    {error ? <p role="alert">Não foi possível confirmar os resultados autorizados.</p>
      : !data ? <p role="status">Carregando resultados…</p>
      : !unit ? <p>Nenhuma unidade autorizada nesta competência.</p>
      : panel === 'district' ? <DistrictPanel client={client} group={group} data={data} onOpenUnit={onOpenUnit} onOpenHistory={onOpenHistory} />
      : panel === 'unit' ? <div className="dash"><div className="stack">{main}</div><ActivityFeed client={client} group={group} onOpenHistory={onOpenHistory} /></div>
      : main}
    <button type="button" onClick={() => setRetry(n => n + 1)}>Atualizar resultados</button>
  </section>;
}
