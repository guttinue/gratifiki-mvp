import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import type { AuthorizedContext, CommandContext, CommandReceipt, DraftInput } from '../pilot/types';
import { toCommandContext } from '../context/contextApi';
import { DomainCommandError } from '../pilot/commandApi';
import { normalizeDraftInput, type PositionDetail } from '../submission/positionApi';
import { authorizeCorrection, correctPosition, decideUnavailability } from './correctionApi';
import { useNavigationDraft } from '../workspace/NavigationSafety';
interface CorrectionFormProps {
    client: SupabaseClient;
    context: CommandContext;
    detail: PositionDetail;
    onSubmitted: (receipt: CommandReceipt) => void;
}
export function CorrectionForm({ client, context, detail, onSubmitted }: CorrectionFormProps) {
    const previous = detail.revisions.find(row => row.id === detail.position.revisionId);
    const initial: DraftInput = {
        estadoDado: previous?.estadoDado ?? 'valor',
        valor: previous?.value ?? null,
        fonte: previous?.source ?? '',
        periodoFonte: previous?.sourcePeriod ?? '',
        motivo: previous?.reason ?? '',
    };
    const [input, setInput] = useState<DraftInput>(initial);
    const [pending, setPending] = useState<{
        id: string;
        version: number;
        input: DraftInput;
    } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [receipt, setReceipt] = useState<CommandReceipt | null>(null);
    const active = useRef(true);
    const inFlight = useRef(false);
    useEffect(() => {
        active.current = true;
        return () => { active.current = false; };
    }, []);
    async function execute() {
        if (inFlight.current || receipt)
            return;
        setError(null);
        let operation = pending;
        if (!operation) {
            try {
                const normalized = normalizeDraftInput(input);
                if (!normalized.fonte || normalized.fonte.length > 500 ||
                    !/^\d{4}-\d{2}-\d{2}$/.test(normalized.periodoFonte) ||
                    normalized.motivo.length > 1000 ||
                    (normalized.estadoDado === 'valor' && normalized.valor === null) ||
                    (normalized.estadoDado === 'indisponivel' && !normalized.motivo))
                    throw new Error();
                operation = { id: crypto.randomUUID(), version: detail.position.version, input: normalized };
            }
            catch {
                setError('Informe valor ou indisponibilidade, fonte, período e justificativa válida.');
                return;
            }
        }
        setPending(operation);
        setBusy(true);
        inFlight.current = true;
        try {
            const confirmed = await correctPosition(client, context, detail.position.id, operation.version, operation.input, operation.id);
            if (!active.current)
                return;
            if (confirmed.revisionId === detail.position.revisionId)
                throw new DomainCommandError('invalid_input');
            setPending(null);
            setReceipt(confirmed);
            onSubmitted(confirmed);
        }
        catch (cause) {
            if (active.current) {
                if (cause instanceof DomainCommandError && cause.confirmedRejected && cause.code !== 'access_denied')
                    setPending(null);
                setError(cause instanceof DomainCommandError ? cause.message : 'Não foi possível confirmar a correção. Repita a mesma operação.');
            }
        }
        finally {
            inFlight.current = false;
            if (active.current)
                setBusy(false);
        }
    }
    const disabled = busy || !!pending || !!receipt;
    useNavigationDraft(!receipt && (busy || !!pending || JSON.stringify(input) !== JSON.stringify(initial)));
    return <section aria-label="Correção versionada"><h4>Nova revisão da evidência</h4>
  <p>Revisão anterior {previous?.number ?? '—'} · resultado preservado: {detail.position.resultValue ?? 'Sem número'}</p>
  <label>Estado do dado corrigido<select disabled={disabled} value={input.estadoDado} onChange={e => setInput({ ...input, estadoDado: e.target.value as DraftInput['estadoDado'], valor: null })}><option value="valor">Valor</option><option value="indisponivel">Indisponível</option></select></label>
  {input.estadoDado === 'valor' && <label>Valor corrigido<input disabled={disabled} value={input.valor ?? ''} onChange={e => setInput({ ...input, valor: e.target.value || null })}/></label>}
  <label>Fonte corrigida<input disabled={disabled} maxLength={500} value={input.fonte} onChange={e => setInput({ ...input, fonte: e.target.value })}/></label>
  <label>Período da fonte corrigida<input type="date" disabled={disabled} value={input.periodoFonte} onChange={e => setInput({ ...input, periodoFonte: e.target.value })}/></label>
  <label>Justificativa da correção<textarea disabled={disabled} maxLength={1000} value={input.motivo} onChange={e => setInput({ ...input, motivo: e.target.value })}/></label>
  {error && <p role="alert">{error}</p>}
  {receipt ? <p role="status">Nova revisão enviada. Resultado sintético: {receipt.resultValue ?? 'Sem número'}. Nova conferência necessária.</p> : <button type="button" disabled={busy} onClick={() => void execute()}>{pending ? 'Repetir operação pendente' : 'Enviar nova revisão'}</button>}
 </section>;
}
type CamOperation = {
    id: string;
    version: number;
    action: 'correction' | 'unavailable';
    reason: string;
    reference: string;
};
export function CamDecisionForm({ client, context, detail, onConfirmed }: {
    client: SupabaseClient;
    context: AuthorizedContext;
    detail: PositionDetail;
    onConfirmed: (receipt: CommandReceipt) => void;
}) {
    const [pending, setPending] = useState<CamOperation | null>(null);
    const [busy, setBusy] = useState(false);
    const [reason, setReason] = useState('');
    const [reference, setReference] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [receipt, setReceipt] = useState<CommandReceipt | null>(null);
    const active = useRef(true);
    const inFlight = useRef(false);
    useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
    useNavigationDraft(!receipt && (busy || !!pending || !!reason || !!reference));
    if (detail.position.escopoId !== context.escopoId)
        return <p>Selecione o contexto CAM correspondente a este alvo para registrar uma decisão.</p>;
    const accepted = detail.decisions.some(d => d.revisionId === detail.position.revisionId && d.type === 'validar');
    const decided = detail.decisions.some(d => d.revisionId === detail.position.revisionId && d.type === 'decidir_indisponibilidade');
    async function execute(action: CamOperation['action']) {
        if (inFlight.current || receipt)
            return;
        setError(null);
        if (!pending && (!reason.trim() || reason.trim().length > 1000 || (action === 'unavailable' && (!reference.trim() || reference.trim().length > 500)))) {
            setError('Informe motivo CAM e, para indisponibilidade, referência de demonstração.');
            return;
        }
        const operation = pending ?? { id: crypto.randomUUID(), version: detail.position.version, action, reason: reason.trim(), reference: reference.trim() };
        setPending(operation);
        setBusy(true);
        inFlight.current = true;
        try {
            const command = toCommandContext(context);
            const confirmed = operation.action === 'correction' ? await authorizeCorrection(client, command, detail.position.id, operation.version, operation.reason, operation.id) : await decideUnavailability(client, command, detail.position.id, operation.version, operation.reference, operation.reason, operation.id);
            if (!active.current)
                return;
            if (confirmed.revisionId !== detail.position.revisionId)
                throw new DomainCommandError('invalid_input');
            setPending(null);
            setReceipt(confirmed);
            onConfirmed(confirmed);
        }
        catch (cause) {
            if (active.current) {
                if (cause instanceof DomainCommandError && cause.confirmedRejected && cause.code !== 'access_denied')
                    setPending(null);
                setError(cause instanceof DomainCommandError ? cause.message : 'Não foi possível confirmar a decisão CAM. Repita a mesma operação.');
            }
        }
        finally {
            inFlight.current = false;
            if (active.current)
                setBusy(false);
        }
    }
    return <section aria-label="Decisão CAM"><p>Decisão acadêmica sintética, sem efeito institucional ou financeiro.</p>
  {detail.position.status === 'validada' && accepted && !receipt && <>
   <label>Motivo CAM<textarea disabled={busy || !!pending} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}/></label>
   <label>Referência de demonstração<input disabled={busy || !!pending} maxLength={500} value={reference} onChange={e => setReference(e.target.value)}/></label>
   <button type="button" disabled={busy || !!pending} onClick={() => void execute('correction')}>Autorizar retificação</button>
   {detail.position.estadoDado === 'indisponivel' && !decided && <button type="button" disabled={busy || !!pending} onClick={() => void execute('unavailable')}>Decidir indisponibilidade</button>}
  </>}
  {pending && !busy && <button type="button" onClick={() => void execute(pending.action)}>Repetir operação pendente</button>}
  {error && <p role="alert">{error}</p>}{receipt && <p role="status">Decisão CAM confirmada: {receipt.status}.</p>}
 </section>;
}
