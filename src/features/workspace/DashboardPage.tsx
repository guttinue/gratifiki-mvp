import type { PilotContext, PilotEntry } from "../../lib/types";
import { formatAuditAction, formatTimestamp, PAGE_LABELS, STATUS_LABELS } from "./workspaceModel";
import { getWorkspaceMetrics } from "./workspaceModel";
import type { WorkspacePage } from "./workspaceModel";
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthorizedContext,ContextGroup,CycleChecklist,DashboardData,Page,PositionFilter,PositionSummary } from '../pilot/types';
import { useEffect,useId,useState } from 'react';
import { toCommandContext } from '../context/contextApi';
import { loadDashboard } from './academicDashboardApi';
import { listPositions } from '../submission/positionApi';
import { loadCycleChecklist } from '../cycle/cycleApi';
import { byUnitAndIndicator, loadGroupPositions, statusLabels, unitContexts, type GroupPosition } from '../batch/groupPositions';
import { loadUnitBatch, type UnitBatch } from '../batch/batchApi';
import { countByStatus, monthName, plural, scopeName, statusTones } from './displayNames';
import { formatDecimal } from '../pilot/decimal';
import { ActivityFeed, StackBar, StageTiles, TodoList, UnitCard } from './v4Parts';
import { loadUnitResults, type UnitResults } from '../results/resultsApi';
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
type V3Data={kind:'positions';rows:GroupPosition[];batches:Map<string,UnitBatch>}|{kind:'cycle';checklist:CycleChecklist;rows:GroupPosition[];results:UnitResults|null};
const pending=(status:string)=>status==='devolvida'||status==='rascunho'||status==='ausente';
// Each position keeps the context that listed it. For the technical area, every unit with a to-do
// has its batch read (reason, goal, saved value) with that unit's contexts only, in parallel.
async function loadPanelPositions(client:SupabaseClient,group:ContextGroup):Promise<V3Data>{
 const rows=(await loadGroupPositions(client,group)).sort(byUnitAndIndicator);
 const batches=new Map<string,UnitBatch>();
 // Outside the open month the to-dos are not shown, so their detail is not read.
 if(group.role!=='area_tecnica'||group.contexts[0].competenciaEstado!=='aberta')return{kind:'positions',rows,batches};
 const units=[...new Set(rows.filter(row=>pending(row.position.status)).map(row=>row.position.escopoId))];
 // The batch is detail here: a failed one leaves its to-dos without the sub-line.
 await Promise.all(units.map(unitId=>loadUnitBatch(client,unitContexts(rows,unitId),unitId).then(batch=>{batches.set(unitId,batch);},()=>undefined)));
 return{kind:'positions',rows,batches};
}
export type UnitFocus={positionId:string;field:'valor'|'explicacao'};
type GroupDashboardProps={client:SupabaseClient;group:ContextGroup;onNavigate:(destination:string)=>void;onOpenUnit?:(unitId:string,focus?:UnitFocus)=>void;onOpenPosition?:(id:string)=>void;onOpenHistory?:()=>void};
export function AcademicV3Dashboard(props:GroupDashboardProps){return <GroupDashboard key={props.group.key} {...props}/>;}
function GroupDashboard({client,group,onNavigate,onOpenUnit,onOpenPosition,onOpenHistory}:GroupDashboardProps){
 const [data,setData]=useState<V3Data|null>(null);const [error,setError]=useState(false);const [retry,setRetry]=useState(0);
 useEffect(()=>{let current=true;setData(null);setError(false);
  // CAM: the scores are detail of the unit cards, so a failed results read keeps the painel.
  const load=group.role==='cam'?Promise.all([loadCycleChecklist(client,toCommandContext(group.contexts[0])),loadGroupPositions(client,group),loadUnitResults(client,toCommandContext(group.contexts[0])).catch(()=>null)])
   .then(([checklist,rows,results]):V3Data=>({kind:'cycle',checklist,rows:rows.sort(byUnitAndIndicator),results})):loadPanelPositions(client,group);
  void load.then(value=>{if(current)setData(value);}).catch(()=>{if(current)setError(true);});return()=>{current=false;};},[client,group,retry]);
 const openUnit=onOpenUnit??(()=>onNavigate('preenchimento'));
 const openPosition=(id:string)=>onOpenPosition?onOpenPosition(id):onNavigate('conferencia');
 return <section aria-label="Painel autorizado" className="v3-page">
 {error?<p role="alert">Não foi possível confirmar os contadores autorizados.</p>:!data?<p role="status">Carregando contadores…</p>
  :data.kind==='cycle'?<CamPanel data={data} client={client} group={group} onNavigate={onNavigate} onOpenUnit={openUnit} onOpenHistory={onOpenHistory}/>
  :group.role==='revisor_tecnico'?<ReviewerPanel rows={data.rows} client={client} group={group} onOpenPosition={openPosition} onOpenUnit={openUnit} onOpenHistory={onOpenHistory}/>:<TechnicalPanel data={data} client={client} group={group} onOpenUnit={openUnit} onOpenHistory={onOpenHistory}/>}
 <button type="button" onClick={()=>setRetry(n=>n+1)}>Atualizar painel</button></section>;
}
// AT-01 to AT-04: the flow stages, the to-dos of the open month, one card per unit and the recent activity.
function TechnicalPanel({data,client,group,onOpenUnit,onOpenHistory}:{data:Extract<V3Data,{kind:'positions'}>;client:SupabaseClient;group:ContextGroup;onOpenUnit:(unitId:string,focus?:UnitFocus)=>void;onOpenHistory?:()=>void}){
 const c=countByStatus(data.rows);
 const item=(position:PositionSummary)=>data.batches.get(position.escopoId)?.items.find(i=>i.positionId===position.id);
 const target=(position:PositionSummary)=>`${scopeName(position.escopoCodigo)} · ${position.indicatorCode??''} ${position.indicatorName??''}`.trim();
 const unitText=(unit:string|null)=>unit?` ${unit}`:'';
 const unitsTitle=useId();
 // The visible verb comes first in the name (label in name); the target tells repeated buttons apart.
 const act=(label:string,position:PositionSummary,field:UnitFocus['field'])=>({label,ariaLabel:`${label} ${position.indicatorCode??''} · ${scopeName(position.escopoCodigo)}`,onClick:()=>onOpenUnit(position.escopoId,{positionId:position.id,field})});
 const having=(status:string)=>data.rows.map(row=>row.position).filter(position=>position.status===status);
 const todos=group.contexts[0].competenciaEstado!=='aberta'?[]:[
  ...having('devolvida').map(position=>{const i=item(position);return{tone:'bad' as const,title:`Corrigir ${target(position)}`,
   sub:i&&(i.returnReason?`Devolvida pelo revisor técnico: ${i.returnReason}`:'Devolvida pelo revisor técnico.'),action:act('Corrigir',position,'explicacao')};}),
  ...having('rascunho').map(position=>{const i=item(position);return{tone:'info' as const,title:`Enviar o rascunho de ${target(position)}`,
   // A draft can hold no number (unavailable data): then only its state is said.
   sub:i&&(i.valor!==null?`Valor salvo: ${formatDecimal(i.valor)}${unitText(i.unit)}. Ainda não está com o revisor.`:'Ainda não está com o revisor.'),action:act('Revisar e enviar',position,'valor')};}),
  ...having('ausente').map(position=>{const i=item(position);return{tone:'neutral' as const,title:`Preencher ${target(position)}`,
   sub:i&&`Meta: ${i.direction==='maior_melhor'?'no mínimo':'no máximo'} ${formatDecimal(i.meta)}${unitText(i.unit)}`,action:act('Preencher',position,'valor')};}),
 ];
 const units=unitsOf(data.rows);
 return <><StageTiles label="Etapas do fluxo" tiles={[
   {label:'Não enviados',value:c.ausente,sub:'ainda sem valor',tone:'neutral'},
   {label:'Rascunhos',value:c.rascunho,sub:'salvos, não enviados',tone:'info'},
   {label:'Devolvidas',value:c.devolvida,sub:c.devolvida?'precisam de correção':'nenhuma pendente',tone:'bad'},
   {label:'Em conferência',value:c.enviada+c.em_revisao,sub:`${c.enviada} aguardando · ${c.em_revisao} em análise`,tone:'warn'},
   {label:'Aceitas',value:c.validada,sub:`de ${c.total} do seu escopo`,tone:'ok'}]}/>
  <div className="dash"><div className="stack">
   <TodoList title="Para fazer" items={todos} empty={<><strong>Nada pendente com você.</strong><span>Se algo for devolvido, aparece aqui com o motivo.</span></>}/>
   <section className="block" aria-labelledby={unitsTitle}><div className="block-head"><h3 id={unitsTitle}>Suas unidades</h3></div><div className="cards">
    {units.map(([id,code])=>{const u=countByStatus(data.rows.filter(({position})=>position.escopoId===id));const name=scopeName(code);
     return <UnitCard key={id} title={name} badge={u.devolvida>0&&<span className="v3-badge v3-st-devolvida">{plural(u.devolvida,'devolvida','devolvidas')}</span>}
      big={<>{u.enviada+u.em_revisao+u.validada} <small>de {u.total} enviados</small></>} bar={<StackBar counts={u}/>}
      foot={`${plural(u.validada,'aceita','aceitas')} · ${u.enviada+u.em_revisao} com o revisor`} action={{label:'Abrir preenchimento',ariaLabel:`Abrir preenchimento ${name}`,onClick:()=>onOpenUnit(id)}}/>;})}
   </div></section></div>
  <ActivityFeed client={client} group={group} onOpenHistory={onOpenHistory}/></div></>;
}
// The units of the rows, in the rows' order (unit, then indicator).
const unitsOf=(rows:GroupPosition[])=>[...new Map(rows.map(({position})=>[position.escopoId,position.escopoCodigo])).entries()];
// RV-01 to RV-04: the review stages, what waits for a review, one card per unit and the recent activity.
// "Conferir" only opens the entry: starting the review stays an explicit command (RV-10).
function ReviewerPanel({rows,client,group,onOpenPosition,onOpenUnit,onOpenHistory}:{rows:GroupPosition[];client:SupabaseClient;group:ContextGroup;onOpenPosition:(id:string)=>void;onOpenUnit:(unitId:string)=>void;onOpenHistory?:()=>void}){
 const c=countByStatus(rows);const unitsTitle=useId();
 const todos=rows.map(row=>row.position).filter(position=>position.status==='enviada'||position.status==='em_revisao').map(position=>{const unit=scopeName(position.escopoCodigo);
  return{tone:statusTones[position.status],title:`Conferir ${unit} · ${position.indicatorCode??''} ${position.indicatorName??''}`.trim(),sub:statusLabels[position.status],
   action:{label:'Conferir',ariaLabel:`Conferir ${position.indicatorCode??''} · ${unit}`,onClick:()=>onOpenPosition(position.id)}};});
 return <><StageTiles label="Etapas do fluxo" tiles={[
   {label:'Com a área técnica',value:c.ausente+c.rascunho,sub:'não enviados ou rascunho',tone:'neutral'},
   {label:'Para conferir',value:c.enviada,sub:'aguardando início da conferência',tone:'warn'},
   {label:'Em conferência',value:c.em_revisao,sub:'conferência iniciada',tone:'vio'},
   {label:'Devolvidas',value:c.devolvida,sub:'aguardando correção',tone:'bad'},
   {label:'Aceitas',value:c.validada,sub:`de ${c.total} do seu escopo`,tone:'ok'}]}/>
  <div className="dash"><div className="stack">
   <TodoList title="Para fazer" items={todos} empty={<><strong>Nada aguardando você.</strong><span>Quando a área técnica enviar, a entrada aparece aqui.</span></>}/>
   <section className="block" aria-labelledby={unitsTitle}><div className="block-head"><h3 id={unitsTitle}>Unidades do distrito</h3></div><div className="cards">
    {unitsOf(rows).map(([id,code])=>{const u=countByStatus(rows.filter(({position})=>position.escopoId===id));const name=scopeName(code);const waiting=u.enviada+u.em_revisao;const label=waiting?'Conferir unidade':'Ver entradas';
     return <UnitCard key={id} title={name} badge={waiting>0&&<span className="v3-badge v3-st-enviada">{waiting} para conferir</span>}
      big={<>{u.validada} <small>de {u.total} aceitas</small></>} bar={<StackBar counts={u}/>}
      foot={`${plural(u.devolvida,'devolvida','devolvidas')} · ${u.ausente+u.rascunho} com a área técnica`} action={{label,ariaLabel:`${label} ${name}`,onClick:()=>onOpenUnit(id)}}/>;})}
   </div></section></div>
  <ActivityFeed client={client} group={group} onOpenHistory={onOpenHistory}/></div></>;
}
// CAM-01. Read-only: every to-do only navigates to the cycle screen, where the commands stay.
function CamPanel({data,client,group,onNavigate,onOpenUnit,onOpenHistory}:{data:Extract<V3Data,{kind:'cycle'}>;client:SupabaseClient;group:ContextGroup;onNavigate:(destination:string)=>void;onOpenUnit:(unitId:string)=>void;onOpenHistory?:()=>void}){
 const {checklist,rows,results}=data;const c=countByStatus(rows);const unitsTitle=useId();
 const month=monthName(group.contexts[0].competenciaCodigo);const ready=checklist.ready??checklist.reviewed;
 const toCycle=(label:string)=>({label,onClick:()=>onNavigate('ciclo')});
 const todos:Parameters<typeof TodoList>[0]['items']=[];
 if(checklist.state==='aberta')todos.push(checklist.canConsolidate
  ?{tone:'ok',title:`Todas as ${checklist.expected} entradas estão prontas`,sub:'Você já pode iniciar a consolidação.',action:toCycle('Abrir ciclo e fechamento')}
  :{tone:'warn',title:`${plural(Math.max(checklist.expected-ready,0),'entrada impede','entradas impedem')} a consolidação`,sub:'Cada item leva à entrada. A conferência é do revisor de cada distrito.',action:toCycle('Ver o que falta')});
 if(checklist.state==='em_consolidacao')todos.push({tone:'warn',title:`Revisar e fechar ${month}`,sub:'Fechar congela os resultados e pede a referência da decisão. Fechar não publica.',action:toCycle('Abrir ciclo e fechamento')});
 if(checklist.state==='fechada'&&checklist.publication==='nao_publicada')todos.push({tone:'vio',title:`Publicar ${month}`,sub:'Os gestores passam a ver o resultado como publicado.',action:toCycle('Abrir ciclo e fechamento')});
 if(checklist.state==='fechada')todos.push({tone:'neutral',title:'Exportar a competência em CSV',sub:'Gerado a partir dos valores congelados.',action:toCycle('Abrir ciclo e fechamento')});
 return <><StageTiles label="Etapas do fluxo" tiles={[
   {label:'Não enviados',value:c.ausente+c.rascunho,sub:'com a área técnica',tone:'neutral'},
   {label:'Para conferir',value:c.enviada,sub:'aguardando o revisor',tone:'warn'},
   {label:'Em conferência',value:c.em_revisao,sub:'abertas pelo revisor',tone:'vio'},
   {label:'Devolvidas',value:c.devolvida,sub:'aguardando correção',tone:'bad'},
   {label:'Aceitas',value:c.validada,sub:`de ${c.total} entradas`,tone:'ok'}]}/>
  <div className="dash"><div className="stack">
   <TodoList title="Para fazer" items={todos} empty={<strong>Ciclo concluído.</strong>}/>
   <section className="block" aria-labelledby={unitsTitle}><div className="block-head"><h3 id={unitsTitle}>Unidades</h3></div><div className="cards">
    {unitsOf(rows).map(([id,code])=>{const u=countByStatus(rows.filter(({position})=>position.escopoId===id));const name=scopeName(code);const pendingCount=u.total-u.validada;
     // Without a read result (or a base) the card keeps no score.
     const result=results?.units.find(unit=>unit.unitId===id);
     return <UnitCard key={id} title={name} badge={pendingCount?<span className="v3-badge v3-st-enviada">{plural(pendingCount,'pendente','pendentes')}</span>:<span className="v3-badge v3-st-validada">Completa</span>}
      big={result?.points!=null&&<>{formatDecimal(result.points,2)} <small>/ 100{result.partial?' parcial':''}</small></>} bar={<StackBar counts={u}/>}
      foot={`${u.validada} de ${u.total} aceitas`} action={{label:'Ver resultado',ariaLabel:`Ver resultado ${name}`,onClick:()=>onOpenUnit(id)}}/>;})}
   </div></section></div>
  <ActivityFeed client={client} group={group} onOpenHistory={onOpenHistory}/></div></>;
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
