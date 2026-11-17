import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ContextGroup, DraftInput } from '../pilot/types';
import { DomainCommandError } from '../pilot/commandApi';
import { formatDecimal, parseInputDecimal, previewPoints, sumDecimals } from '../pilot/decimal';
import { validateRuleValue } from '../entry/valueValidation';
import { saveDraft } from '../submission/positionApi';
import { absenceCopy } from '../results/CalculationExplainer';
import { useNavigationDraft } from '../workspace/NavigationSafety';
import { requestAcademicLeave } from '../workspace/academicNavigation';
import { BatchCommandError, loadUnitBatch, submitUnitBatch, type BatchItem, type UnitBatch, type UnitBatchItem } from './batchApi';
import { loadGroupPositions, statusLabels, unitContexts, type GroupPosition } from './groupPositions';
import { competenceLabel, plural, scopeName } from '../workspace/displayNames';

type Situation = DraftInput['estadoDado'];
type Edit = { estado: Situation; valor: string; fonte: string; periodo: string; motivo: string; explicacao: string };
type Field = 'valor' | 'fonte' | 'periodo' | 'motivo' | 'explicacao';
type Errors = Partial<Record<Field, string>>;
type Problem = { positionId: string | null; message: string; code: string };

const situations: readonly (readonly [Situation, string])[] = [['valor', 'Valor'], ['nao_aplicavel', 'Não se aplica'], ['indisponivel', 'Indisponível']];
const motivoLabels: Record<Exclude<Situation, 'valor'>, string> = { nao_aplicavel: 'Por que este indicador não se aplica?', indisponivel: 'Por que o dado está indisponível?' };
const itemMessages: Record<string, string> = {
  invalid_input: 'O servidor recusou este item. Confira o valor, a fonte e o motivo e envie de novo.',
  invalid_state: 'Este item já foi enviado ou não pode mais ser editado. Recarregue a unidade.',
  rule_unavailable: 'A regra fixada para este indicador não está disponível.',
};
// V4 index.html lines 758-765.
const tips: readonly (readonly [string, string])[] = [
  ['Zero é um valor', '0 entra no cálculo como qualquer número. Não é o mesmo que não enviado.'],
  ['Indisponível vai para a CAM', 'Explique o motivo. A CAM decide o tratamento; não vira zero.'],
  ['Não se aplica não é ausência', 'Use quando o indicador não vale para a unidade neste mês.'],
  ['Até 2 casas decimais', 'Use vírgula, como 92,5. Com 3 casas o envio é bloqueado.'],
  ['Devolvida pede explicação', 'Diga o que corrigiu. O revisor vê junto da versão anterior.'],
  ['Só aceitas contam', 'A prévia soma o que está na tela; o resultado usa só o que o revisor aceitou.'],
];
const conflictMessage = 'Os dados mudaram desde que você abriu esta unidade. Recarregue a unidade; o que você digitou foi mantido.';

// R-29: the source period is the month of the competence only when none was saved.
const defaultPeriod = (competence: string) => { const match = /(\d{4})-(\d{2})$/.exec(competence); return match ? `${match[1]}-${match[2]}-01` : ''; };
const validDate = (text: string) => /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
const without = <T,>(all: Record<string, T>, key: string) => Object.fromEntries(Object.entries(all).filter(([id]) => id !== key));
const toInput = (e: Edit): DraftInput => ({ estadoDado: e.estado, valor: e.estado === 'valor' && e.valor.trim() ? e.valor : null, fonte: e.fonte,
  periodoFonte: e.periodo, motivo: e.estado === 'valor' ? '' : e.motivo });

function check(item: UnitBatchItem, e: Edit): Errors {
  const errors: Errors = {};
  if (e.estado === 'valor') { const value = validateRuleValue(e.valor, item); if (!value.ok) errors.valor = value.message; }
  else if (!e.motivo.trim()) errors.motivo = 'Explique o motivo.';
  if (!e.fonte.trim()) errors.fonte = 'Informe a fonte.';
  if (!validDate(e.periodo.trim())) errors.periodo = 'Informe a data do período da fonte.';
  if (item.status === 'devolvida' && !e.explicacao.trim()) errors.explicacao = 'Descreva a correção antes de reenviar.';
  return errors;
}

export function BatchEntryPage({ client, group, initialUnitId, initialFocus }: { client: SupabaseClient; group: ContextGroup; initialUnitId?: string;
  initialFocus?: { positionId?: string; field?: 'valor' | 'explicacao' } }) {
  const period = defaultPeriod(group.competenciaCodigo);
  const state = group.contexts[0].competenciaEstado;
  const open = !state || state === 'aberta';
  const [rows, setRows] = useState<GroupPosition[] | null>(null);
  const [unitId, setUnitId] = useState(initialUnitId ?? '');
  const [batch, setBatch] = useState<UnitBatch | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [touched, setTouched] = useState<Record<string, true>>({});
  const [cardNotes, setCardNotes] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);
  const rowsGeneration = useRef(0);
  const batchGeneration = useRef(0);
  const cards = useRef(new Map<string, HTMLElement>());
  const alertRef = useRef<HTMLParagraphElement>(null);
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const draftOperations = useRef(new Map<string, { signature: string; id: string }>());
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  // Progress per unit from the listed positions: "enviados" are the ones out of the technician's hands.
  const units = useMemo(() => {
    const byId = new Map<string, { id: string; code: string; total: number; sent: number; returned: number }>();
    for (const { position } of rows ?? []) {
      const unit = byId.get(position.escopoId) ?? { id: position.escopoId, code: position.escopoCodigo, total: 0, sent: 0, returned: 0 };
      unit.total++;
      if (['enviada', 'em_revisao', 'validada'].includes(position.status)) unit.sent++;
      if (position.status === 'devolvida') unit.returned++;
      byId.set(unit.id, unit);
    }
    return [...byId.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  }, [rows]);
  const activeUnit = units.find(unit => unit.id === unitId)?.id ?? units[0]?.id ?? '';
  const byPosition = useMemo(() => new Map((rows ?? []).map(row => [row.position.id, row])), [rows]);

  useEffect(() => {
    const request = ++rowsGeneration.current;
    setLoadError(null);
    void loadGroupPositions(client, group).then(loaded => { if (rowsGeneration.current === request) setRows(loaded); })
      .catch(() => { if (rowsGeneration.current === request) setLoadError('Não foi possível carregar as posições autorizadas.'); });
    return () => { rowsGeneration.current++; };
  }, [client, group, reload]);

  useEffect(() => {
    if (!rows || !activeUnit) return;
    const request = ++batchGeneration.current;
    setBatch(current => current && current.unitId === activeUnit ? current : null);
    setLoadError(null);
    void loadUnitBatch(client, unitContexts(rows, activeUnit), activeUnit).then(loaded => { if (batchGeneration.current === request) { setBatch(loaded); setLoadError(null); } })
      .catch(() => { if (batchGeneration.current === request) setLoadError('Não foi possível carregar os indicadores da unidade.'); });
    return () => { batchGeneration.current++; };
  }, [client, rows, activeUnit]);

  useEffect(() => {
    if (!problem) return;
    (problem.positionId ? cards.current.get(problem.positionId) : alertRef.current)?.focus();
  }, [problem]);

  // The painel's request (Corrigir, Revisar e enviar, Preencher) focuses its field once, after the unit loads.
  const focused = useRef<object | null>(null);
  useEffect(() => {
    if (!batch || !initialFocus?.positionId || !initialFocus.field || focused.current === initialFocus) return;
    if (!batch.items.some(item => item.positionId === initialFocus.positionId)) return;
    focused.current = initialFocus;
    document.getElementById(`batch-${initialFocus.positionId}-${initialFocus.field}`)?.focus();
  }, [batch, initialFocus]);

  const initial = (item: UnitBatchItem): Edit => ({ estado: item.estadoDado ?? 'valor', valor: item.valor ? formatDecimal(item.valor) : '',
    fonte: item.fonte ?? '', periodo: item.periodoFonte ?? period, motivo: item.motivo ?? '', explicacao: '' });
  const current = (item: UnitBatchItem) => edits[item.positionId] ?? initial(item);
  const editable = (item: UnitBatchItem) => open && !!byPosition.get(item.positionId)?.position.aplicavel && ['ausente', 'rascunho', 'devolvida'].includes(item.status);
  const items = batch?.items ?? [];
  const evaluated = items.map(item => {
    const e = current(item);
    const errors = editable(item) ? check(item, e) : {};
    const visible = (Object.keys(errors) as Field[]).filter(field => touched[`${item.positionId}:${field}`] || (field === 'valor' && e.valor.trim()));
    const rule = { meta: item.meta, direction: item.direction, weight: item.weight };
    // Locked rows preview the saved value; the official points stay the server's.
    const points = editable(item) ? (e.estado === 'valor' && !errors.valor ? previewPoints(e.valor, rule) : null)
      : byPosition.get(item.positionId)?.position.aplicavel !== false && item.estadoDado === 'valor' && item.valor ? previewPoints(item.valor, rule) : null;
    return { item, e, errors, visible, points, ready: editable(item) && !Object.keys(errors).length };
  });
  const ready = evaluated.filter(card => card.ready);
  const blocked = evaluated.some(card => card.visible.length > 0);
  const waiting = evaluated.filter(card => editable(card.item) && !card.ready).length;
  const errorCount = evaluated.reduce((n, card) => n + card.visible.length, 0);
  const scored = evaluated.flatMap(card => card.points ? [card.points.points] : []);
  useNavigationDraft(busy || Object.keys(edits).length > 0);

  function change(item: UnitBatchItem, patch: Partial<Edit>) {
    setEdits(all => ({ ...all, [item.positionId]: { ...(all[item.positionId] ?? initial(item)), ...patch } }));
    setCardNotes(all => without(all, item.positionId));
    setNotice(null);
    if (problem?.positionId === item.positionId) setProblem(null);
  }
  const touch = (item: UnitBatchItem, field: Field) => setTouched(all => ({ ...all, [`${item.positionId}:${field}`]: true }));

  async function send() {
    if (inFlight.current || !ready.length || blocked) return;
    const sending: BatchItem[] = ready.map(({ item, e }) => ({ context: byPosition.get(item.positionId)!.context, positionId: item.positionId,
      expectedVersion: item.version, input: toInput(e), correction: item.status === 'devolvida' ? { explanation: e.explicacao } : null }));
    const signature = JSON.stringify(sending.map(s => [s.context.vinculoId, s.context.indicadorId, s.positionId, s.expectedVersion, s.input, s.correction]));
    if (operation.current?.signature !== signature) operation.current = { signature, id: crypto.randomUUID() };
    inFlight.current = true; setBusy(true); setProblem(null); setNotice(null);
    try {
      await submitUnitBatch(client, sending, operation.current.id);
      if (!active.current) return;
      operation.current = null;
      const sent = new Set(sending.map(s => s.positionId));
      setEdits(all => Object.fromEntries(Object.entries(all).filter(([id]) => !sent.has(id))));
      setNotice(`${plural(sending.length, 'item enviado', 'itens enviados')} para conferência.`);
      setReload(n => n + 1);
    } catch (cause) {
      if (!active.current) return;
      if (cause instanceof BatchCommandError && cause.positionId) setProblem({ positionId: cause.positionId, code: cause.code, message: itemMessages[cause.code] ?? cause.message });
      else if (cause instanceof DomainCommandError) setProblem({ positionId: null, code: cause.code, message: cause.code === 'version_conflict' ? conflictMessage : cause.message });
      else setProblem({ positionId: null, code: 'network_error', message: 'Não foi possível enviar. O que você digitou foi mantido.' });
    } finally { inFlight.current = false; if (active.current) setBusy(false); }
  }

  async function saveCard(item: UnitBatchItem, e: Edit) {
    if (inFlight.current) return;
    const input = toInput(e);
    const normalized: DraftInput = { ...input, periodoFonte: validDate(input.periodoFonte.trim()) ? input.periodoFonte.trim() : '' };
    const signature = JSON.stringify([item.version, normalized]);
    const pending = draftOperations.current.get(item.positionId);
    const id = pending?.signature === signature ? pending.id : crypto.randomUUID();
    draftOperations.current.set(item.positionId, { signature, id });
    inFlight.current = true; setBusy(true); setProblem(null); setNotice(null);
    try {
      const receipt = await saveDraft(client, byPosition.get(item.positionId)!.context, item.positionId, item.version, normalized, id);
      if (!active.current) return;
      draftOperations.current.delete(item.positionId);
      setBatch(loaded => loaded && { ...loaded, items: loaded.items.map(row => row.positionId !== item.positionId ? row : { ...row, status: 'rascunho', version: receipt.version,
        estadoDado: e.estado, valor: normalized.valor === null ? null : parseInputDecimal(normalized.valor), fonte: normalized.fonte, motivo: normalized.motivo,
        periodoFonte: normalized.periodoFonte || null }) });
      setEdits(all => without(all, item.positionId));
      setCardNotes(all => ({ ...all, [item.positionId]: 'Rascunho salvo.' }));
    } catch (cause) {
      if (!active.current) return;
      setProblem({ positionId: item.positionId, code: cause instanceof DomainCommandError ? cause.code : 'network_error',
        message: cause instanceof DomainCommandError ? cause.message : 'Não foi possível salvar o rascunho. O que você digitou foi mantido.' });
    } finally { inFlight.current = false; if (active.current) setBusy(false); }
  }


  // Switching tabs keeps every edit in `edits`, but asks first when the shown unit has one.
  function selectUnit(id: string): boolean {
    if (id === activeUnit) return true;
    if (items.some(item => edits[item.positionId]) && !requestAcademicLeave()) return false;
    setUnitId(id);
    return true;
  }
  function tabKey(event: KeyboardEvent<HTMLDivElement>) {
    const at = units.findIndex(unit => unit.id === activeUnit);
    const moves: Record<string, number> = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: units.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const unit = units[(moves[event.key] + units.length) % units.length];
    if (selectUnit(unit.id)) document.getElementById(`batch-tab-${unit.id}`)?.focus();
  }

  const retry = () => { setProblem(null); setReload(n => n + 1); };
  const month = competenceLabel(group.competenciaCodigo);
  return <section className="v3-page fill-page" aria-label="Preenchimento em lote">
    {units.length > 0 && <div role="tablist" aria-label="Unidades do seu escopo" className="unit-tabs" onKeyDown={tabKey}>{units.map(unit =>
      <button key={unit.id} id={`batch-tab-${unit.id}`} type="button" role="tab" aria-selected={unit.id === activeUnit} aria-controls="batch-panel"
        tabIndex={unit.id === activeUnit ? 0 : -1} onClick={() => selectUnit(unit.id)}>
        <span className="ut-name">{scopeName(unit.code)}</span>{' '}
        <span className="ut-meta"><span>{`${unit.sent} de ${unit.total} enviados`}</span>{unit.returned
          ? <>{' '}<span className="sr-only">·</span>{' '}<span className="v3-badge t-bad">{plural(unit.returned, 'devolvida', 'devolvidas')}</span></> : null}</span>
        <span className="meter" aria-hidden="true"><span style={{ width: `${(unit.sent / unit.total) * 100}%` }} /></span>
      </button>)}</div>}
    <div className="fill">
    <div className="fill-main" id="batch-panel" role={units.length ? 'tabpanel' : undefined} aria-labelledby={activeUnit ? `batch-tab-${activeUnit}` : undefined}>
    {batch && <div className="fill-head"><h3>{scopeName(batch.unitCode)}</h3>
      <p className="sub">{open ? plural(items.filter(editable).length, 'item editável', 'itens editáveis') : 'somente consulta'}</p></div>}
    {!open && <p className="notice info" role="status"><strong>Somente consulta.</strong>{' '}{state === 'em_consolidacao'
      ? `A CAM está consolidando ${month.split('/')[0].toLowerCase()}. Para corrigir algo, a CAM precisa retornar a competência para aberta.`
      : 'Esta competência está fechada; os valores estão congelados.'}</p>}
    {loadError && <p role="alert">{loadError}</p>}
    {rows && !units.length && !loadError && <p>Nenhuma posição para preencher neste mês.</p>}
    {!loadError && !batch && (!rows || units.length > 0) && <p role="status">Carregando indicadores…</p>}
    {notice && <p role="status">{notice}</p>}
    {blocked && <p className="notice danger" role="alert"><strong>{errorCount === 1 ? '1 campo precisa' : `${errorCount} campos precisam`} de correção.</strong>{' '}Nada foi enviado.</p>}
    {batch && <div className="fill-tbl"><table>
      <caption className="sr-only">{`Indicadores de ${scopeName(batch.unitCode)} em ${month}`}</caption>
      <thead><tr><th scope="col">Indicador</th><th scope="col">Meta</th><th scope="col">Situação do dado</th><th scope="col" className="r">Valor</th><th scope="col" className="r">Pontos</th></tr></thead>
      {evaluated.map(({ item, e, errors, visible, points, ready: isReady }) => {
        const k = `batch-${item.positionId}`;
        const isEditable = editable(item);
        const returned = isEditable && item.status === 'devolvida';
        const applicable = byPosition.get(item.positionId)?.position.aplicavel !== false;
        const cardProblem = problem?.positionId === item.positionId ? problem : null;
        const error = (field: Field): ReactNode => visible.includes(field) && errors[field] ? <span id={`${k}-${field}-error`} className="fill-error">{errors[field]}</span> : null;
        const describedBy = (field: Field, hint?: boolean) => [hint ? `${k}-${field}-hint` : '', error(field) ? `${k}-${field}-error` : ''].filter(Boolean).join(' ') || undefined;
        const unit = item.unit ? ` ${item.unit}` : '';
        return <tbody key={item.positionId} ref={node => { if (node) cards.current.set(item.positionId, node); else cards.current.delete(item.positionId); }}
          className={returned ? 'is-ret' : isEditable ? undefined : 'is-locked'} tabIndex={-1} aria-labelledby={`${k}-title`}
          aria-describedby={cardProblem ? `${k}-problem` : undefined} data-invalid={cardProblem ? 'true' : undefined}>
          <tr className="main">
            <td id={`${k}-title`} className="ind-name" data-label="Indicador"><div className="ind">
              <strong>{item.indicatorCode}</strong>{' '}<span className="sr-only">·</span>{' '}<span className="nm">{item.name}</span>{' '}
              <span className={`v3-badge v3-st-${item.status}`}>{statusLabels[item.status]}</span>
              {item.revisionNumber && item.revisionNumber > 1 ? <>{' '}<span className="sub">{`revisão ${item.revisionNumber}`}</span></> : null}
            </div></td>
            <td data-label="Meta"><span className="nowrap">{`${item.direction === 'maior_melhor' ? 'mín.' : 'máx.'} ${formatDecimal(item.meta)}${unit}`}</span>
              <span className="sub">{`peso ${formatDecimal(item.weight)}`}</span></td>
            <td data-label="Situação do dado">{isEditable
              ? <div role="radiogroup" aria-label="Situação do dado" className="seg">{situations.map(([value, label]) => <label key={value}>
                <input type="radio" name={`${k}-situation`} value={value} checked={e.estado === value} onChange={() => change(item, { estado: value })} />{label}</label>)}</div>
              : !applicable ? 'Não se aplica a esta unidade neste mês.'
                : item.estadoDado ? <>{situations.find(([value]) => value === item.estadoDado)![1]}
                  {item.estadoDado === 'valor' ? item.fonte && <span className="sub">{`Fonte: ${item.fonte}`}</span> : item.motivo && <span className="sub">{`Motivo: ${item.motivo}`}</span>}</>
                  : 'Nada ainda'}</td>
            <td className="r" data-label="Valor">{!isEditable ? (applicable && item.estadoDado === 'valor' && item.valor ? `${formatDecimal(item.valor)}${unit}` : '–')
              : e.estado === 'valor' ? <><label className="sr-only" htmlFor={`${k}-valor`}>Valor apurado</label>
                <span className={visible.includes('valor') ? 'vin is-bad' : 'vin'}>
                  <input id={`${k}-valor`} type="text" inputMode="decimal" autoComplete="off" value={e.valor} aria-invalid={visible.includes('valor') ? 'true' : undefined}
                    aria-describedby={describedBy('valor', true)} onChange={event => change(item, { valor: event.target.value })} onBlur={() => touch(item, 'valor')} />
                  {item.unit && <span aria-hidden="true">{item.unit}</span>}</span>{error('valor')}</> : '–'}</td>
            <td className="r" data-label="Pontos"><output className="pts" aria-live="polite">{points ? formatDecimal(points.points, 2) : '–'}</output><span className="sub">{`de ${formatDecimal(item.weight)}`}</span></td>
          </tr>
          {(isEditable || cardProblem) && <tr className="sub-row"><td colSpan={5}><div className="sub-grid">
            {cardProblem && <p id={`${k}-problem`} role="alert" className="fill-error wide">{cardProblem.message}</p>}
            {returned && <p className="returned"><strong>Devolvida pelo revisor técnico.</strong>{item.returnReason && <>{' '}{item.returnReason}</>}</p>}
            {isEditable && <>
              <div className="field"><label htmlFor={`${k}-fonte`}>Fonte do dado</label>
                <input id={`${k}-fonte`} maxLength={500} value={e.fonte} aria-invalid={visible.includes('fonte') ? 'true' : undefined} aria-describedby={describedBy('fonte', true)}
                  onChange={event => change(item, { fonte: event.target.value })} onBlur={() => touch(item, 'fonte')} />
                <span id={`${k}-fonte-hint`} className="sub">Sistema ou relatório de onde o valor saiu.</span>{error('fonte')}</div>
              <div className="field"><label htmlFor={`${k}-periodo`}>Período da fonte</label>
                <input id={`${k}-periodo`} type="date" value={e.periodo} aria-invalid={visible.includes('periodo') ? 'true' : undefined} aria-describedby={describedBy('periodo')}
                  onChange={event => change(item, { periodo: event.target.value })} onBlur={() => touch(item, 'periodo')} />{error('periodo')}</div>
              {e.estado !== 'valor' && <div className="field"><label htmlFor={`${k}-motivo`}>{motivoLabels[e.estado]}</label>
                <textarea id={`${k}-motivo`} rows={2} maxLength={1000} value={e.motivo} aria-invalid={visible.includes('motivo') ? 'true' : undefined} aria-describedby={describedBy('motivo')}
                  onChange={event => change(item, { motivo: event.target.value })} onBlur={() => touch(item, 'motivo')} />{error('motivo')}</div>}
              {item.status === 'devolvida' && <div className="field"><span className="field-head"><label htmlFor={`${k}-explicacao`}>O que você corrigiu?</label> <span className="sub">obrigatório</span></span>
                <textarea id={`${k}-explicacao`} rows={2} maxLength={1000} value={e.explicacao} aria-required="true" aria-invalid={visible.includes('explicacao') ? 'true' : undefined}
                  aria-describedby={describedBy('explicacao', true)} onChange={event => change(item, { explicacao: event.target.value })} onBlur={() => touch(item, 'explicacao')} />
                <span id={`${k}-explicacao-hint`} className="sub">O revisor vê esta explicação junto da versão anterior.</span>{error('explicacao')}</div>}
              <div className="calc-wrap"><span className="sub">Cálculo</span>
                {points ? <span className="mono">{points.expression}</span> : <span>{e.estado === 'valor' ? 'Informe o valor para ver o cálculo.' : absenceCopy[batch.mode]}</span>}
                {e.estado === 'valor' && <span id={`${k}-valor-hint`} className="sub">{item.decimals ? `Até ${item.decimals} casas decimais` : 'Número inteiro'} · máximo {formatDecimal(item.max)}{unit}.</span>}</div>
              <div className="fill-actions">
                {item.status !== 'devolvida' && <button type="button" disabled={busy || visible.includes('valor')} onClick={() => void saveCard(item, e)}>Salvar rascunho</button>}
                {cardNotes[item.positionId] && <span role="status">{cardNotes[item.positionId]}</span>}
                {isReady && <span className="sub">Pronto para envio</span>}
              </div>
            </>}
          </div></td></tr>}
        </tbody>;
      })}
    </table></div>}
    {problem && !problem.positionId && <><p ref={alertRef} role="alert" tabIndex={-1}>{problem.message}</p>
      {problem.code === 'version_conflict' && <button type="button" onClick={retry}>Recarregar unidade</button>}</>}
    {batch && open && <div className="fill-bar">
      <p className="fill-total"><span className="sub">Prévia da unidade</span>{' '}<strong>{scored.length ? formatDecimal(sumDecimals(scored), 2) : '–'} / 100</strong></p>
      <p className="fill-count" aria-live="polite"><strong>{plural(ready.length, 'pronto', 'prontos')} para envio</strong>{waiting ? <span> · {plural(waiting, 'pendente', 'pendentes')}</span> : null}</p>
      <button type="button" className="primary" disabled={busy || !ready.length || blocked} onClick={() => void send()}>{busy ? 'Enviando…' : `Enviar ${plural(ready.length, 'item', 'itens')}`}</button>
    </div>}
    </div>
    <aside className="tips box" aria-labelledby="batch-tips-title"><h3 id="batch-tips-title">Dicas rápidas</h3>
      <ul>{tips.map(([title, text]) => <li key={title}><strong>{title}</strong><span>{text}</span></li>)}</ul></aside>
    </div>
  </section>;
}
