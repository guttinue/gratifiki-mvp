import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthorizedContext, ContextGroup, CycleChecklist, PositionSummary } from '../pilot/types';
import { loadGroupPositions, type GroupPosition } from '../batch/groupPositions';
import { decideUnavailability } from '../review/correctionApi';
import { toCommandContext } from '../context/contextApi';
import { DomainCommandError } from '../pilot/commandApi';
import { loadCycleChecklist, publishCycleDemo, transitionCycle } from './cycleApi';
import { useNavigationDraft } from '../workspace/NavigationSafety';
import { requestAcademicLeave } from '../workspace/academicNavigation';
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
const stateLabels:Record<string,string>={indisponivel:'Indisponível',nao_aplicavel:'Não se aplica'};
// Model 3: accepted "indisponível" / "não se aplica" wait for the CAM decision (reference + reason).
type DecisionFields=Record<string,{reference:string;reason:string}>;
// The typed text lives in CyclePage: re-reading the cycle unmounts this list, and a decision on one item must not wipe the others.
function PendingDecisions({client,positionIds,rows,fields,setFields,onOpenPosition,onDecided}:{client:SupabaseClient;positionIds:string[];rows:GroupPosition[];fields:DecisionFields;setFields:Dispatch<SetStateAction<DecisionFields>>;onOpenPosition?:(id:string)=>void;onDecided:(label:string)=>void}) {
 const [errors,setErrors]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState<string|null>(null);
 const attempts=useRef(new Map<string,{signature:string;id:string}>());const inFlight=useRef(false);const active=useRef(true);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useNavigationDraft(!!busy);
 const without=<T,>(all:Record<string,T>,key:string)=>Object.fromEntries(Object.entries(all).filter(([id])=>id!==key));
 async function decide(row:GroupPosition) {
  const id=row.position.id;const field=fields[id]??{reference:'',reason:''};
  const reference=field.reference.trim();const reason=field.reason.trim();
  if(inFlight.current||!reference||!reason)return;
  const signature=JSON.stringify([row.position.version,reference,reason]);
  const previous=attempts.current.get(id);
  const operationId=previous?.signature===signature?previous.id:crypto.randomUUID();
  attempts.current.set(id,{signature,id:operationId});
  inFlight.current=true;setBusy(id);setErrors(all=>without(all,id));
  try{
   await decideUnavailability(client,toCommandContext(row.context),id,row.position.version,reference,reason,operationId);
   if(!active.current)return;
   attempts.current.delete(id);setFields(all=>without(all,id));onDecided(row.position.escopoCodigo);
  }catch(cause){if(active.current)setErrors(all=>({...all,[id]:cause instanceof DomainCommandError?cause.message:'Não foi possível confirmar a decisão. Tente de novo.'}));}
  finally{inFlight.current=false;if(active.current)setBusy(null);}
 }
 return <section aria-labelledby="cycle-decisions"><h3 id="cycle-decisions">Decisões pendentes da CAM</h3>
  <p>O revisor aceitou estes itens sem número. Eles só contam depois da decisão da CAM, com referência e motivo.</p>
  <ul aria-label="Decisões pendentes da CAM">{positionIds.map(positionId=>{
   const row=rows.find(candidate=>candidate.position.id===positionId);
   if(!row)return <li key={positionId}>Posição fora da lista autorizada carregada.</li>;
   const code=row.position.escopoCodigo;const field=fields[positionId]??{reference:'',reason:''};
   const change=(patch:Partial<typeof field>)=>setFields(all=>({...all,[positionId]:{...field,...patch}}));
   return <li key={positionId}><strong>{code} · {stateLabels[row.position.estadoDado??'']??'Aguardando decisão'}</strong>
    {onOpenPosition&&<button type="button" onClick={()=>onOpenPosition(positionId)}>Ver entrada de {code}</button>}
    <label>Referência da decisão<input maxLength={500} disabled={busy===positionId} value={field.reference} onChange={event=>change({reference:event.target.value})} /></label>
    <label>Motivo da decisão<textarea maxLength={1000} disabled={busy===positionId} value={field.reason} onChange={event=>change({reason:event.target.value})} /></label>
    <button type="button" disabled={!!busy||!field.reference.trim()||!field.reason.trim()} onClick={()=>void decide(row)}>Decidir {code}</button>
    {errors[positionId]&&<p role="alert">{errors[positionId]}</p>}
   </li>;
  })}</ul>
 </section>;
}
export function CyclePage({client,context,group,renderExport,authorizedPositions=[],onOpenPosition}:{client:SupabaseClient;context:AuthorizedContext;group?:ContextGroup;renderExport?:(checklist:CycleChecklist)=>ReactNode;authorizedPositions?:PositionSummary[];onOpenPosition?:(id:string)=>void}) {
 const v3=group?.modelo===3;
 const [groupRows,setGroupRows]=useState<GroupPosition[]>([]);
 const [decided,setDecided]=useState<string|null>(null);
 const [decisionFields,setDecisionFields]=useState<DecisionFields>({});
 const [checklist,setChecklist]=useState<CycleChecklist|null>(null);const [error,setError]=useState<string|null>(null);
 const [reason,setReason]=useState('');const [reference,setReference]=useState('');const [confirm,setConfirm]=useState<Action|null>(null);
 const [pending,setPending]=useState<Pending|null>(null);const [busy,setBusy]=useState(false);const [reload,setReload]=useState(0);
 const generation=useRef(0);const active=useRef(true);const inFlight=useRef(false);
 const confirmTrigger=useRef<HTMLButtonElement|null>(null);const heading=useRef<HTMLHeadingElement>(null);
 const decisionsDirty=Object.values(decisionFields).some(field=>field.reference||field.reason);
 useNavigationDraft(busy||!!pending||!!reason||!!reference||decisionsDirty);
 useEffect(()=>{active.current=true;return()=>{active.current=false;generation.current++;};},[]);
 useEffect(()=>{
  const request=++generation.current;setError(null);setChecklist(null);
  void loadCycleChecklist(client,toCommandContext(context)).then(c=>{if(generation.current===request)setChecklist(c);}).catch(()=>{if(generation.current===request)setError('Não foi possível carregar o checklist autorizado do ciclo.');});
  return()=>{generation.current++;};
 },[client,context,reload]);
 useEffect(()=>{
  if(!group||group.modelo!==3)return;
  let current=true;
  void loadGroupPositions(client,group).then(rows=>{if(current)setGroupRows(rows);}).catch(()=>{if(current)setError('Não foi possível carregar as posições autorizadas.');});
  return()=>{current=false;};
 },[client,group,reload]);
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
 const decisions=v3&&checklist?checklist.blockers.filter(b=>b.code==='unavailability_pending'&&b.positionId):[];
 const blockers=checklist?checklist.blockers.filter(b=>!decisions.includes(b)):[];
 const positions=v3?groupRows.map(row=>row.position):authorizedPositions;
 return <section aria-label="Ciclo CAM"><h2 ref={heading} tabIndex={-1}>Ciclo da demonstração acadêmica</h2><p>Não representa decisão institucional nem pagamento.</p>
  <button type="button" disabled={busy||!!pending} onClick={()=>{if(decisionsDirty&&!requestAcademicLeave())return;setReload(n=>n+1);}}>Atualizar ciclo</button>
  {decided&&<p role="status">Decisão registrada para {decided}.</p>}
  {!checklist&&!error&&<p role="status">Carregando ciclo…</p>}
  {checklist&&<><p>Estado do ciclo: {checklist.state}</p><p>Esperadas: {checklist.expected} · Recebidas: {checklist.received} · Conferidas: {checklist.reviewed}</p>
   <p>Indisponíveis: {checklist.unavailable} · Decididas: {checklist.decidedUnavailable} · Não aplicáveis: {checklist.notApplicable}</p>
   {v3&&<p>{`${checklist.ready??0} de ${checklist.expected} prontas`}</p>}
   {v3&&decisions.length>0&&<PendingDecisions client={client} positionIds={decisions.map(b=>b.positionId!)} rows={groupRows} fields={decisionFields} setFields={setDecisionFields} onOpenPosition={onOpenPosition} onDecided={label=>{setDecided(label);setReload(n=>n+1);heading.current?.focus();}} />}
   {v3&&blockers.length>0&&<h3>Bloqueios</h3>}
   {(!v3||blockers.length>0)&&<ul aria-label={v3?'Bloqueios':undefined}>{blockers.map((b,i)=>{
    // A blocker outside the loaded queue page is still opened by id through the
    // authorized detail read; its code is not invented while it is unknown.
    const positionId=b.positionId;const target=positions.find(position=>position.id===positionId);
    return <li key={`${positionId}-${b.code}-${i}`}>{target&&<strong>{target.escopoCodigo}: </strong>}{b.message}{positionId&&onOpenPosition&&<button type="button" onClick={()=>onOpenPosition(positionId)}>{target?`Ver pendência de ${target.escopoCodigo}`:`Ver pendência: ${b.message}`}</button>}</li>;
   })}</ul>}
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
