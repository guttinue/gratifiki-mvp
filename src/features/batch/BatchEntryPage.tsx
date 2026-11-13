import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ContextGroup, DraftInput } from '../pilot/types';
import { DomainCommandError } from '../pilot/commandApi';
import { formatDecimal, parseInputDecimal, previewPoints } from '../pilot/decimal';
import { validateRuleValue } from '../entry/valueValidation';
import { saveDraft } from '../submission/positionApi';
import { absenceCopy, directionSymbol } from '../results/CalculationExplainer';
import { useNavigationDraft } from '../workspace/NavigationSafety';
import { BatchCommandError, loadUnitBatch, submitUnitBatch, type BatchItem, type UnitBatch, type UnitBatchItem } from './batchApi';
import { loadGroupPositions, statusLabels, unitContexts, type GroupPosition } from './groupPositions';
import { competenceLabel, scopeName } from '../workspace/displayNames';

type Situation = DraftInput['estadoDado'];
type Edit = { estado: Situation; valor: string; fonte: string; periodo: string; motivo: string; explicacao: string };
type Field = 'valor' | 'fonte' | 'periodo' | 'motivo' | 'explicacao';
type Errors = Partial<Record<Field, string>>;
type Problem = { positionId: string | null; message: string; code: string };

const situations: readonly (readonly [Situation, string])[] = [['valor', 'Tenho o valor'], ['nao_aplicavel', 'Não se aplica'], ['indisponivel', 'Indisponível']];
const motivoLabels: Record<Exclude<Situation, 'valor'>, string> = { nao_aplicavel: 'Por que este indicador não se aplica?', indisponivel: 'Por que o dado está indisponível?' };
const itemMessages: Record<string, string> = {
  invalid_input: 'O servidor recusou este item. Confira o valor, a fonte e o motivo e envie de novo.',
  invalid_state: 'Este item já foi enviado ou não pode mais ser editado. Recarregue a unidade.',
  rule_unavailable: 'A regra fixada para este indicador não está disponível.',
};
const conflictMessage = 'Os dados mudaram desde que você abriu esta unidade. Recarregue a unidade; o que você digitou foi mantido.';

// R-29: the source period is the month of the competence only when none was saved.
const defaultPeriod = (competence: string) => { const match = /(\d{4})-(\d{2})$/.exec(competence); return match ? `${match[1]}-${match[2]}-01` : ''; };
const validDate = (text: string) => /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
const without = <T,>(all: Record<string, T>, key: string) => Object.fromEntries(Object.entries(all).filter(([id]) => id !== key));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
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

export function BatchEntryPage({ client, group, initialUnitId }: { client: SupabaseClient; group: ContextGroup; initialUnitId?: string }) {
  const period = defaultPeriod(group.competenciaCodigo);
  const open = !group.contexts[0].competenciaEstado || group.contexts[0].competenciaEstado === 'aberta';
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

  const initial = (item: UnitBatchItem): Edit => ({ estado: item.estadoDado ?? 'valor', valor: item.valor ? formatDecimal(item.valor) : '',
    fonte: item.fonte ?? '', periodo: item.periodoFonte ?? period, motivo: item.motivo ?? '', explicacao: '' });
  const current = (item: UnitBatchItem) => edits[item.positionId] ?? initial(item);
  const editable = (item: UnitBatchItem) => open && !!byPosition.get(item.positionId)?.position.aplicavel && ['ausente', 'rascunho', 'devolvida'].includes(item.status);
  const items = batch?.items ?? [];
  const evaluated = items.map(item => {
    const e = current(item);
    const errors = editable(item) ? check(item, e) : {};
    const visible = (Object.keys(errors) as Field[]).filter(field => touched[`${item.positionId}:${field}`] || (field === 'valor' && e.valor.trim()));
    return { item, e, errors, visible, ready: editable(item) && !Object.keys(errors).length };
  });
  const ready = evaluated.filter(card => card.ready);
  const blocked = evaluated.some(card => card.visible.length > 0);
  const waiting = evaluated.filter(card => editable(card.item) && !card.ready).length;
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

  const retry = () => { setProblem(null); setReload(n => n + 1); };
  return <section className="v3-page batch-page" aria-label="Preenchimento em lote">
    {!open && <p className="v3-note">A competência não está aberta: somente consulta.</p>}
    <div className="batch-fill">
    <nav aria-label="Unidades" className="batch-units">{units.map(unit => <button key={unit.id} type="button" aria-pressed={unit.id === activeUnit} onClick={() => setUnitId(unit.id)}>
      <b>{scopeName(unit.code)}</b>{' '}<span className="v3-sub">{`${unit.sent} de ${unit.total} enviados`}{unit.returned ? ` · ${unit.returned} ${unit.returned > 1 ? 'devolvidas' : 'devolvida'}` : ''}</span>
      <progress aria-hidden="true" value={unit.sent} max={unit.total} /></button>)}</nav>
    <div className="batch-main">
    {loadError && <p role="alert">{loadError}</p>}
    {rows && !units.length && !loadError && <p>Nenhuma posição para preencher neste mês.</p>}
    {!loadError && !batch && (!rows || units.length > 0) && <p role="status">Carregando indicadores…</p>}
    {notice && <p role="status">{notice}</p>}
    {batch && <header className="batch-head"><h3>{scopeName(batch.unitCode)}</h3><p className="v3-sub">{competenceLabel(group.competenciaCodigo)} · regra fictícia DEMO-v1</p></header>}
    <ul className="batch-cards">{evaluated.map(({ item, e, errors, visible, ready: isReady }) => {
      const k = `batch-${item.positionId}`;
      const isEditable = editable(item);
      const cardProblem = problem?.positionId === item.positionId ? problem : null;
      const error = (field: Field): ReactNode => visible.includes(field) && errors[field] ? <span id={`${k}-${field}-error`} className="batch-error">{errors[field]}</span> : null;
      const describedBy = (field: Field, hint?: boolean) => [hint ? `${k}-${field}-hint` : '', error(field) ? `${k}-${field}-error` : ''].filter(Boolean).join(' ') || undefined;
      const preview = isEditable && e.estado === 'valor' && !errors.valor ? previewPoints(e.valor, { meta: item.meta, direction: item.direction, weight: item.weight }) : null;
      const unit = item.unit ? ` ${item.unit}` : '';
      return <li key={item.positionId}><section ref={node => { if (node) cards.current.set(item.positionId, node); else cards.current.delete(item.positionId); }}
        className="batch-card" tabIndex={-1} aria-labelledby={`${k}-title`} aria-describedby={cardProblem ? `${k}-problem` : undefined} data-invalid={cardProblem ? 'true' : undefined}>
        <header><h4 id={`${k}-title`}>{item.indicatorCode} · {item.name}</h4><span className={`v3-badge v3-st-${item.status}`}>{statusLabels[item.status]}</span></header>
        <p className="v3-sub">Meta: {directionSymbol(item.direction)} {formatDecimal(item.meta)}{unit} · peso {formatDecimal(item.weight)} pontos{item.revisionNumber && item.revisionNumber > 1 ? ` · revisão ${item.revisionNumber}` : ''}</p>
        {cardProblem && <p id={`${k}-problem`} role="alert" className="batch-error">{cardProblem.message}</p>}
        {item.status === 'devolvida' && item.returnReason && <p className="batch-return"><strong>Motivo da devolução</strong> {item.returnReason}</p>}
        {isEditable ? <div className="batch-body">
          <div role="radiogroup" aria-labelledby={`${k}-situation`} className="batch-situation">
            <span id={`${k}-situation`} className="v3-label">Situação do dado</span>
            {situations.map(([value, label]) => <label key={value} className="batch-radio"><input type="radio" name={`${k}-situation`} value={value} checked={e.estado === value}
              onChange={() => change(item, { estado: value })} />{label}</label>)}
          </div>
          {e.estado === 'valor' ? <div className="batch-field"><label htmlFor={`${k}-valor`}>Valor apurado</label>
            <input id={`${k}-valor`} inputMode="decimal" autoComplete="off" value={e.valor} aria-invalid={visible.includes('valor') ? 'true' : undefined} aria-describedby={describedBy('valor', true)}
              onChange={event => change(item, { valor: event.target.value })} onBlur={() => touch(item, 'valor')} />
            <span id={`${k}-valor-hint`} className="v3-sub">{item.decimals ? `Até ${item.decimals} casas decimais` : 'Número inteiro'} · máximo {formatDecimal(item.max)}{unit}.</span>{error('valor')}</div>
            : <div className="batch-field"><label htmlFor={`${k}-motivo`}>{motivoLabels[e.estado]}</label>
              <textarea id={`${k}-motivo`} maxLength={1000} value={e.motivo} aria-invalid={visible.includes('motivo') ? 'true' : undefined} aria-describedby={describedBy('motivo')}
                onChange={event => change(item, { motivo: event.target.value })} onBlur={() => touch(item, 'motivo')} />{error('motivo')}</div>}
          <div className="batch-field"><label htmlFor={`${k}-fonte`}>Fonte do dado</label>
            <input id={`${k}-fonte`} maxLength={500} value={e.fonte} aria-invalid={visible.includes('fonte') ? 'true' : undefined} aria-describedby={describedBy('fonte', true)}
              onChange={event => change(item, { fonte: event.target.value })} onBlur={() => touch(item, 'fonte')} />
            <span id={`${k}-fonte-hint`} className="v3-sub">Sistema ou relatório de onde o valor saiu.</span>{error('fonte')}</div>
          <div className="batch-field"><label htmlFor={`${k}-periodo`}>Período da fonte</label>
            <input id={`${k}-periodo`} type="date" value={e.periodo} aria-invalid={visible.includes('periodo') ? 'true' : undefined} aria-describedby={describedBy('periodo')}
              onChange={event => change(item, { periodo: event.target.value })} onBlur={() => touch(item, 'periodo')} />{error('periodo')}</div>
          {item.status === 'devolvida' && <div className="batch-field"><label htmlFor={`${k}-explicacao`}>O que você corrigiu?</label>
            <textarea id={`${k}-explicacao`} maxLength={1000} value={e.explicacao} aria-invalid={visible.includes('explicacao') ? 'true' : undefined} aria-describedby={describedBy('explicacao', true)}
              onChange={event => change(item, { explicacao: event.target.value })} onBlur={() => touch(item, 'explicacao')} />
            <span id={`${k}-explicacao-hint`} className="v3-sub">O revisor vê esta explicação junto da versão anterior.</span>{error('explicacao')}</div>}
          <div className="batch-score" aria-live="polite">
            <span className="v3-label">Pontos (prévia)</span>
            <output className="batch-points">{preview ? formatDecimal(preview.points, 2) : '–'}</output>
            <span className="v3-sub">de {formatDecimal(item.weight)} possíveis · o cálculo oficial é o do servidor</span>
            <span className="batch-formula">{preview ? preview.expression : e.estado === 'valor' ? 'Informe o valor para ver o cálculo.' : batch && absenceCopy[batch.mode]}</span>
          </div>
          <div className="batch-actions">
            {item.status !== 'devolvida' && <button type="button" disabled={busy || visible.includes('valor')} onClick={() => void saveCard(item, e)}>Salvar rascunho</button>}
            {cardNotes[item.positionId] && <span role="status">{cardNotes[item.positionId]}</span>}
            {isReady && <span className="v3-sub">Pronto para envio</span>}
          </div>
        </div> : <dl className="batch-locked">
          {byPosition.get(item.positionId)?.position.aplicavel === false ? <><dt>Situação</dt><dd>Não se aplica a esta unidade neste mês.</dd></>
            : item.estadoDado ? <><dt>Informado</dt><dd>{item.estadoDado === 'valor' ? `${formatDecimal(item.valor ?? '0')}${unit}` : item.estadoDado === 'nao_aplicavel' ? 'Não se aplica' : 'Indisponível'}</dd>
              {item.fonte && <><dt>Fonte</dt><dd>{item.fonte}</dd></>}{item.motivo && <><dt>Motivo</dt><dd>{item.motivo}</dd></>}</> : <><dt>Informado</dt><dd>Nada ainda</dd></>}
        </dl>}
      </section></li>;
    })}</ul>
    {problem && !problem.positionId && <><p ref={alertRef} role="alert" tabIndex={-1}>{problem.message}</p>
      {problem.code === 'version_conflict' && <button type="button" onClick={retry}>Recarregar unidade</button>}</>}
    {batch && open && <div className="batch-footer">
      <p className="batch-count" aria-live="polite"><strong>{plural(ready.length, 'pronto', 'prontos')} para envio</strong>{waiting ? <span> · {plural(waiting, 'pendente', 'pendentes')}</span> : null}</p>
      <button type="button" className="batch-send primary" disabled={busy || !ready.length || blocked} onClick={() => void send()}>{busy ? 'Enviando…' : `Enviar ${plural(ready.length, 'item', 'itens')}`}</button>
    </div>}
    </div></div>
  </section>;
}
