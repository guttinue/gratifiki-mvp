import type { PilotContext, PilotEntry } from "../../lib/types";
import { formatAuditAction, formatTimestamp, PAGE_LABELS, STATUS_LABELS } from "./workspaceModel";
import { getWorkspaceMetrics } from "./workspaceModel";
import type { WorkspacePage } from "./workspaceModel";
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthorizedContext,ContextGroup,CycleChecklist,DashboardData,Page,PositionFilter,PositionSummary } from '../pilot/types';
import { useEffect,useState } from 'react';
import { toCommandContext } from '../context/contextApi';
import { loadDashboard } from './academicDashboardApi';
import { listPositions } from '../submission/positionApi';
import { loadCycleChecklist } from '../cycle/cycleApi';
import { loadGroupPositions, statusLabels, type GroupPosition } from '../batch/groupPositions';
import { loadUnitBatch } from '../batch/batchApi';
import { monthName, scopeName } from './displayNames';
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

// ---- Model 3 (V3): one dashboard per role over the whole group of indicators ----
type V3Data={kind:'positions';rows:GroupPosition[];returnReason:string|null}|{kind:'cycle';checklist:CycleChecklist};
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const byUnitAndIndicator=(a:GroupPosition,b:GroupPosition)=>compare(a.position.escopoCodigo,b.position.escopoCodigo)||compare(a.position.indicatorCode??'',b.position.indicatorCode??'');
// Each position keeps the context that listed it. For the technical area, the reason of the
// first returned one comes from its unit's batch, read with that unit's contexts only.
async function loadPanelPositions(client:SupabaseClient,group:ContextGroup):Promise<V3Data>{
 const rows=(await loadGroupPositions(client,group)).sort(byUnitAndIndicator);
 const returned=rows.find(row=>row.position.status==='devolvida');
 if(!returned||group.role!=='area_tecnica')return{kind:'positions',rows,returnReason:null};
 const unitId=returned.position.escopoId;
 const contexts=[...new Map(rows.filter(row=>row.position.escopoId===unitId).map(row=>[row.context.key,row.context])).values()];
 // The reason is a hint here; without it the step still points at the correction.
 const returnReason=await loadUnitBatch(client,contexts,unitId).then(batch=>batch.items.find(item=>item.positionId===returned.position.id)?.returnReason??null,()=>null);
 return{kind:'positions',rows,returnReason};
}
const cycleSteps=[['aberta','Aberta','Recebendo e conferindo'],['em_consolidacao','Consolidação','Revisão final da CAM'],['fechada','Fechada','Resultados congelados'],['publicada','Publicada','Visível aos gestores']] as const;
function NextStep({kicker,title,text,action,alert}:{kicker:string;title:string;text:string;action?:{label:string;go:()=>void};alert?:boolean}){
 return <section className={alert?'v3-next v3-next-alert':'v3-next'}><div><span className="v3-kicker">{kicker}</span><h3>{title}</h3><p>{text}</p></div>{action&&<button type="button" className="primary" onClick={action.go}>{action.label}</button>}</section>;
}
// Rows: the group's positions in unit-code then indicator-code order; one line per unit.
export function UnitStatusTable({rows,onOpenUnit}:{rows:GroupPosition[];onOpenUnit?:(unitId:string)=>void}){
 const sorted=[...rows].sort(byUnitAndIndicator);
 const indicators=[...new Map(sorted.map(({position})=>[position.indicatorCode??'',position.indicatorName])).entries()].sort(([a],[b])=>compare(a,b));
 const units=[...new Map(sorted.map(({position})=>[position.escopoId,position.escopoCodigo])).entries()];
 return <section aria-label="Situação por unidade" className="v3-panel"><h3>Situação por unidade</h3><div className="table-scroll"><table className="v3-table">
  <thead><tr><th scope="col">Unidade</th>{indicators.map(([code,name])=><th key={code} scope="col">{code}{name&&<span className="v3-cell-sub">{name}</span>}</th>)}<th scope="col" className="r">Aceitos</th>{onOpenUnit&&<th scope="col" className="r"><span className="sr-only">Ação</span></th>}</tr></thead>
  <tbody>{units.map(([id,code])=>{const unit=sorted.filter(({position})=>position.escopoId===id);
   return <tr key={id}><td><strong>{scopeName(code)}</strong></td>{indicators.map(([indicator])=>{const position=unit.find(row=>(row.position.indicatorCode??'')===indicator)?.position;
    return <td key={indicator}>{position?<span className={`v3-badge v3-st-${position.status}`}>{statusLabels[position.status]}</span>:'–'}</td>;})}
    <td className="r">{`${unit.filter(({position})=>position.status==='validada').length} de ${unit.length}`}</td>
    {onOpenUnit&&<td className="r"><button type="button" aria-label={`Abrir ${scopeName(code)}`} onClick={()=>onOpenUnit(id)}>Abrir</button></td>}</tr>;})}</tbody>
 </table></div></section>;
}
type GroupDashboardProps={client:SupabaseClient;group:ContextGroup;onNavigate:(destination:string)=>void;onOpenUnit?:(unitId:string)=>void;onOpenPosition?:(id:string)=>void};
export function AcademicV3Dashboard(props:GroupDashboardProps){return <GroupDashboard key={props.group.key} {...props}/>;}
function GroupDashboard({client,group,onNavigate,onOpenUnit,onOpenPosition}:GroupDashboardProps){
 const [data,setData]=useState<V3Data|null>(null);const [error,setError]=useState(false);const [retry,setRetry]=useState(0);
 useEffect(()=>{let current=true;setData(null);setError(false);
  const load=group.role==='cam'?loadCycleChecklist(client,toCommandContext(group.contexts[0])).then((checklist):V3Data=>({kind:'cycle',checklist})):loadPanelPositions(client,group);
  void load.then(value=>{if(current)setData(value);}).catch(()=>{if(current)setError(true);});return()=>{current=false;};},[client,group,retry]);
 const openUnit=(unitId:string)=>onOpenUnit?onOpenUnit(unitId):onNavigate('preenchimento');
 const openPosition=(id:string)=>onOpenPosition?onOpenPosition(id):onNavigate('conferencia');
 return <section aria-label="Painel autorizado" className="v3-page">
 {error?<p role="alert">Não foi possível confirmar os contadores autorizados.</p>:!data?<p role="status">Carregando contadores…</p>
  :data.kind==='cycle'?<CamPanel checklist={data.checklist} onNavigate={onNavigate}/>
  :group.role==='revisor_tecnico'?<ReviewerPanel rows={data.rows} onOpenPosition={openPosition}/>:<TechnicalPanel data={data} competence={group.competenciaCodigo} onOpenUnit={openUnit}/>}
 <button type="button" onClick={()=>setRetry(n=>n+1)}>Atualizar painel</button></section>;
}
function TechnicalPanel({data,competence,onOpenUnit}:{data:Extract<V3Data,{kind:'positions'}>;competence:string;onOpenUnit:(unitId:string)=>void}){
 const returned=data.rows.find(({position})=>position.status==='devolvida')?.position;
 const todo=data.rows.filter(({position})=>position.status==='ausente'||position.status==='rascunho');
 const next=todo[0]?.position;
 return <>{returned?<NextStep alert kicker="Devolvida pelo revisor" title={`Corrigir ${scopeName(returned.escopoCodigo)} · ${returned.indicatorName??returned.indicatorCode??''}`} text={data.returnReason??'Abra o preenchimento para ver o motivo.'} action={{label:'Abrir correção',go:()=>onOpenUnit(returned.escopoId)}}/>
  :next?<NextStep kicker="Próximo passo" title={`Preencher ${scopeName(next.escopoCodigo)}`} text={`${todo.length} de ${data.rows.length} indicadores ainda não foram enviados.`} action={{label:'Abrir preenchimento',go:()=>onOpenUnit(next.escopoId)}}/>
  :<NextStep kicker="Tudo enviado" title={`Seus indicadores de ${monthName(competence)} estão com o revisor`} text="Se algum for devolvido, ele volta para o preenchimento com o motivo."/>}
  <UnitStatusTable rows={data.rows} onOpenUnit={onOpenUnit}/></>;
}
// "First in the queue", not "oldest": PositionSummary carries no submission date.
function ReviewerPanel({rows,onOpenPosition}:{rows:GroupPosition[];onOpenPosition:(id:string)=>void}){
 const waiting=rows.filter(({position})=>position.status==='enviada'||position.status==='em_revisao');const first=waiting[0]?.position;
 return <>{first?<NextStep kicker="Próximo passo" title={`${waiting.length} ${waiting.length>1?'entradas aguardam':'entrada aguarda'} sua conferência`} text={`A primeira da fila é ${scopeName(first.escopoCodigo)} · ${first.indicatorName??first.indicatorCode??''}.`} action={{label:'Conferir agora',go:()=>onOpenPosition(first.id)}}/>
  :<NextStep kicker="Fila vazia" title="Nada aguardando você" text="Quando a área técnica enviar, a entrada aparece aqui."/>}
  <UnitStatusTable rows={rows}/></>;
}
function CamPanel({checklist,onNavigate}:{checklist:CycleChecklist;onNavigate:(destination:string)=>void}){
 const current=checklist.publication==='publicada_demo'?3:checklist.state==='fechada'?2:checklist.state==='em_consolidacao'?1:0;
 const ready=checklist.ready??checklist.reviewed;const open=checklist.blockers.length;
 return <><ol aria-label="Etapas da competência" className="v3-stepper">{cycleSteps.map(([id,label,hint],index)=><li key={id} className={index<current?'done':index===current?'current':''} aria-current={index===current?'step':undefined}><b>{label}</b>{hint}</li>)}</ol>
  <section className="v3-panel"><div className="v3-metrics"><div className="v3-metric v3-metric-lead"><span className="v3-label" id="v3-ready">Entradas prontas</span><strong className="v3-value">{`${ready} de ${checklist.expected} prontas`}</strong>
   <progress aria-labelledby="v3-ready" value={ready} max={Math.max(checklist.expected,1)}/></div></div>
   <p>{open===0?'Nenhuma pendência impede o fechamento.':`${open} ${open>1?'pendências impedem':'pendência impede'} o fechamento.`}</p>
   <button type="button" onClick={()=>onNavigate('ciclo')}>Abrir ciclo e fechamento</button></section></>;
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
