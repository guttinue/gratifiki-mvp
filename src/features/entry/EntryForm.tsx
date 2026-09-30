import { useRef, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PilotContext, SubmitResult } from "../../lib/types";
import { entryErrorMessage, formatDemoDecimal, submitDemoEntry } from "./entryApi";

interface EntryFormProps {
  client: SupabaseClient;
  context: PilotContext;
  onSubmitted: (result: SubmitResult) => void | Promise<void>;
}

function newOperationId(): string {
  return globalThis.crypto.randomUUID();
}

export function EntryForm({ client, context, onSubmitted }: EntryFormProps) {
  const [valueText, setValueText] = useState("");
  const [operationId, setOperationId] = useState(newOperationId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const operationIdRef = useRef(operationId);
  operationIdRef.current = operationId;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    let result: SubmitResult;
    try {
      result = await submitDemoEntry(client, {
        competenciaId: context.competenciaId,
        indicadorId: context.indicadorId,
        escopoId: context.escopoId,
        valueText,
        operationId: operationIdRef.current,
      });
    } catch (error) {
      setErrorMessage(entryErrorMessage(error));
      setIsSubmitting(false);
      return;
    }

    setValueText("");
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
            type="text"
            value={valueText}
          />
          <button disabled={isSubmitting} type="submit">
            {isSubmitting ? "Enviando…" : "Registrar entrada"}
          </button>
        </div>
        <p className="field-hint">Envie um número não negativo. A validação e o resultado são produzidos pelo servidor local.</p>
        {errorMessage && <p className="inline-error" role="alert">{errorMessage}</p>}
        {successMessage && <p className="success-message" role="status">{successMessage}</p>}
      </form>
    </section>
  );
}
