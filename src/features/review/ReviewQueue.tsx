import type { SupabaseClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthorizedContext, CommandReceipt, PositionSummary } from '../pilot/types';
import { toCommandContext } from '../context/contextApi';
import { DomainCommandError } from '../pilot/commandApi';
import { listPositions, loadPositionDetail, type PositionDetail } from '../submission/positionApi';
import { reviewPosition, startReview } from './reviewApi';
import { CamDecisionForm } from './CorrectionForm';
import { useNavigationDraft } from '../workspace/NavigationSafety';
import { requestAcademicLeave } from '../workspace/academicNavigation';
interface ReviewQueueProps {client:SupabaseClient;context:AuthorizedContext;requestedPositionId?:string;positionRequestKey?:number;onPositionsLoaded?:(positions:PositionSummary[])=>void}
export function ReviewQueue(props:ReviewQueueProps) {
 return <ContextReviewQueue key={props.context.key} {...props} />;
}
function ContextReviewQueue({client,context,requestedPositionId,positionRequestKey,onPositionsLoaded}:ReviewQueueProps) {
 const [positions,setPositions]=useState<PositionSummary[]>([]);
 const [detail,setDetail]=useState<PositionDetail|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const [reload,setReload]=useState(0);
 const listGeneration=useRef(0);const detailGeneration=useRef(0);
 const detailHeading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{
  const request=++listGeneration.current;setLoading(true);setError(null);
  void listPositions(client,toCommandContext(context),{page:1,pageSize:25}).then(page=>{if(listGeneration.current===request){setPositions(page.items);onPositionsLoaded?.(page.items);}})
   .catch(()=>{if(listGeneration.current===request)setError('Não foi possível carregar a fila autorizada.');})
   .finally(()=>{if(listGeneration.current===request)setLoading(false);});
  return()=>{listGeneration.current++;detailGeneration.current++;};
 },[client,context,reload,onPositionsLoaded]);
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
  {loading&&<p role="status">Carregando fila…</p>}
  <ul>{positions.map(position=><li key={position.id}><button type="button" onClick={()=>void selectPosition(position.id)}>{position.escopoCodigo} · {position.status}</button></li>)}</ul>
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
function ReviewEvidence({client,context,detail,onConfirmed}:ReviewQueueProps&{detail:PositionDetail;onConfirmed:(receipt:CommandReceipt)=>void}) {
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
  <h3>{detail.position.escopoCodigo}</h3><p>Estado: {status} · revisão {revision?.number??'—'}</p>
  {revision&&<dl><dt>Fonte</dt><dd>{revision.source}</dd><dt>Período</dt><dd>{revision.sourcePeriod}</dd><dt>Estado do dado</dt><dd>{revision.estadoDado}</dd><dt>Valor informado</dt><dd>{revision.value??'Sem valor numérico'}</dd><dt>Justificativa da fonte</dt><dd>{revision.reason||'—'}</dd></dl>}
  <p>{detail.position.estadoDado==='indisponivel'?'Sem resultado numérico. Aceitar a evidência não decide a indisponibilidade; decisão CAM pendente.':detail.position.resultValue===null?'Sem resultado numérico disponível.':`Resultado sintético preservado: ${detail.position.resultValue}`}</p>
  <ul>{detail.decisions.map(decision=><li key={decision.id}>{decision.type}: {decision.reason||'Sem observação'}</li>)}</ul>
  <label>Motivo da conferência<textarea maxLength={1000} value={reason} disabled={busy||!!pending||status!=='em_revisao'} onChange={event=>setReason(event.target.value)} /></label>
  {error&&<p role="alert">{error}</p>}{confirmation&&<p role="status">{confirmation}</p>}
  {pending&&!busy&&<><p>A confirmação está pendente. Repetir preserva comando, versão, motivo e chave originais.</p><button type="button" onClick={()=>void execute(pending.action)}>Repetir operação pendente</button></>}
  {status==='enviada'&&<button type="button" disabled={busy||!!pending} onClick={()=>void execute('start')}>Iniciar revisão</button>}
  {status==='em_revisao'&&<><button type="button" disabled={busy||!!pending} onClick={()=>void execute('accept')}>Aceitar evidência</button><button type="button" disabled={busy||!!pending} onClick={()=>void execute('return')}>Devolver com motivo</button></>}
 </section>;
}
