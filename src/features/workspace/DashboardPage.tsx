import type { PilotContext, PilotEntry } from "../../lib/types";
import { formatAuditAction, formatTimestamp, PAGE_LABELS, STATUS_LABELS } from "./workspaceModel";
import { getWorkspaceMetrics } from "./workspaceModel";
import type { WorkspacePage } from "./workspaceModel";
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthorizedContext,DashboardData,Page,PositionFilter,PositionSummary } from '../pilot/types';
import { useEffect,useState } from 'react';
import { toCommandContext } from '../context/contextApi';
import { loadDashboard } from './academicDashboardApi';
import { listPositions } from '../submission/positionApi';
type AcademicDashboardProps={client:SupabaseClient;context:AuthorizedContext};
export function AcademicDashboard(props:AcademicDashboardProps){return <ContextDashboard key={props.context.key} {...props}/>;}
function ContextDashboard({client,context}:AcademicDashboardProps){
 const [data,setData]=useState<DashboardData|null>(null);const [filter,setFilter]=useState<PositionFilter|null>(null);const [rows,setRows]=useState<Page<PositionSummary>|null>(null);const [error,setError]=useState(false);const [listError,setListError]=useState(false);const [retry,setRetry]=useState(0);
 useEffect(()=>{let current=true;setData(null);setError(false);void loadDashboard(client,toCommandContext(context)).then(value=>{if(current)setData(value);}).catch(()=>{if(current)setError(true);});return()=>{current=false;};},[client,context,retry]);
 useEffect(()=>{let current=true;setRows(null);setListError(false);if(filter)void listPositions(client,toCommandContext(context),filter).then(value=>{if(current)setRows(value);}).catch(()=>{if(current)setListError(true);});return()=>{current=false;};},[client,context,filter,retry]);
 return <section aria-label="Painel autorizado"><h2>Andamento autorizado</h2>
 {error?<p role="alert">Não foi possível confirmar os contadores autorizados.</p>:!data?<p role="status">Carregando contadores…</p>:<><p>Universo: {data.expected} · Recebidas: {data.received} · Conferidas: {data.reviewed} · Indisponíveis: {data.unavailable}</p><p>Indisponíveis são subconjunto de recebidas, não valores zero. Denominador: {data.expected} posições autorizadas.</p><div>{data.cards.map(card=>card.filter?<button key={card.id} type="button" onClick={()=>setFilter(card.filter)}>{card.label}: {card.count} de {data.expected}</button>:<p key={card.id}>{card.label}: {card.count} de {data.expected}</p>)}</div></>}
 {filter&&<section aria-label="Posições do cartão">{listError?<p role="alert">Não foi possível confirmar o filtro do cartão.</p>:!rows?<p role="status">Carregando posições do cartão…</p>:<><p>Posições no filtro: {rows.total}</p><ul>{rows.items.map(row=><li key={row.id}>{row.escopoCodigo} · {row.status}</li>)}</ul><button type="button" disabled={filter.page===1} onClick={()=>setFilter({...filter,page:filter.page-1})}>Página anterior do cartão</button><span> Página {filter.page} </span><button type="button" disabled={filter.page*filter.pageSize>=rows.total} onClick={()=>setFilter({...filter,page:filter.page+1})}>Próxima página do cartão</button></>}</section>}
 <button type="button" onClick={()=>setRetry(n=>n+1)}>Atualizar painel</button></section>;
}

interface DashboardPageProps {
  context: PilotContext;
  entries: PilotEntry[];
  isLoading: boolean;
  errorMessage: string | null;
  onNavigate: (page: WorkspacePage) => void;
  onRetry?: () => void;
}

const states = ["pendente", "validada", "corrigida", "fechada", "invalidada"] as const;

function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-panel error-panel" role="alert">
      <div>
        <strong>Não foi possível confirmar os dados</strong>
        <p>{message}</p>
      </div>
      {onRetry && <button className="secondary-button" onClick={onRetry} type="button">Tentar novamente</button>}
    </div>
  );
}

export function DashboardPage({ context, entries, isLoading, errorMessage, onNavigate, onRetry }: DashboardPageProps) {
  // Explicit legacy adapter: these entries and metrics never serve academic roles.
  return <LegacyDashboardPage context={context} entries={entries} isLoading={isLoading} errorMessage={errorMessage} onNavigate={onNavigate} onRetry={onRetry}/>;
}
function LegacyDashboardPage({ context, entries, isLoading, errorMessage, onNavigate, onRetry }: DashboardPageProps) {
  const metrics = getWorkspaceMetrics(entries);
  const stateCounts = states.map((state) => ({
    state,
    count: entries.filter((entry) => entry.state === state).length,
  }));
  const recentEvents = entries
    .flatMap((entry) => entry.auditEvents.map((event) => ({ entry, event })))
    .sort((left, right) => Date.parse(right.event.occurredAt) - Date.parse(left.event.occurredAt) || left.event.id.localeCompare(right.event.id))
    .slice(0, 4);

  return (
    <section aria-labelledby="overview-heading" className="workspace-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">OPERAÇÃO DO PILOTO</p>
          <h1 id="overview-heading">{PAGE_LABELS.overview}</h1>
          <p>Acompanhe registros e resultados persistidos no contexto autorizado.</p>
        </div>
        <span className="page-context">{context.competenciaCodigo} <span aria-hidden="true">·</span> {context.indicadorCodigo}</span>
      </div>

      {isLoading ? (
        <div className="state-panel loading-panel" role="status" aria-live="polite">
          <span className="loading-indicator" aria-hidden="true" />
          <p>Carregando os registros autorizados…</p>
        </div>
      ) : errorMessage ? (
        <ErrorPanel message={errorMessage} onRetry={onRetry} />
      ) : entries.length === 0 ? (
        <div className="empty-dashboard card">
          <div className="empty-icon" aria-hidden="true">＋</div>
          <p className="eyebrow">COMECE PELO PRIMEIRO REGISTRO</p>
          <h2>Ainda não há entradas neste contexto</h2>
          <p>Os indicadores e a atividade aparecerão aqui quando houver registros persistidos.</p>
          {context.papel === "area_tecnica" && (
            <button className="primary-button" onClick={() => onNavigate("entries")} type="button">Abrir Entradas</button>
          )}
          {context.papel === "cam" && <p className="empty-note">A área técnica pode enviar a primeira entrada neste piloto local.</p>}
        </div>
      ) : (
        <>
          <div aria-label="Métricas dos registros autorizados" className="metric-grid">
            <article className="metric-card">
              <span className="metric-label">Entradas</span>
              <strong className="metric-value">{metrics.entries}</strong>
              <span className="metric-note">Registros persistidos</span>
              <span aria-hidden="true" className="metric-icon">↗</span>
            </article>
            <article className="metric-card">
              <span className="metric-label">Resultados persistidos</span>
              <strong className="metric-value">{metrics.results}</strong>
              <span className="metric-note">Memórias vinculadas às entradas</span>
              <span aria-hidden="true" className="metric-icon">∑</span>
            </article>
            <article className="metric-card">
              <span className="metric-label">Pendentes</span>
              <strong className="metric-value">{metrics.pending}</strong>
              <span className="metric-note">Estado atual das entradas</span>
              <span aria-hidden="true" className="metric-icon">◷</span>
            </article>
            <article className="metric-card">
              <span className="metric-label">Eventos de auditoria</span>
              <strong className="metric-value">{metrics.events}</strong>
              <span className="metric-note">Eventos de envio visíveis</span>
              <span aria-hidden="true" className="metric-icon">◎</span>
            </article>
          </div>

          <div className="overview-grid">
            <section aria-label="Distribuição por estado" className="data-card state-distribution">
              <div className="card-heading">
                <div><p className="eyebrow">SITUAÇÃO ATUAL</p><h2>Distribuição por estado</h2></div>
                <span className="count-chip">{metrics.entries} entradas</span>
              </div>
              <ul className="state-list">
                {stateCounts.map(({ state, count }) => (
                  <li className="state-row" key={state}>
                    <span aria-hidden="true" className={`state-dot state-dot-${state}`} />
                    <span>{STATUS_LABELS[state]}</span>
                    <strong>{count}</strong>
                  </li>
                ))}
              </ul>
              <p className="card-footnote">Contagens calculadas sobre entradas visíveis neste contexto.</p>
            </section>

            <section aria-labelledby="activity-heading" className="data-card activity-card">
              <div className="card-heading">
                <div><p className="eyebrow">TRILHA REGISTRADA</p><h2 id="activity-heading">Atividade recente</h2></div>
                <button className="quiet-button" onClick={() => onNavigate("history")} type="button">Ver histórico <span aria-hidden="true">→</span></button>
              </div>
              {recentEvents.length === 0 ? (
                <p className="empty-inline">Nenhum evento de auditoria disponível.</p>
              ) : (
                <ol className="activity-list">
                  {recentEvents.map(({ entry, event }) => (
                    <li className="activity-item" data-entry-id={entry.id} key={event.id}>
                      <span aria-hidden="true" className="activity-marker" />
                      <div><strong>{formatAuditAction(event.action)}</strong><span>Entrada <code>{entry.id}</code></span><time dateTime={event.occurredAt}>{formatTimestamp(event.occurredAt)}</time></div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <section aria-labelledby="recent-entries-heading" className="data-card recent-entries-card">
            <div className="card-heading">
              <div><p className="eyebrow">REGISTROS MAIS RECENTES</p><h2 id="recent-entries-heading">Entradas recentes</h2></div>
              <button className="quiet-button" onClick={() => onNavigate("entries")} type="button">Ver entradas <span aria-hidden="true">→</span></button>
            </div>
            <div className="table-scroll">
              <table aria-label="Entradas recentes">
                <thead><tr><th scope="col">Identificador</th><th scope="col">Valor informado</th><th scope="col">Resultado persistido</th><th scope="col">Estado</th><th scope="col">Horário do envio</th></tr></thead>
                <tbody>
                  {entries.slice(0, 5).map((entry) => (
                    <tr data-entry-id={entry.id} key={entry.id}>
                      <td><code className="entry-code">{entry.id}</code></td>
                      <td><code>{entry.inputValue}</code></td>
                      <td>{entry.results.length ? entry.results.map(({ resultId, resultValue }) => <code className="result-code" key={resultId}>{resultValue}</code>) : <span className="muted-value">Sem resultado</span>}</td>
                      <td><span className={`status-badge status-${entry.state}`}>{STATUS_LABELS[entry.state]}</span></td>
                      <td>{entry.submittedAt ? <time dateTime={entry.submittedAt}>{formatTimestamp(entry.submittedAt)}</time> : <span className="muted-value">Indisponível</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
