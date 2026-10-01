import { useMemo, useState, type ReactNode } from "react";
import type { PilotContext, PilotEntry } from "../../lib/types";
import { EntryDetail } from "./EntryDetail";
import { filterPilotEntries, formatTimestamp, STATUS_FILTERS, STATUS_LABELS, type EntryStateFilter } from "./workspaceModel";

interface EntriesPageProps {
  context: PilotContext;
  entries: PilotEntry[];
  isLoading: boolean;
  errorMessage: string | null;
  onRetry: () => void;
  selectedEntryId: string | null;
  onSelectEntry: (entryId: string | null) => void;
  entryForm?: ReactNode;
}

export function EntriesPage({
  context,
  entries,
  isLoading,
  errorMessage,
  onRetry,
  selectedEntryId,
  onSelectEntry,
  entryForm,
}: EntriesPageProps) {
  const [searchText, setSearchText] = useState("");
  const [stateFilter, setStateFilter] = useState<EntryStateFilter>("all");
  const visibleEntries = useMemo(
    () => filterPilotEntries(entries, searchText, stateFilter),
    [entries, searchText, stateFilter],
  );
  const selectedEntry = visibleEntries.find(({ id }) => id === selectedEntryId) ?? null;

  return (
    <section aria-labelledby="entries-heading" className="workspace-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">REGISTROS DO CONTEXTO</p>
          <h1 id="entries-heading">Entradas</h1>
          <p>Consulte valores, estados e resultados persistidos para este indicador.</p>
        </div>
        <span className="page-context">{context.indicadorCodigo} <span aria-hidden="true">·</span> {context.escopoCodigo}</span>
      </div>

      {context.papel === "cam" ? (
        <aside className="read-only-note">
          <span aria-hidden="true">i</span>
          <p><strong>Perfil CAM · somente leitura</strong><span>Esta conta pode consultar os registros autorizados. O estado pendente não representa aprovação.</span></p>
        </aside>
      ) : entryForm ? (
        <div className="entry-form-panel">{entryForm}</div>
      ) : null}

      <section aria-labelledby="entries-table-heading" className="data-card entries-table-card">
        <div className="card-heading list-heading">
          <div><p className="eyebrow">CONSULTA AUTORIZADA</p><h2 id="entries-table-heading">Registros de entrada</h2></div>
          {!isLoading && !errorMessage && <span className="count-chip">{visibleEntries.length} {visibleEntries.length === 1 ? "registro" : "registros"}</span>}
        </div>

        <div className="table-filters">
          <label className="search-field">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <span className="sr-only">Buscar por identificador ou valor</span>
            <input
              aria-label="Buscar por identificador ou valor"
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Buscar por identificador ou valor"
              type="search"
              value={searchText}
            />
          </label>
          <label className="filter-field">
            <span className="sr-only">Filtrar por estado</span>
            <select aria-label="Filtrar por estado" onChange={(event) => setStateFilter(event.target.value as EntryStateFilter)} value={stateFilter}>
              {STATUS_FILTERS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>

        {isLoading ? (
          <div className="table-state" role="status" aria-live="polite">Carregando as entradas autorizadas…</div>
        ) : errorMessage ? (
          <div className="table-state error-state" role="alert">
            <p>{errorMessage}</p>
            <button className="secondary-button" onClick={onRetry} type="button">Tentar novamente</button>
          </div>
        ) : entries.length === 0 ? (
          <div className="table-state empty-state">Nenhuma entrada disponível neste contexto autorizado.</div>
        ) : visibleEntries.length === 0 ? (
          <div className="table-state empty-state">Nenhuma entrada corresponde aos filtros aplicados.</div>
        ) : (
          <div className="table-scroll">
            <table aria-label="Entradas autorizadas do contexto">
              <thead>
                <tr><th scope="col">Identificador</th><th scope="col">Valor informado</th><th scope="col">Resultado persistido</th><th scope="col">Estado atual</th><th scope="col">Horário do envio</th><th scope="col"><span className="sr-only">Detalhe</span></th></tr>
              </thead>
              <tbody>
                {visibleEntries.map((entry) => (
                  <tr data-entry-id={entry.id} key={entry.id}>
                    <td><code className="entry-code">{entry.id}</code></td>
                    <td><code>{entry.inputValue}</code></td>
                    <td>{entry.results.length ? entry.results.map(({ resultId, resultValue }) => <code className="result-code" key={resultId}>{resultValue}</code>) : <span className="muted-value">Sem resultado</span>}</td>
                    <td><span className={`status-badge status-${entry.state}`}>{STATUS_LABELS[entry.state]}</span></td>
                    <td>{entry.submittedAt ? <time dateTime={entry.submittedAt}>{formatTimestamp(entry.submittedAt)}</time> : <span className="muted-value">Indisponível</span>}</td>
                    <td><button aria-expanded={selectedEntryId === entry.id} aria-label={`${selectedEntryId === entry.id ? "Ocultar detalhe" : "Ver detalhe"} da entrada ${entry.id}`} className="detail-link" onClick={() => onSelectEntry(selectedEntryId === entry.id ? null : entry.id)} type="button">{selectedEntryId === entry.id ? "Fechar" : "Detalhes"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && !errorMessage && entries.length > 0 && (
          <p className="table-caption">Valores e estados exibidos conforme persistidos; resultados não são recalculados nesta tela.</p>
        )}
      </section>

      {selectedEntry && <EntryDetail entry={selectedEntry} />}
    </section>
  );
}
