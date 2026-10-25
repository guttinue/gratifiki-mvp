import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthorizedContext, CycleChecklist, PositionSummary } from '../pilot/types';
import { toCommandContext } from '../context/contextApi';
import { DomainCommandError } from '../pilot/commandApi';
import { loadCycleChecklist, publishCycleDemo, transitionCycle } from './cycleApi';
import { useNavigationDraft } from '../workspace/NavigationSafety';
type Action='consolidate'|'reopen'|'close'|'publish';
type Pending={id:string;version:number;action:Action;reason:string;reference:string;snapshotId:string|null};
function CycleConfirmation({action,onConfirm,onDismiss,trigger,fallback}:{action:Action;onConfirm:()=>void;onDismiss:()=>void;trigger:HTMLButtonElement|null;fallback:HTMLHeadingElement|null}) {
 const modal=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const dialog=modal.current!;
  // showModal puts the dialog in the top layer and makes the entire remaining
  // document inert, including the context picker/logout outside this component.
  dialog.showModal();
  return()=>{
   if(dialog.open)dialog.close();
   // A confirmed command disables/removes its trigger. Keep a stable, relevant
   // focus destination instead of dropping focus to the document body.
   if(trigger?.isConnected&&!trigger.disabled)trigger.focus();
   else if(fallback?.isConnected)fallback.focus();
  };
 },[trigger,fallback]);
 return <dialog ref={modal} aria-label={action==='close'?'Confirmar fechamento':'Confirmar publicação'} onCancel={event=>{event.preventDefault();onDismiss();}} onKeyDown={event=>{
  if(event.key!=='Tab')return;
  const buttons=event.currentTarget.querySelectorAll<HTMLButtonElement>('button');
  const first=buttons[0];const last=buttons[buttons.length-1];
  // Some browsers move focus to browser chrome at a native dialog's edges.
  // Keep this two-action confirmation cyclic in both keyboard directions.
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
 }}>
  <p>{action==='close'?'O snapshot será imutável. Fechar não publica a demonstração.':'Publicação acadêmica separada; não é aprovação institucional.'}</p>
  <button autoFocus type="button" onClick={onConfirm}>{action==='close'?'Confirmar fechamento':'Confirmar publicação'}</button><button type="button" onClick={onDismiss}>Cancelar</button>
 </dialog>;
}
export function CyclePage({client,context,renderExport,authorizedPositions=[],onOpenPosition}:{client:SupabaseClient;context:AuthorizedContext;renderExport?:(checklist:CycleChecklist)=>ReactNode;authorizedPositions?:PositionSummary[];onOpenPosition?:(id:string)=>void}) {
 const [checklist,setChecklist]=useState<CycleChecklist|null>(null);const [error,setError]=useState<string|null>(null);
 const [reason,setReason]=useState('');const [reference,setReference]=useState('');const [confirm,setConfirm]=useState<Action|null>(null);
 const [pending,setPending]=useState<Pending|null>(null);const [busy,setBusy]=useState(false);const [reload,setReload]=useState(0);
 const generation=useRef(0);const active=useRef(true);const inFlight=useRef(false);
 const confirmTrigger=useRef<HTMLButtonElement|null>(null);const heading=useRef<HTMLHeadingElement>(null);
 useNavigationDraft(busy||!!pending||!!reason||!!reference);
 useEffect(()=>{active.current=true;return()=>{active.current=false;generation.current++;};},[]);
 useEffect(()=>{
  const request=++generation.current;setError(null);setChecklist(null);
  void loadCycleChecklist(client,toCommandContext(context)).then(c=>{if(generation.current===request)setChecklist(c);}).catch(()=>{if(generation.current===request)setError('Não foi possível carregar o checklist autorizado do ciclo.');});
  return()=>{generation.current++;};
 },[client,context,reload]);
 async function execute(action:Action){
  if(inFlight.current||!checklist)return;setError(null);
  const operation=pending??{id:crypto.randomUUID(),version:checklist.version,action,reason:reason.trim(),reference:reference.trim(),snapshotId:checklist.snapshotId};
  if(!pending&&((action==='reopen'&&!operation.reason)||(action==='close'&&(!operation.reference.startsWith('DEMO-DECISAO-')||!operation.reference.slice('DEMO-DECISAO-'.length).trim()))||(action==='publish'&&(!operation.reference.startsWith('DEMO-PUBLICACAO-')||!operation.reference.slice('DEMO-PUBLICACAO-'.length).trim())))){setError('Informe motivo de reabertura ou referência de demonstração com sufixo não vazio.');setConfirm(null);return;}
  setPending(operation);setBusy(true);inFlight.current=true;setConfirm(null);
  try{
   const command=toCommandContext(context);
   if(operation.action==='publish')await publishCycleDemo(client,command,operation.snapshotId!,operation.reference,operation.id);
   else await transitionCycle(client,command,operation.version,operation.action,operation.reason,operation.reference,operation.id);
   if(!active.current)return;
   setPending(null);setReason('');setReference('');
   // Re-read durable state: a receipt is never the source of truth for future
   // sessions, snapshot access or publication controls.
   const loaded=await loadCycleChecklist(client,command);if(active.current){setChecklist(loaded);if(operation.action==='close'||operation.action==='publish')heading.current?.focus();}
  }catch(cause){if(active.current){if(cause instanceof DomainCommandError&&cause.confirmedRejected&&cause.code!=='access_denied')setPending(null);setError(cause instanceof Error?cause.message:'Não foi possível confirmar a operação.');}}
  finally{inFlight.current=false;if(active.current)setBusy(false);}
 }
 return <section aria-label="Ciclo CAM"><h2 ref={heading} tabIndex={-1}>Ciclo da demonstração acadêmica</h2><p>Não representa decisão institucional nem pagamento.</p>
  <button type="button" disabled={busy||!!pending} onClick={()=>setReload(n=>n+1)}>Atualizar ciclo</button>
  {!checklist&&!error&&<p role="status">Carregando ciclo…</p>}
  {checklist&&<><p>Estado do ciclo: {checklist.state}</p><p>Esperadas: {checklist.expected} · Recebidas: {checklist.received} · Conferidas: {checklist.reviewed}</p>
   <p>Indisponíveis: {checklist.unavailable} · Decididas: {checklist.decidedUnavailable} · Não aplicáveis: {checklist.notApplicable}</p>
   <ul>{checklist.blockers.map((b,i)=>{
    const target=authorizedPositions.find(position=>position.id===b.positionId);
    return <li key={`${b.positionId}-${b.code}-${i}`}>{target&&<strong>{target.escopoCodigo}: </strong>}{b.message}{target&&onOpenPosition&&<button type="button" onClick={()=>onOpenPosition(target.id)}>Ver pendência de {target.escopoCodigo}</button>}</li>;
   })}</ul>
   {checklist.snapshotId&&<p>Snapshot fechado: {checklist.snapshotId}</p>}<p>Publicação: {checklist.publication}</p>
   <label>Motivo do ciclo<textarea maxLength={1000} disabled={busy||!!pending} value={reason} onChange={e=>setReason(e.target.value)} /></label>
   <label>Referência do ciclo<input maxLength={500} disabled={busy||!!pending} value={reference} onChange={e=>setReference(e.target.value)} /></label>
   {checklist.state==='aberta'&&<button type="button" disabled={busy||!!pending||!checklist.canConsolidate} onClick={()=>void execute('consolidate')}>Iniciar consolidação</button>}
   {checklist.state==='em_consolidacao'&&<><button type="button" disabled={busy||!!pending||!checklist.fullCoverage} onClick={()=>void execute('reopen')}>Retornar à aberta</button><button type="button" disabled={busy||!!pending||!checklist.canClose} onClick={event=>{confirmTrigger.current=event.currentTarget;setConfirm('close');}}>Fechar ciclo</button></>}
   {checklist.snapshotId&&checklist.publication==='nao_publicada'&&<button type="button" disabled={busy||!!pending} onClick={event=>{confirmTrigger.current=event.currentTarget;setConfirm('publish');}}>Publicar demonstração</button>}
   {renderExport?.(checklist)}
  </>}
  {confirm&&<CycleConfirmation action={confirm} trigger={confirmTrigger.current} fallback={heading.current} onConfirm={()=>void execute(confirm)} onDismiss={()=>setConfirm(null)} />}
  {pending&&!busy&&<button type="button" onClick={()=>void execute(pending.action)}>Repetir operação do ciclo</button>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
