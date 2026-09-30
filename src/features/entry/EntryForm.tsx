import { useRef, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PilotContext, SubmitResult } from "../../lib/types";
import { entryErrorMessage, formatDemoDecimal, isDefinitelyRejectedEntry, isUncertainEntryError, submitDemoEntry } from "./entryApi";
import { clearPendingEntry, loadPendingEntry, savePendingEntry } from "./pendingEntry";

interface EntryFormProps {
  client: SupabaseClient;
  context: PilotContext;
  onSubmitted: (result: SubmitResult) => void | Promise<void>;
}

function newOperationId(): string {
  return globalThis.crypto.randomUUID();
}

function getInitialOperation(context: PilotContext) {
  const freshOperationId = newOperationId();
  try {
    const pending = loadPendingEntry(context);
    if (pending) {
      return {
        operationId: pending.operationId,
        valueText: pending.valueText,
        isRetryPending: true,
        isStorageUnavailable: false,
        errorMessage: "Uma operação anterior ficou sem confirmação. O valor foi preservado; repita a mesma operação para evitar duplicação.",
      };
    }

    return {
      operationId: freshOperationId,
      valueText: "",
      isRetryPending: false,
      isStorageUnavailable: false,
      errorMessage: null,
    };
  } catch {
    return {
      operationId: freshOperationId,
      valueText: "",
      isRetryPending: false,
      isStorageUnavailable: true,
      errorMessage: "O estado pendente da operação não pôde ser lido neste navegador. O envio está bloqueado para evitar duplicações; reative o armazenamento local e recarregue a página.",
    };
  }
}

export function EntryForm({ client, context, onSubmitted }: EntryFormProps) {
  const [initialOperation] = useState(() => getInitialOperation(context));
  const [valueText, setValueText] = useState(initialOperation.valueText);
  const [operationId, setOperationId] = useState(initialOperation.operationId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRetryPending, setIsRetryPending] = useState(initialOperation.isRetryPending);
  const [isStorageUnavailable, setIsStorageUnavailable] = useState(initialOperation.isStorageUnavailable);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialOperation.errorMessage);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const operationIdRef = useRef(operationId);
  operationIdRef.current = operationId;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const submittedValue = valueText;
    const submittedOperationId = operationIdRef.current;

    if (isStorageUnavailable) {
      setErrorMessage("O envio permanece bloqueado porque o estado pendente não pôde ser lido neste navegador.");
      setIsSubmitting(false);
      return;
    }

    try {
      savePendingEntry(context, {
        operationId: submittedOperationId,
        valueText: submittedValue,
      });
    } catch {
      setErrorMessage("Não foi possível preservar a operação neste navegador. A entrada não foi enviada; reative o armazenamento local e recarregue a página.");
      setIsStorageUnavailable(true);
      setIsSubmitting(false);
      return;
    }

    let result: SubmitResult;
    try {
      result = await submitDemoEntry(client, {
        competenciaId: context.competenciaId,
        indicadorId: context.indicadorId,
        escopoId: context.escopoId,
        valueText: submittedValue,
        operationId: submittedOperationId,
      });
    } catch (error) {
      const responseIsUncertain =
        isUncertainEntryError(error) || (isRetryPending && !isDefinitelyRejectedEntry(error));
      let nextErrorMessage = entryErrorMessage(error);

      if (responseIsUncertain) {
        setIsRetryPending(true);
      } else {
        try {
          clearPendingEntry(context, submittedOperationId);
          setIsRetryPending(false);
        } catch {
          setIsRetryPending(true);
          nextErrorMessage += " O estado local não pôde ser atualizado; mantenha o valor e repita a mesma operação.";
        }
      }

      setErrorMessage(nextErrorMessage);
      setIsSubmitting(false);
      return;
    }

    try {
      clearPendingEntry(context, submittedOperationId);
    } catch {
      setSuccessMessage(`Entrada registrada. Resultado sintético persistido: ${formatDemoDecimal(result.resultValue)}.`);
      setErrorMessage("O servidor confirmou o resultado, mas o estado pendente não pôde ser limpo neste navegador. Mantenha o valor e repita a mesma operação antes de iniciar outra.");
      setIsRetryPending(true);
      setIsSubmitting(false);
      try {
        await onSubmitted(result);
      } catch {
        setErrorMessage("O resultado foi confirmado, mas o histórico não pôde ser atualizado. Mantenha a operação e recarregue a consulta.");
      }
      return;
    }

    setValueText("");
    setIsRetryPending(false);
    setSuccessMessage(`Entrada registrada. Resultado sintético persistido: ${formatDemoDecimal(result.resultValue)}.`);
    const nextOperationId = newOperationId();
    operationIdRef.current = nextOperationId;
    setOperationId(nextOperationId);
    setIsSubmitting(false);

    try {
      await onSubmitted(result);
    } catch {
      setErrorMessage("A entrada foi registrada, mas o histórico não pôde ser atualizado. Recarregue a consulta.");
    }
  }

  return (
    <section aria-labelledby="entry-title" className="entry-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">NOVA ENTRADA</p>
          <h2 id="entry-title">Entrada do indicador</h2>
        </div>
        <span className="role-badge">Área técnica</span>
      </div>

      <div aria-label="Contexto sintético autorizado" className="context-summary" role="group">
        <div><span>Competência</span><strong>{context.competenciaCodigo}</strong></div>
        <div><span>Indicador</span><strong>{context.indicadorCodigo}</strong></div>
        <div><span>Escopo</span><strong>{context.escopoCodigo}</strong></div>
      </div>

      <form className="entry-form" onSubmit={handleSubmit}>
        <label htmlFor="demo-value">Valor para o indicador</label>
        <div className="input-row">
          <input
            autoComplete="off"
            id="demo-value"
            inputMode="decimal"
            onChange={(event) => setValueText(event.target.value)}
            disabled={isSubmitting || isRetryPending || isStorageUnavailable}
            type="text"
            value={valueText}
          />
          <button disabled={isSubmitting || isStorageUnavailable} type="submit">
            {isSubmitting ? "Enviando…" : isRetryPending ? "Repetir mesma operação" : "Registrar entrada"}
          </button>
        </div>
        <p className="field-hint">Envie um número não negativo. A validação e o resultado são produzidos pelo servidor local.</p>
        {errorMessage && <p className="inline-error" role="alert">{errorMessage}</p>}
        {successMessage && <p className="success-message" role="status">{successMessage}</p>}
      </form>
    </section>
  );
}
