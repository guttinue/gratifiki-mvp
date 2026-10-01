import { useEffect, useRef } from "react";
import type { PilotEntry } from "../../lib/types";
import { formatTimestamp, STATUS_LABELS } from "./workspaceModel";

interface EntryDetailProps {
  entry: PilotEntry;
  auditAction?: string;
}

export function EntryDetail({ entry, auditAction }: EntryDetailProps) {
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    detailRef.current?.focus();
  }, [entry.id]);

  return (
    <section
      aria-label={`Detalhe da entrada ${entry.id}`}
      className="entry-detail card"
      data-entry-id={entry.id}
      ref={detailRef}
      tabIndex={-1}
    >
      <div className="card-heading detail-heading">
        <div>
          <p className="eyebrow">REGISTRO PERSISTIDO</p>
          <h2>Detalhe da entrada</h2>
        </div>
        <span className={`status-badge status-${entry.state}`}>{STATUS_LABELS[entry.state]}</span>
      </div>

      <dl className="detail-facts">
        <div><dt>Identificador da entrada</dt><dd><code>{entry.id}</code></dd></div>
        <div><dt>Valor informado</dt><dd><code>{entry.inputValue}</code></dd></div>
        <div><dt>Competência</dt><dd>{entry.competenciaCodigo}</dd></div>
        <div><dt>Indicador</dt><dd>{entry.indicadorCodigo}</dd></div>
        <div><dt>Escopo autorizado</dt><dd>{entry.escopoCodigo}</dd></div>
        {auditAction && <div><dt>Ação técnica do evento</dt><dd><code>{auditAction}</code></dd></div>}
        <div><dt>Revisão persistida</dt><dd>{entry.revision}</dd></div>
        <div><dt>Operação</dt><dd><code>{entry.operationId}</code></dd></div>
        <div>
          <dt>Horário do envio</dt>
          <dd>{entry.submittedAt ? <time dateTime={entry.submittedAt}>{formatTimestamp(entry.submittedAt)}</time> : formatTimestamp(null)}</dd>
        </div>
      </dl>

      <div className="memory-section">
        <div className="section-subheading">
          <div>
            <p className="eyebrow">ENTRADA → RESULTADO</p>
            <h3>Memória persistida</h3>
          </div>
          <span>{entry.results.length} {entry.results.length === 1 ? "resultado" : "resultados"}</span>
        </div>
        {entry.results.length === 0 ? (
          <p className="empty-inline">Nenhum resultado persistido para esta entrada.</p>
        ) : (
          <div className="result-memory-list">
            {entry.results.map((result) => (
              <article aria-label={`Resultado persistido da entrada ${entry.id}`} className="result-memory" key={result.resultId}>
                <div className="result-number">
                  <span>Resultado persistido</span>
                  <strong><code>{result.resultValue}</code></strong>
                </div>
                <dl className="memory-facts">
                  <div><dt>Valor de entrada</dt><dd><code>{result.inputValue}</code></dd></div>
                  <div><dt>Estado no resultado</dt><dd>{STATUS_LABELS[result.state]}</dd></div>
                  <div><dt>Regra persistida</dt><dd><code>{result.ruleId}</code></dd></div>
                  <div><dt>Versão da regra</dt><dd>{result.ruleVersion}</dd></div>
                  <div><dt>Fator persistido</dt><dd><code>{result.factor}</code></dd></div>
                  <div><dt>Operação</dt><dd><code>{result.operationId}</code></dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </div>

      <p className="detail-footnote">O estado e o resultado são exibidos conforme persistidos. O status pendente não representa aprovação.</p>
    </section>
  );
}
