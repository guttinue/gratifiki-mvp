import type { ResultMemory as ResultMemoryRecord } from "../../lib/types";
import { formatDemoDecimal } from "./entryApi";

interface ResultMemoryProps {
  items: ResultMemoryRecord[];
  isLoading: boolean;
  errorMessage: string | null;
}

export function ResultMemory({ items, isLoading, errorMessage }: ResultMemoryProps) {
  return (
    <section aria-busy={isLoading} aria-labelledby="history-title" className="history-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">CONSULTA AUTORIZADA</p>
          <h2 id="history-title">Histórico do piloto</h2>
        </div>
        <span className="history-count">{items.length} {items.length === 1 ? "registro" : "registros"}</span>
      </div>

      {isLoading && <p className="quiet-copy">Carregando registros persistidos…</p>}
      {errorMessage && <p className="inline-error" role="alert">{errorMessage}</p>}
      {!isLoading && !errorMessage && items.length === 0 && (
        <p className="quiet-copy">Nenhuma entrada persistida para este contexto.</p>
      )}

      {items.length > 0 && (
        <div className="history-list">
          {items.map((item) => (
            <article
              aria-label={`Entrada de ${formatDemoDecimal(item.inputValue)} — resultado persistido de ${formatDemoDecimal(item.resultValue)}`}
              className="memory-row"
              data-entry-id={item.entryId}
              data-operation-id={item.operationId}
              key={item.resultId}
            >
              <div className="memory-result">
                <p className="eyebrow">RESULTADO SINTÉTICO</p>
                <strong>{formatDemoDecimal(item.resultValue)}</strong>
                <span>Valor informado: {formatDemoDecimal(item.inputValue)}</span>
              </div>
              <dl className="memory-details">
                <div><dt>Competência</dt><dd>{item.competenciaCodigo}</dd></div>
                <div><dt>Indicador</dt><dd>{item.indicadorCodigo}</dd></div>
                <div><dt>Fator demonstrativo</dt><dd>{formatDemoDecimal(item.factor)}</dd></div>
                <div><dt>Regra</dt><dd>DEMO · versão {item.ruleVersion}</dd></div>
                <div><dt>Estado</dt><dd>{item.state}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
