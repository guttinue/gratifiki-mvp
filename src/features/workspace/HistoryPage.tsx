import { useMemo, useState } from "react";
import type { PilotEntry } from "../../lib/types";
import { EntryDetail } from "./EntryDetail";
import { formatAuditAction, formatTimestamp } from "./workspaceModel";

interface HistoryPageProps {
  entries: PilotEntry[];
  isLoading: boolean;
  errorMessage: string | null;
  onRetry: () => void;
  selectedEntryId: string | null;
  onSelectEntry: (entryId: string | null) => void;
}

export function HistoryPage({ entries, isLoading, errorMessage, onRetry, selectedEntryId, onSelectEntry }: HistoryPageProps) {
  const [searchText, setSearchText] = useState("");
  const visibleEvents = useMemo(() => entries
    .flatMap((entry) => entry.auditEvents.map((event) => ({ entry, event })))
    .sort((left, right) => Date.parse(right.event.occurredAt) - Date.parse(left.event.occurredAt) || left.event.id.localeCompare(right.event.id))
    .filter(({ entry, event }) => !searchText.trim() || `${event.id} ${event.action} ${formatAuditAction(event.action)} ${entry.id}`.toLocaleLowerCase("pt-BR").includes(searchText.trim().toLocaleLowerCase("pt-BR"))),
  [entries, searchText]);
  const selectedRecord = visibleEvents.find(({ entry }) => entry.id === selectedEntryId) ?? null;

  return (
    <section aria-labelledby="history-heading" className="workspace-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">TRILHA DE AUDITORIA</p>
          <h1 id="history-heading">Histórico e auditoria</h1>
          <p>Eventos e horários de envio registrados para as entradas autorizadas.</p>
        </div>
        <span className="page-context">Eventos persistidos <span aria-hidden="true">·</span> somente leitura</span>
      </div>

      <section aria-label="Eventos de auditoria" className="data-card history-table-card">
        <div className="card-heading list-heading">
          <div><p className="eyebrow">EVENTOS DISPONÍVEIS</p><h2>Atividade registrada</h2></div>
          {!isLoading && !errorMessage && <span className="count-chip">{visibleEvents.length} {visibleEvents.length === 1 ? "evento" : "eventos"}</span>}
        </div>
        <div className="table-filters history-filters">
          <label className="search-field">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <span className="sr-only">Buscar eventos por identificador ou ação</span>
            <input
              aria-label="Buscar eventos por identificador ou ação"
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Buscar identificador ou ação"
              type="search"
              value={searchText}
            />
          </label>
        </div>

        {isLoading ? (
          <div className="table-state" role="status" aria-live="polite">Carregando os eventos autorizados…</div>
        ) : errorMessage ? (
          <div className="table-state error-state" role="alert">
            <p>{errorMessage}</p>
            <button className="secondary-button" onClick={onRetry} type="button">Tentar novamente</button>
          </div>
        ) : visibleEvents.length === 0 ? (
          <div className="table-state empty-state">
            {entries.length === 0
              ? "Nenhum evento de auditoria disponível para este contexto."
              : "Nenhum evento de auditoria disponível para os filtros aplicados."}
          </div>
        ) : (
          <div className="table-scroll">
            <table aria-label="Eventos de auditoria autorizados">
              <thead><tr><th scope="col">Ação registrada</th><th scope="col">Entrada</th><th scope="col">Horário do evento</th><th scope="col"><span className="sr-only">Detalhe</span></th></tr></thead>
              <tbody>
                {visibleEvents.map(({ entry, event }) => (
                  <tr data-entry-id={entry.id} key={event.id}>
                    <td><span className="event-name">{formatAuditAction(event.action)}</span><code className="event-code">{event.id}</code></td>
                    <td><code className="entry-code">{entry.id}</code></td>
                    <td><time dateTime={event.occurredAt}>{formatTimestamp(event.occurredAt)}</time></td>
                    <td><button aria-expanded={selectedEntryId === entry.id} aria-label={`Ver detalhe da entrada ${entry.id}`} className="detail-link" onClick={() => onSelectEntry(entry.id)} type="button">Detalhes</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="table-caption">O horário exibido é o horário do evento de envio persistido.</p>
      </section>

      {selectedRecord && <EntryDetail auditAction={selectedRecord.event.action} entry={selectedRecord.entry} />}
    </section>
  );
}
