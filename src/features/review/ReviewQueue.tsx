import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AuthorizedContext, CommandReceipt, ContextGroup, PositionSummary } from '../pilot/types';
import { formatDecimal } from '../pilot/decimal';
import { loadGroupPositions, statusLabels, type GroupPosition } from '../batch/groupPositions';
import { toCommandContext } from '../context/contextApi';
import { DomainCommandError } from '../pilot/commandApi';
import { listPositions, loadPositionDetail, type PositionDetail } from '../submission/positionApi';
import { reviewPosition, startReview } from './reviewApi';
import { CamDecisionForm } from './CorrectionForm';
import { useNavigationDraft } from '../workspace/NavigationSafety';
import { requestAcademicLeave } from '../workspace/academicNavigation';
const queuePageSize=25;
interface ReviewQueueProps {client:SupabaseClient;context:AuthorizedContext;requestedPositionId?:string;positionRequestKey?:number;onPositionsLoaded?:(positions:PositionSummary[])=>void;
 // Model 3: one queue over every indicator context of the group (read-only for the CAM).
 group?:ContextGroup;readOnly?:boolean}
export function ReviewQueue(props:ReviewQueueProps) {
 if(props.group?.modelo===3)return <GroupReviewQueue key={props.group.key} client={props.client} group={props.group} readOnly={!!props.readOnly} requestedPositionId={props.requestedPositionId} positionRequestKey={props.positionRequestKey} />;
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
function ReviewEvidence({client,context,detail,onConfirmed,v3=false,readOnly=false,focusHeading=false}:ReviewQueueProps&{detail:PositionDetail;onConfirmed:(receipt:CommandReceipt)=>void;v3?:boolean;readOnly?:boolean;focusHeading?:boolean}) {
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(focusHeading)heading.current?.focus();},[focusHeading]);
 const [status,setStatus]=useState(detail.position.status);const [version,setVersion]=useState(detail.position.version);
 const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
 const [confirmation,setConfirmation]=useState<string|null>(null);const [pending,setPending]=useState<ReviewOperation|null>(null);
 const active=useRef(true);const inFlight=useRef(false);
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
 return <section aria-label="Evidência da posição">
  <h3 ref={heading} tabIndex={v3?-1:undefined}>{detail.position.escopoCodigo}</h3><p>Estado: {status} · revisão {revision?.number??'—'}</p>
  {revision&&<dl><dt>Fonte</dt><dd>{revision.source}</dd><dt>Período</dt><dd>{revision.sourcePeriod}</dd><dt>Estado do dado</dt><dd>{revision.estadoDado}</dd><dt>Valor informado</dt><dd>{revision.value??'Sem valor numérico'}</dd><dt>Justificativa da fonte</dt><dd>{revision.reason||'—'}</dd></dl>}
  {v3&&<V3Evidence detail={detail}/>}
  <p>{detail.position.estadoDado==='indisponivel'?'Sem resultado numérico. Aceitar a evidência não decide a indisponibilidade; decisão CAM pendente.':detail.position.resultValue===null?'Sem resultado numérico disponível.':`Resultado sintético preservado: ${detail.position.resultValue}`}</p>
  <ul>{detail.decisions.map(decision=><li key={decision.id}>{decision.type}: {decision.reason||'Sem observação'}</li>)}</ul>
  {!readOnly&&<label>Motivo da conferência<textarea maxLength={1000} value={reason} disabled={busy||!!pending||status!=='em_revisao'} onChange={event=>setReason(event.target.value)} /></label>}
  {error&&<p role="alert">{error}</p>}{confirmation&&<p role="status">{confirmation}</p>}
  {!readOnly&&pending&&!busy&&<><p>A confirmação está pendente. Repetir preserva comando, versão, motivo e chave originais.</p><button type="button" onClick={()=>void execute(pending.action)}>Repetir operação pendente</button></>}
  {!readOnly&&status==='enviada'&&<button type="button" disabled={busy||!!pending} onClick={()=>void execute('start')}>Iniciar revisão</button>}
  {!readOnly&&status==='em_revisao'&&<><button type="button" disabled={busy||!!pending} onClick={()=>void execute('accept')}>Aceitar evidência</button><button type="button" disabled={busy||!!pending} onClick={()=>void execute('return')}>Devolver com motivo</button></>}
 </section>;
}

// Model 3: what the reviewer compares — the previous version beside what the technician
// says they corrected, and the stored calculation memory of the current revision.
function V3Evidence({detail}:{detail:PositionDetail}) {
 const current=detail.revisions.find(row=>row.id===detail.position.revisionId);
 const previous=current&&detail.revisions.find(row=>row.number===current.number-1);
 const memory=detail.memories.find(row=>row.revisionId===current?.id);
 return <>
  {(previous||current?.correctionExplanation)&&<div role="group" aria-label="Versão anterior">
   {previous&&<><h4>Versão anterior · revisão {previous.number}</h4><dl><dt>Valor</dt><dd>{previous.value?formatDecimal(previous.value):'Sem valor numérico'}</dd><dt>Fonte</dt><dd>{previous.source}</dd></dl></>}
   {current?.correctionExplanation&&<p><strong>O que foi corrigido:</strong> {current.correctionExplanation}</p>}
  </div>}
  {memory&&<div role="group" aria-label="Memória de cálculo"><dl><dt>Valor</dt><dd>{formatDecimal(memory.inputValue)}</dd><dt>Pontos (regra v{memory.ruleVersion})</dt><dd>{formatDecimal(memory.resultValue,2)}</dd></dl></div>}
 </>;
}
type QueueTab={id:'todas'|'pendentes'|'em_conferencia'|'devolvidas'|'aceitas';label:string;statuses:readonly string[]|null};
const queueTabs:readonly QueueTab[]=[{id:'todas',label:'Todas',statuses:null},{id:'pendentes',label:'Pendentes',statuses:['enviada']},{id:'em_conferencia',label:'Em conferência',statuses:['em_revisao']},
 {id:'devolvidas',label:'Devolvidas',statuses:['devolvida']},{id:'aceitas',label:'Aceitas',statuses:['validada']}];
function GroupReviewQueue({client,group,readOnly,requestedPositionId,positionRequestKey}:{client:SupabaseClient;group:ContextGroup;readOnly:boolean;requestedPositionId?:string;positionRequestKey?:number}) {
 const tabs=queueTabs.filter(tab=>readOnly||tab.id!=='todas');
 const [rows,setRows]=useState<GroupPosition[]>([]);
 const [loading,setLoading]=useState(true);const [error,setError]=useState<string|null>(null);const [reload,setReload]=useState(0);
 const [tabId,setTabId]=useState<QueueTab['id']>(tabs[0].id);
 const [searchInput,setSearchInput]=useState('');const [search,setSearch]=useState('');
 const [open,setOpen]=useState<{row:GroupPosition;detail:PositionDetail;requested:boolean}|null>(null);
 const listGeneration=useRef(0);const detailGeneration=useRef(0);const handledRequest=useRef<number|undefined>(undefined);
 const tabRefs=useRef(new Map<string,HTMLButtonElement>());
 useEffect(()=>{
  const request=++listGeneration.current;setLoading(true);setError(null);
  void loadGroupPositions(client,group).then(loaded=>{if(listGeneration.current===request)setRows(loaded);})
   .catch(()=>{if(listGeneration.current===request)setError('Não foi possível carregar a fila autorizada.');})
   .finally(()=>{if(listGeneration.current===request)setLoading(false);});
  return()=>{listGeneration.current++;detailGeneration.current++;};
 },[client,group,reload]);
 async function openRow(row:GroupPosition,requested=false) {
  if(!requestAcademicLeave())return;
  const request=++detailGeneration.current;setOpen(null);setError(null);
  try{const detail=await loadPositionDetail(client,toCommandContext(row.context),row.position.id);if(detailGeneration.current===request)setOpen({row,detail,requested});}
  catch{if(detailGeneration.current===request)setError('Não foi possível carregar a evidência autorizada.');}
 }
 useEffect(()=>{
  if(!requestedPositionId||loading||handledRequest.current===positionRequestKey)return;
  handledRequest.current=positionRequestKey;
  const row=rows.find(candidate=>candidate.position.id===requestedPositionId);
  if(!row){setError('Esta posição não está entre as posições autorizadas.');return;}
  if(readOnly)setTabId('todas');
  void openRow(row,true);
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
 const matches=(row:GroupPosition)=>!search||row.position.escopoCodigo.toLowerCase().includes(search.toLowerCase());
 const inTab=(row:GroupPosition,tab:QueueTab)=>!tab.statuses||tab.statuses.includes(row.position.status);
 const active=tabs.find(tab=>tab.id===tabId)??tabs[0];
 const list=rows.filter(row=>inTab(row,active)&&matches(row));
 function confirmed(receipt:CommandReceipt) {
  setRows(all=>all.map(row=>row.position.id===receipt.resourceId?{...row,position:{...row.position,status:receipt.status as PositionSummary['status'],version:receipt.version}}:row));
 }
 return <section aria-label={readOnly?'Todas as entradas':'Fila de conferência técnica'}>
  <h2>{readOnly?'Todas as entradas':'Conferência técnica'}</h2>
  <p>{readOnly?'Leitura de todas as entradas do ciclo. A conferência é do revisor técnico; as decisões da CAM ficam em Ciclo e fechamento.':'Aceite de evidência sintética; não é aprovação de gratificação ou decisão de indisponibilidade pela CAM.'}</p>
  <button type="button" onClick={()=>{if(requestAcademicLeave()){detailGeneration.current++;setOpen(null);setReload(n=>n+1);}}}>Atualizar fila</button>
  <form role="search" onSubmit={event=>{event.preventDefault();if(!requestAcademicLeave())return;detailGeneration.current++;setOpen(null);setSearch(searchInput.trim());}}>
   <label>Buscar unidade<input type="search" maxLength={100} value={searchInput} onChange={event=>setSearchInput(event.target.value)} /></label>
   <button type="submit">Buscar</button>
  </form>
  <div className="v3-tabs" role="tablist" aria-label="Filtrar entradas">{tabs.map((tab,index)=><button key={tab.id} id={`queue-tab-${tab.id}`} ref={node=>{if(node)tabRefs.current.set(tab.id,node);else tabRefs.current.delete(tab.id);}}
   type="button" role="tab" aria-selected={tab.id===active.id} aria-controls="queue-panel" tabIndex={tab.id===active.id?0:-1} onClick={()=>changeTab(tab.id)} onKeyDown={event=>arrow(event,index)}>
   {tab.label} ({rows.filter(row=>inTab(row,tab)).length})</button>)}</div>
  <div id="queue-panel" role="tabpanel" aria-labelledby={`queue-tab-${active.id}`}>
   {loading&&<p role="status">Carregando fila…</p>}
   <ul>{list.map(row=><li key={row.position.id}><button type="button" onClick={()=>void openRow(row)}>{row.position.escopoCodigo} · {statusLabels[row.position.status]}{row.position.inputValue!==null?` · ${formatDecimal(row.position.inputValue)}`:''}</button></li>)}</ul>
   {!loading&&!list.length&&!error&&<p>Nenhuma posição nesta aba.</p>}
  </div>
  {error&&<p role="alert">{error}</p>}
  {open&&<ReviewEvidence key={open.detail.position.id} client={client} context={open.row.context} detail={open.detail} v3 readOnly={readOnly} focusHeading={open.requested} onConfirmed={confirmed} />}
 </section>;
}
