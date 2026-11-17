import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { AuthorizedContext, CommandReceipt, ContextGroup, PositionSummary } from '../pilot/types';
import { formatDecimal, previewPoints } from '../pilot/decimal';
import { directionSymbol } from '../results/CalculationExplainer';
import { byUnitAndIndicator, loadGroupPositions, statusLabels, type GroupPosition } from '../batch/groupPositions';
import { toCommandContext } from '../context/contextApi';
import { DomainCommandError } from '../pilot/commandApi';
import { listPositions, loadPositionDetail, type PositionDetail } from '../submission/positionApi';
import { reviewPosition, startReview } from './reviewApi';
import { CamDecisionForm } from './CorrectionForm';
import { useNavigationDraft } from '../workspace/NavigationSafety';
import { requestAcademicLeave } from '../workspace/academicNavigation';
import { monthName, plural, scopeName } from '../workspace/displayNames';
const queuePageSize=25;
interface ReviewQueueProps {client:SupabaseClient;context:AuthorizedContext;requestedPositionId?:string;positionRequestKey?:number;onPositionsLoaded?:(positions:PositionSummary[])=>void;
 // Model 3: one queue over every indicator context of the group (read-only for the CAM).
 group?:ContextGroup;readOnly?:boolean;
 // Model 3: the unit chip turned on when the page opens ("Conferir unidade" on the painel).
 initialUnitId?:string}
export function ReviewQueue(props:ReviewQueueProps) {
 if(props.group?.modelo===3)return <GroupReviewQueue key={props.group.key} client={props.client} group={props.group} readOnly={!!props.readOnly} requestedPositionId={props.requestedPositionId} positionRequestKey={props.positionRequestKey} initialUnitId={props.initialUnitId} />;
 return <ContextReviewQueue key={props.context.key} {...props} />;
}
function ContextReviewQueue({client,context,requestedPositionId,positionRequestKey,onPositionsLoaded}:ReviewQueueProps) {
 const [positions,setPositions]=useState<PositionSummary[]>([]);
 const [detail,setDetail]=useState<PositionDetail|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [reload,setReload]=useState(0);
 // CAM coverage spans every linked target, so the queue pages and searches on
 // the server; the first page is not the whole authorized universe.
 const [page,setPage]=useState(1);const [total,setTotal]=useState(0);
 const [searchInput,setSearchInput]=useState('');const [search,setSearch]=useState('');
 const listGeneration=useRef(0);const detailGeneration=useRef(0);
 const detailHeading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{
  const request=++listGeneration.current;setLoading(true);setError(null);
  void listPositions(client,toCommandContext(context),{page,pageSize:queuePageSize,...(search?{search}:{})}).then(loaded=>{if(listGeneration.current===request){setPositions(loaded.items);setTotal(loaded.total);onPositionsLoaded?.(loaded.items);}})
   .catch(()=>{if(listGeneration.current===request)setError('Não foi possível carregar a fila autorizada.');})
   .finally(()=>{if(listGeneration.current===request)setLoading(false);});
  return()=>{listGeneration.current++;detailGeneration.current++;};
 },[client,context,reload,onPositionsLoaded,page,search]);
 const pages=Math.max(1,Math.ceil(total/queuePageSize));
 function changeList(next:{page?:number;search?:string}){
  if(!requestAcademicLeave())return;
  detailGeneration.current++;setDetail(null);
  if(next.search!==undefined)setSearch(next.search);
  setPage(next.page??1);
 }
 const selectPosition=useCallback(async(id:string)=>{
  if(!requestAcademicLeave())return;
  const request=++detailGeneration.current;setDetail(null);setError(null);
  try{const loaded=await loadPositionDetail(client,toCommandContext(context),id);if(detailGeneration.current===request)setDetail(loaded);}
  catch{if(detailGeneration.current===request)setError('Não foi possível carregar a evidência autorizada.');}
 },[client,context]);
 useEffect(()=>{if(requestedPositionId)void selectPosition(requestedPositionId);},[requestedPositionId,positionRequestKey,selectPosition]);
 useEffect(()=>{if(detail&&requestedPositionId===detail.position.id)detailHeading.current?.focus();},[detail,requestedPositionId]);
 return <section aria-label="Fila de conferência técnica">
  <h2>{context.role==='cam'?'Acompanhamento CAM':'Conferência técnica'}</h2><p>Aceite de evidência sintética; não é aprovação de gratificação ou decisão de indisponibilidade pela CAM.</p>
  <button type="button" onClick={()=>{if(requestAcademicLeave()){detailGeneration.current++;setDetail(null);setReload(n=>n+1);}}}>Atualizar fila</button>
  <form role="search" onSubmit={event=>{event.preventDefault();changeList({search:searchInput.trim()});}}>
   <label>Buscar alvo<input type="search" maxLength={100} value={searchInput} onChange={event=>setSearchInput(event.target.value)} /></label>
   <button type="submit">Buscar</button>
  </form>
  {loading&&<p role="status">Carregando fila…</p>}
  <ul>{positions.map(position=><li key={position.id}><button type="button" onClick={()=>void selectPosition(position.id)}>{position.escopoCodigo} · {position.status}</button></li>)}</ul>
  <nav aria-label="Páginas da fila"><p>Página {page} de {pages} · {total} {total===1?'posição':'posições'}</p>
   <button type="button" disabled={loading||page<=1} onClick={()=>changeList({page:page-1})}>Página anterior</button>
   <button type="button" disabled={loading||page>=pages} onClick={()=>changeList({page:page+1})}>Próxima página</button>
  </nav>
  {!loading&&!positions.length&&!error&&<p>Nenhuma posição autorizada.</p>}
  {error&&<p role="alert">{error}</p>}
  {detail&&(context.role==='cam'?<section><h3 ref={detailHeading} tabIndex={-1}>{detail.position.escopoCodigo}</h3><ul>{detail.decisions.map(d=><li key={d.id}>{d.type}: {d.reason}</li>)}</ul><CamDecisionForm key={detail.position.id} client={client} context={context} detail={detail} onConfirmed={receipt=>{
   setPositions(rows=>rows.map(row=>row.id===receipt.resourceId?{...row,status:receipt.status as PositionSummary['status'],version:receipt.version}:row));
  }} /></section>:<ReviewEvidence key={detail.position.id} client={client} context={context} detail={detail} onConfirmed={receipt=>{
   setPositions(rows=>rows.map(row=>row.id===receipt.resourceId?{...row,status:receipt.status as PositionSummary['status'],version:receipt.version}:row));
  }} />)}
 </section>;
}
type ReviewOperation={id:string;version:number;action:'start'|'accept'|'return';reason:string};
type EvidenceProps=ReviewQueueProps&{detail:PositionDetail;onConfirmed:(receipt:CommandReceipt)=>void;v3?:boolean;readOnly?:boolean;focusHeading?:boolean;
 // Model 3 row actions (RV-08): accept runs the detail's own accept once; return focuses the reason.
 initialAction?:'accept';focusReason?:boolean;onClose?:()=>void};
function ReviewEvidence({client,context,detail,onConfirmed,v3=false,readOnly=false,focusHeading=false,initialAction,focusReason=false,onClose}:EvidenceProps) {
 const heading=useRef<HTMLHeadingElement>(null);const reasonField=useRef<HTMLTextAreaElement>(null);const ids=useId();
 useEffect(()=>{if(focusHeading)heading.current?.focus();},[focusHeading]);
 const [status,setStatus]=useState(detail.position.status);const [version,setVersion]=useState(detail.position.version);
 const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
 const [confirmation,setConfirmation]=useState<string|null>(null);const [pending,setPending]=useState<ReviewOperation|null>(null);
 const active=useRef(true);const inFlight=useRef(false);const initialRan=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const revision=detail.revisions.find(row=>row.id===detail.position.revisionId);
 useNavigationDraft(busy||!!pending||(status==='em_revisao'&&!!reason));
 async function execute(action:ReviewOperation['action']) {
  if(inFlight.current)return;
  setError(null);setConfirmation(null);
  const normalized=reason.trim();
  if(!pending&&(normalized.length>1000||(action==='return'&&!normalized))){setError('Informe o motivo da devolução (até 1000 caracteres).');return;}
  const operation=pending??{id:crypto.randomUUID(),version,action,reason:normalized};
  setPending(operation);setBusy(true);inFlight.current=true;
  try{
   const command=toCommandContext(context);
   const receipt=operation.action==='start'?await startReview(client,command,detail.position.id,operation.version,operation.id):await reviewPosition(client,command,detail.position.id,operation.version,operation.action,operation.reason,operation.id);
   if(!active.current)return;
   if(receipt.revisionId!==detail.position.revisionId)throw new DomainCommandError('invalid_input');
   setPending(null);setStatus(receipt.status as PositionSummary['status']);setVersion(receipt.version);setConfirmation(`Conferência confirmada: ${receipt.status}.`);onConfirmed(receipt);
  }catch(cause){if(active.current){
   // A rejected current attempt does not prove a previous ambiguous commit
   // never happened. Access revocation therefore keeps the exact pending key.
   if(cause instanceof DomainCommandError&&cause.confirmedRejected&&cause.code!=='access_denied')setPending(null);
   setError(cause instanceof DomainCommandError?cause.message:'Não foi possível confirmar a conferência. Repita a mesma operação.');
  }}finally{inFlight.current=false;if(active.current)setBusy(false);}
 }
 // Mount only. The ref is set before the call, so a StrictMode replay never sends a second accept (preflight F9);
 // an ambiguous outcome keeps its pending key and waits for "Repetir operação pendente".
 useEffect(()=>{
  if(focusReason)reasonField.current?.focus();
  if(initialAction&&!readOnly&&!initialRan.current&&detail.position.status==='em_revisao'){initialRan.current=true;void execute(initialAction);}
 },[]);
 const feedback=<>{error&&<p role="alert">{error}</p>}{confirmation&&<p role="status">{confirmation}</p>}
  {!readOnly&&pending&&!busy&&<><p>A confirmação está pendente. Repetir preserva comando, versão, motivo e chave originais.</p><button type="button" onClick={()=>void execute(pending.action)}>Repetir operação pendente</button></>}</>;
 if(!v3)return <section aria-label="Evidência da posição">
  <h3>{detail.position.escopoCodigo}</h3><p>Estado: {status} · revisão {revision?.number??'—'}</p>
  {revision&&<dl><dt>Fonte</dt><dd>{revision.source}</dd><dt>Período</dt><dd>{revision.sourcePeriod}</dd><dt>Estado do dado</dt><dd>{revision.estadoDado}</dd><dt>Valor informado</dt><dd>{revision.value??'Sem valor numérico'}</dd><dt>Justificativa da fonte</dt><dd>{revision.reason||'—'}</dd></dl>}
  <p>{detail.position.estadoDado==='indisponivel'?'Sem resultado numérico. Aceitar a evidência não decide a indisponibilidade; decisão CAM pendente.':detail.position.resultValue===null?'Sem resultado numérico disponível.':`Resultado sintético preservado: ${detail.position.resultValue}`}</p>
  <ul>{detail.decisions.map(decision=><li key={decision.id}>{decision.type}: {decision.reason||'Sem observação'}</li>)}</ul>
  {!readOnly&&<label>Motivo da conferência<textarea maxLength={1000} value={reason} disabled={busy||!!pending||status!=='em_revisao'} onChange={event=>setReason(event.target.value)} /></label>}
  {feedback}
  {!readOnly&&status==='enviada'&&<button type="button" disabled={busy||!!pending} onClick={()=>void execute('start')}>Iniciar revisão</button>}
  {!readOnly&&status==='em_revisao'&&<><button type="button" disabled={busy||!!pending} onClick={()=>void execute('accept')}>Aceitar evidência</button><button type="button" disabled={busy||!!pending} onClick={()=>void execute('return')}>Devolver com motivo</button></>}
 </section>;
 // Model 3 (RV-09): the V4 detail. The title is the indicator; the unit sits above it.
 const title=[detail.position.indicatorCode,detail.position.indicatorName].filter(Boolean).join(' · ')||scopeName(detail.position.escopoCodigo);
 const returned=status==='devolvida'&&detail.decisions.find(d=>d.type==='devolver'&&d.revisionId===detail.position.revisionId);
 const acts=!readOnly&&(status==='enviada'||status==='em_revisao');
 const note=readOnly?'Somente leitura. A conferência é do revisor técnico de cada distrito.':status==='validada'?'Entrada aceita. Ela já conta no resultado.':status==='devolvida'?'Aguardando a correção da área técnica.':'Ainda não enviada pela área técnica.';
 return <aside className="box detail" aria-labelledby={`${ids}-t`}>
  <header className="detail-head"><div><p className="eyebrow">{scopeName(detail.position.escopoCodigo)}</p><h3 id={`${ids}-t`} ref={heading} tabIndex={-1}>{title}</h3></div>
   <button type="button" onClick={onClose}>Fechar{' '}<span className="sr-only">detalhe</span></button></header>
  <div className="detail-body">
   <p className="detail-status"><span className={`v3-badge v3-st-${status}`}>{statusLabels[status]}</span> <span className="sub">revisão {revision?.number??'–'}</span></p>
   <V3Evidence detail={detail}/>
   {returned&&<p className="notice danger"><strong>Motivo da devolução.</strong> {returned.reason}</p>}
   <div><h4 className="mini-h">Fluxo de aprovação</h4><ol className="flow">{approvalSteps({...detail,position:{...detail.position,status}}).map(step=>
    <li key={step.title} className={`step-${step.tone}`}><span className="step-dot" aria-hidden="true"/><div><strong>{step.title}</strong>{step.sub&&<small>{step.sub}</small>}</div></li>)}</ol></div>
  </div>
  <footer className={acts?'detail-foot':'detail-foot is-note'}>
   {!acts&&<p>{note}</p>}
   {!readOnly&&status==='em_revisao'&&<div className="field"><label htmlFor={`${ids}-r`}>Motivo da conferência</label><span id={`${ids}-h`} className="req">obrigatório para devolver</span>
    <textarea id={`${ids}-r`} ref={reasonField} rows={2} maxLength={1000} aria-describedby={`${ids}-h`} value={reason} disabled={busy||!!pending} onChange={event=>setReason(event.target.value)}/></div>}
   {feedback}
   {!readOnly&&status==='enviada'&&<button type="button" className="primary" disabled={busy||!!pending} onClick={()=>void execute('start')}>Iniciar revisão</button>}
   {!readOnly&&status==='em_revisao'&&<div className="actions"><button type="button" className="danger" disabled={busy||!!pending} onClick={()=>void execute('return')}>Devolver com motivo</button><button type="button" className="primary" disabled={busy||!!pending} onClick={()=>void execute('accept')}>Aceitar evidência</button></div>}
  </footer>
 </aside>;
}

const flowDate=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'America/Recife'});
const day=(at?:string|null)=>{const date=at?new Date(at):null;return date&&Number.isFinite(date.getTime())?flowDate.format(date):'';};
// Fluxo de aprovação (spec §5.1/§5.2): steps by role, never by person, from the current revision and its decisions.
export function approvalSteps(detail:PositionDetail):{tone:'done'|'current'|'bad'|'todo';title:string;sub:string}[] {
 const current=detail.revisions.find(row=>row.id===detail.position.revisionId);
 const decided=(type:PositionDetail['decisions'][number]['type'])=>day(detail.decisions.find(d=>d.revisionId===detail.position.revisionId&&d.type===type)?.occurredAt);
 const sent={tone:'done' as const,title:'Enviado pela área técnica',sub:[`revisão ${current?.number??'–'}`,day(current?.submittedAt)].filter(Boolean).join(' · ')};
 switch(detail.position.status){
  case 'enviada':return [sent,{tone:'current',title:'Aguardando conferência · revisor técnico',sub:''}];
  case 'em_revisao':return [sent,{tone:'current',title:'Em conferência · revisor técnico',sub:decided('iniciar_revisao')}];
  case 'devolvida':return [sent,{tone:'bad',title:'Devolvido pelo revisor técnico',sub:decided('devolver')},{tone:'current',title:'Correção · área técnica',sub:''}];
  case 'validada':return [sent,{tone:'done',title:'Aceito pelo revisor técnico · conta no resultado',sub:decided('validar')}];
  default:return [{tone:'current',title:'Com a área técnica',sub:''},{tone:'todo',title:'Conferência · revisor técnico',sub:''}];
 }
}
// Model 3: the facts the reviewer compares and the stored calculation memory of the current revision.
// The formula text is a preview; the points are the server's.
function V3Evidence({detail}:{detail:PositionDetail}) {
 const {indicator,previous}=detail;
 const current=detail.revisions.find(row=>row.id===detail.position.revisionId);
 const memory=detail.memories.find(row=>row.revisionId===current?.id);
 const prior=current&&detail.revisions.find(row=>row.number===current.number-1);
 const unit=indicator?.unit?` ${indicator.unit}`:'';
 const value=(estadoDado:string|null,valor:string|null)=>valor!==null?`${formatDecimal(valor)}${unit}`:estadoDado==='nao_aplicavel'?'Não se aplica':estadoDado==='indisponivel'?'Indisponível':'–';
 const formula=memory&&indicator&&previewPoints(memory.inputValue,indicator)?.expression;
 return <>
  <dl className="facts">
   {indicator&&<><dt>Meta</dt><dd>{directionSymbol(indicator.direction)} {formatDecimal(indicator.meta)}{unit} · peso {formatDecimal(indicator.weight)}</dd></>}
   <dt>Informado</dt><dd className="num"><strong>{current?value(current.estadoDado,current.value):'–'}</strong></dd>
   {current&&(current.estadoDado==='valor'?<><dt>Fonte</dt><dd>{current.source||'–'}</dd></>:<><dt>Motivo</dt><dd>{current.reason||'–'}</dd></>)}
   {current&&<><dt>Período</dt><dd>{current.sourcePeriod.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$3/$2/$1')||'–'}</dd></>}
   {previous&&<><dt>{monthName(previous.competencia).replace(/^./,letter=>letter.toUpperCase())}</dt><dd className="num">{value(previous.estadoDado,previous.valor)}</dd></>}
   {/* R-25: a correction is read beside the version it replaced. */}
   {current?.correctionExplanation&&prior&&<><dt>Revisão {prior.number}</dt><dd>{[value(prior.estadoDado,prior.value),prior.source].filter(Boolean).join(' · ')}</dd></>}
   {current?.correctionExplanation&&<><dt>Correção</dt><dd>{current.correctionExplanation}</dd></>}
  </dl>
  <div><h4 className="mini-h">Memória de cálculo</h4><p className="memo">{memory?<>{formula&&`${formula} = `}<strong>{formatDecimal(memory.resultValue,2)}</strong> pontos</>:'Sem cálculo numérico: situação especial com motivo.'}</p></div>
  {detail.position.estadoDado==='indisponivel'&&<p className="notice info">Aceitar a evidência não decide a indisponibilidade; decisão CAM pendente.</p>}
 </>;
}
type QueueTab={id:'para_conferir'|'em_conferencia'|'devolvidas'|'aceitas'|'todas'|'nao_enviadas';label:string;statuses:readonly string[]|null};
const reviewerTabs:readonly QueueTab[]=[{id:'para_conferir',label:'Para conferir',statuses:['enviada']},{id:'em_conferencia',label:'Em conferência',statuses:['em_revisao']},
 {id:'devolvidas',label:'Devolvidas',statuses:['devolvida']},{id:'aceitas',label:'Aceitas',statuses:['validada']},{id:'todas',label:'Todas',statuses:null}];
// CAM-08: the CAM reads everything, from Todas; "Não enviadas" joins the absent and the draft entries.
const camTabs:readonly QueueTab[]=[reviewerTabs[4],{id:'nao_enviadas',label:'Não enviadas',statuses:['ausente','rascunho']},...reviewerTabs.slice(0,4)];
type OpenRequest={requested?:boolean;action?:'accept';focusReason?:boolean};
function GroupReviewQueue({client,group,readOnly,requestedPositionId,positionRequestKey,initialUnitId}:{client:SupabaseClient;group:ContextGroup;readOnly:boolean;requestedPositionId?:string;positionRequestKey?:number;initialUnitId?:string}) {
 const tabs=readOnly?camTabs:reviewerTabs;
 const [rows,setRows]=useState<GroupPosition[]>([]);
 const [loading,setLoading]=useState(true);const [error,setError]=useState<string|null>(null);const [reload,setReload]=useState(0);
 const [tabId,setTabId]=useState<QueueTab['id']>(tabs[0].id);
 const [unitId,setUnitId]=useState(initialUnitId);const [search,setSearch]=useState('');
 const [open,setOpen]=useState<{row:GroupPosition;detail:PositionDetail}&OpenRequest|null>(null);
 const listGeneration=useRef(0);const detailGeneration=useRef(0);const handledRequest=useRef<number|undefined>(undefined);
 const tabRefs=useRef(new Map<string,HTMLButtonElement>());const rowLinks=useRef(new Map<string,HTMLButtonElement>());
 // WCAG 2.4.3: the row whose detail closed or whose row accept removed the focused control.
 const refocus=useRef<GroupPosition|null>(null);
 useEffect(()=>{
  const request=++listGeneration.current;setLoading(true);setError(null);
  void loadGroupPositions(client,group).then(loaded=>{if(listGeneration.current===request)setRows(loaded.sort(byUnitAndIndicator));})
   .catch(()=>{if(listGeneration.current===request)setError('Não foi possível carregar a fila autorizada.');})
   .finally(()=>{if(listGeneration.current===request)setLoading(false);});
  return()=>{listGeneration.current++;detailGeneration.current++;};
 },[client,group,reload]);
 // Opening is a read: the detail is loaded, and only a row action asks it to run its own command.
 async function openRow(row:GroupPosition,request:OpenRequest={}) {
  if(!requestAcademicLeave())return;
  const generation=++detailGeneration.current;setOpen(null);setError(null);
  try{const detail=await loadPositionDetail(client,toCommandContext(row.context),row.position.id);if(detailGeneration.current===generation)setOpen({row,detail,...request});}
  catch{if(detailGeneration.current===generation)setError('Não foi possível carregar a evidência autorizada.');}
 }
 function closeDetail(){if(requestAcademicLeave()){detailGeneration.current++;refocus.current=open?.row??null;setOpen(null);}}
 const tabOf=(status:string)=>readOnly?'todas':tabs.find(tab=>tab.statuses?.includes(status))?.id??'todas';
 useEffect(()=>{
  if(!requestedPositionId||loading||handledRequest.current===positionRequestKey)return;
  handledRequest.current=positionRequestKey;
  const row=rows.find(candidate=>candidate.position.id===requestedPositionId);
  if(!row){setError('Esta posição não está entre as posições autorizadas.');return;}
  // Show the requested row in the list: the CAM reads in Todas, the reviewer in the tab of its status.
  setTabId(tabOf(row.position.status));
  void openRow(row,{requested:true});
 },[requestedPositionId,positionRequestKey,loading,rows]);
 function changeTab(next:QueueTab['id']) {
  if(next===tabId||!requestAcademicLeave())return;
  detailGeneration.current++;setOpen(null);setTabId(next);
 }
 function arrow(event:KeyboardEvent,index:number) {
  const target=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:-1;
  if(target<0)return;
  event.preventDefault();changeTab(tabs[target].id);tabRefs.current.get(tabs[target].id)?.focus();
 }
 const units=[...new Map(rows.map(({position})=>[position.escopoId,position.escopoCodigo])).entries()];
 // Chips and search only narrow the list; the open detail stays (RV-06).
 const unit=units.some(([id])=>id===unitId)?unitId:undefined;
 const needle=search.trim().toLowerCase();
 const matches=({position}:GroupPosition)=>!needle||[scopeName(position.escopoCodigo),position.escopoCodigo,position.indicatorCode,position.indicatorName].some(text=>text?.toLowerCase().includes(needle));
 const base=rows.filter(row=>(!unit||row.position.escopoId===unit)&&matches(row));
 const inTab=(row:GroupPosition,tab:QueueTab)=>!tab.statuses||tab.statuses.includes(row.position.status);
 const active=tabs.find(tab=>tab.id===tabId)??tabs[0];
 const list=base.filter(row=>inTab(row,active));
 // Back to that row's link; if a filter hid it, the next row in list order, else the last row, else the active tab.
 useEffect(()=>{
  const from=refocus.current;if(!from)return;refocus.current=null;
  const target=list.find(row=>row.position.id===from.position.id)??list.find(row=>byUnitAndIndicator(row,from)>0)??list[list.length-1];
  ((target&&rowLinks.current.get(target.position.id))||tabRefs.current.get(active.id))?.focus();
 });
 function confirmed(receipt:CommandReceipt) {
  if(open?.action==='accept')refocus.current=open.row;
  setRows(all=>all.map(row=>row.position.id===receipt.resourceId?{...row,position:{...row.position,status:receipt.status as PositionSummary['status'],version:receipt.version}}:row));
  // The tab follows the entry's new situation, so the open row stays in the list; Todas already holds it.
  setTabId(current=>current==='todas'?current:tabOf(receipt.status));
 }
 return <section aria-label={readOnly?'Todas as entradas':'Fila de conferência técnica'}>
  <div className="v3-tabs" role="tablist" aria-label="Filtrar entradas">{tabs.map((tab,index)=><button key={tab.id} id={`queue-tab-${tab.id}`} ref={node=>{if(node)tabRefs.current.set(tab.id,node);else tabRefs.current.delete(tab.id);}}
   type="button" role="tab" aria-selected={tab.id===active.id} aria-controls="queue-panel" tabIndex={tab.id===active.id?0:-1} onClick={()=>changeTab(tab.id)} onKeyDown={event=>arrow(event,index)}>
   {tab.label} <span className="n">{base.filter(row=>inTab(row,tab)).length}</span></button>)}</div>
  <div className="toolbar">
   <div className="chips" role="group" aria-label="Filtrar por unidade">{[[undefined,'Todas as unidades'] as const,...units.map(([id,code])=>[id,scopeName(code)] as const)].map(([id,label])=>
    <button key={id??''} type="button" className="chip" aria-pressed={id===unit} onClick={()=>setUnitId(id)}>{label}</button>)}</div>
   <label className="search"><span className="sr-only">Buscar unidade ou indicador</span><input type="search" maxLength={100} placeholder="Buscar unidade ou indicador" value={search} onChange={event=>setSearch(event.target.value)}/></label>
   <button type="button" onClick={()=>{if(requestAcademicLeave()){detailGeneration.current++;setOpen(null);setReload(n=>n+1);}}}>Atualizar fila</button>
  </div>
  <div className={open?'review':undefined}>
   <div id="queue-panel" role="tabpanel" aria-labelledby={`queue-tab-${active.id}`}>
    {loading&&<p role="status">Carregando fila…</p>}
    {list.length>0&&<div className="v4-tbl"><table><caption className="sr-only">Entradas: {active.label}</caption>
     <thead><tr><th scope="col">Entrada</th><th scope="col" className="r">Valor</th><th scope="col">Situação</th>{!readOnly&&<th scope="col" className="r"><span className="sr-only">Ações</span></th>}</tr></thead>
     <tbody>{list.map(row=>{const {position}=row;const selected=open?.row.position.id===position.id;const name=scopeName(position.escopoCodigo);const code=position.indicatorCode??'';
      return <tr key={position.id} className={selected?'is-sel':undefined} aria-current={selected||undefined}>
       <td data-label="Entrada"><button type="button" className="row-link" ref={node=>{if(node)rowLinks.current.set(position.id,node);else rowLinks.current.delete(position.id);}} onClick={()=>void openRow(row)}><strong>{name}</strong>{position.indicatorCode&&<> <span>{code} · {position.indicatorName}</span></>}</button></td>
       <td className="r num" data-label="Valor">{position.inputValue!==null?formatDecimal(position.inputValue):'–'}</td>
       <td data-label="Situação"><span className={`v3-badge v3-st-${position.status}`}>{statusLabels[position.status]}</span></td>
       {!readOnly&&<td className="r" data-label="Ações">{position.status==='em_revisao'&&<span className="row-acts">
        <button type="button" aria-label={`Aceitar ${name} ${code}`} onClick={()=>void openRow(row,{action:'accept'})}>Aceitar</button>
        <button type="button" className="danger" aria-label={`Devolver ${name} ${code}`} onClick={()=>void openRow(row,{focusReason:true})}>Devolver</button></span>}</td>}</tr>;})}</tbody>
    </table><div className="tbl-foot"><span>{plural(list.length,'entrada','entradas')}</span><span>Ordem: unidade e indicador</span></div></div>}
    {!loading&&!list.length&&!error&&<div className="box empty">{active.id==='para_conferir'
     ?<><strong>Nada aguardando você</strong><span>Quando a área técnica enviar, a entrada aparece nesta aba.</span></>
     :<><strong>Nenhuma entrada aqui</strong><span>Tente outra aba, outra unidade ou limpe a busca.</span></>}</div>}
   </div>
   {open&&<ReviewEvidence key={open.detail.position.id} client={client} context={open.row.context} detail={open.detail} v3 readOnly={readOnly} focusHeading={open.requested}
    initialAction={open.action} focusReason={open.focusReason} onClose={closeDetail} onConfirmed={confirmed} />}
  </div>
  {error&&<p role="alert">{error}</p>}
 </section>;
}
