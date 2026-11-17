import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthorizedContext, ContextGroup, CycleChecklist, PositionSummary } from '../pilot/types';
import { loadGroupPositions, statusLabels, type GroupPosition } from '../batch/groupPositions';
import { decideUnavailability } from '../review/correctionApi';
import { toCommandContext } from '../context/contextApi';
import { DomainCommandError } from '../pilot/commandApi';
import { loadCycleChecklist, publishCycleDemo, transitionCycle } from './cycleApi';
import { useNavigationDraft } from '../workspace/NavigationSafety';
import { requestAcademicLeave } from '../workspace/academicNavigation';
import { blockerReasons, competenceStateLabels, countByStatus, plural, publicationLabels, scopeName, statusTones } from '../workspace/displayNames';
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
const cycleSteps=['Aberta','Em consolidação','Fechada','Publicada'];
// Model 3 (CAM-02): numbered steps with the V4 descriptions; a frozen cycle names its snapshot.
export function CycleStepper({checklist}:{checklist:CycleChecklist}){
 const published=checklist.publication==='publicada_demo';
 const current=published?3:checklist.state==='fechada'?2:checklist.state==='em_consolidacao'?1:0;
 const hints=['Recebendo e conferindo','Revisão final da CAM',checklist.snapshotId?`Congelado · ${checklist.snapshotId}`:'Resultados congelados','Visível aos gestores'];
 return <ol aria-label="Etapas da competência" className="stepper">{cycleSteps.map((label,index)=>{const done=index<current||published;
  return <li key={label} className={done?'done':index===current?'current':undefined} aria-current={index===current?'step':undefined}><span className="ix" aria-hidden="true">{done?'✓':index+1}</span><b>{label}</b><span className="d">{hints[index]}</span></li>;})}</ol>;
}
// CAM-05: items 1-3 come from the positions, 4-7 from the checklist (spec §5.1).
export function closingChecklist(checklist:CycleChecklist,counts:ReturnType<typeof countByStatus>):{done:boolean;title:string;sub:string}[]{
 const ready=checklist.ready??checklist.reviewed;const withTechnical=counts.ausente+counts.rascunho;const inReview=counts.enviada+counts.em_revisao;
 return [
  {done:withTechnical===0,title:'Todas as entradas enviadas',sub:withTechnical?`${withTechnical} ainda com a área técnica`:'Nenhuma com a área técnica'},
  {done:counts.devolvida===0,title:'Nenhuma devolução pendente',sub:counts.devolvida?`${plural(counts.devolvida,'devolvida aguarda','devolvidas aguardam')} correção`:'Sem devoluções abertas'},
  {done:inReview===0,title:'Fila do revisor vazia',sub:inReview?`${inReview} aguardando conferência`:'Tudo conferido'},
  {done:ready===checklist.expected,title:`${ready} de ${checklist.expected} prontas`,sub:'Condição para consolidar'},
  {done:checklist.state!=='aberta',title:'Consolidação iniciada',sub:'Preenchimento fica só para consulta'},
  {done:checklist.snapshotId!==null,title:'Competência fechada',sub:checklist.snapshotId?'Congelado · snapshot registrado':'Pede a referência da decisão'},
  {done:checklist.publication==='publicada_demo',title:'Demonstração publicada',sub:checklist.publication==='publicada_demo'?'Visível aos gestores':'Pede a referência da publicação'},
 ];
}
const positionLabel=(position:PositionSummary)=>[scopeName(position.escopoCodigo),position.indicatorCode].filter(Boolean).join(' · ');
// CAM-04: a blocker names its position from the loaded list; one outside it keeps the server message.
export function CycleBlockers({blockers,positions,onOpenPosition}:{blockers:CycleChecklist['blockers'];positions:PositionSummary[];onOpenPosition?:(id:string)=>void}){
 return <ul aria-label="Requer ação" className="req-list">{blockers.map((b,i)=>{
  const positionId=b.positionId;const target=positions.find(position=>position.id===positionId);const key=`${positionId}-${b.code}-${i}`;
  if(!target)return <li key={key} className="req-note"><span>{b.message}</span>{positionId&&onOpenPosition&&<button type="button" onClick={()=>onOpenPosition(positionId)}>{`Ver pendência: ${b.message}`}</button>}</li>;
  // Only status blockers read from the entry status; an accepted "indisponível" waits for the CAM, and rule/territory blockers keep the server reason.
  const status=target.status;
  const reason=(b.code==='missing_submission'||b.code==='review_pending')&&status in blockerReasons?blockerReasons[status as keyof typeof blockerReasons]:b.code==='unavailability_pending'?'Aguarda decisão da CAM':b.message;
  const row=<><i className={`dot t-${statusTones[status]}`} aria-hidden="true"/><span className="todo-txt"><strong>{`${positionLabel(target)}${target.indicatorName?` ${target.indicatorName}`:''}`}</strong><span>{reason}</span></span>
   <span className={`v3-badge v3-st-${status}`}>{statusLabels[status]}</span><span className="chev" aria-hidden="true">›</span></>;
  return <li key={key}>{onOpenPosition?<button type="button" className="req-item" aria-label={`Ver entrada ${positionLabel(target)}`} onClick={()=>onOpenPosition(target.id)}>{row}</button>:<div className="req-item">{row}</div>}</li>;
 })}</ul>;
}
const stateLabels:Record<string,string>={indisponivel:'Indisponível',nao_aplicavel:'Não se aplica'};
// Model 3: accepted "indisponível" / "não se aplica" wait for the CAM decision (reference + reason).
type DecisionFields=Record<string,{reference:string;reason:string}>;
// The typed text lives in CyclePage: re-reading the cycle unmounts this list, and a decision on one item must not wipe the others.
// The CAM listing is widened across units, so the context that listed a position
// may be another unit's. A decision uses the actor's CAM context for the
// position's own unit and indicator (the listing context's indicator).
function PendingDecisions({client,positionIds,rows,camContexts,fields,setFields,onOpenPosition,onDecided}:{client:SupabaseClient;positionIds:string[];rows:GroupPosition[];camContexts:AuthorizedContext[];fields:DecisionFields;setFields:Dispatch<SetStateAction<DecisionFields>>;onOpenPosition?:(id:string)=>void;onDecided:(label:string)=>void}) {
 const [errors,setErrors]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState<string|null>(null);
 const attempts=useRef(new Map<string,{signature:string;id:string}>());const inFlight=useRef(false);const active=useRef(true);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useNavigationDraft(!!busy);
 const without=<T,>(all:Record<string,T>,key:string)=>Object.fromEntries(Object.entries(all).filter(([id])=>id!==key));
 const decisionContext=(row:GroupPosition)=>camContexts.find(c=>c.escopoId===row.position.escopoId&&c.indicadorId===row.context.indicadorId);
 async function decide(row:GroupPosition,decisionContext:AuthorizedContext) {
  const id=row.position.id;const field=fields[id]??{reference:'',reason:''};
  const reference=field.reference.trim();const reason=field.reason.trim();
  if(inFlight.current||!reference||!reason)return;
  const signature=JSON.stringify([row.position.version,reference,reason]);
  const previous=attempts.current.get(id);
  const operationId=previous?.signature===signature?previous.id:crypto.randomUUID();
  attempts.current.set(id,{signature,id:operationId});
  inFlight.current=true;setBusy(id);setErrors(all=>without(all,id));
  try{
   await decideUnavailability(client,toCommandContext(decisionContext),id,row.position.version,reference,reason,operationId);
   if(!active.current)return;
   attempts.current.delete(id);setFields(all=>without(all,id));onDecided(positionLabel(row.position));
  }catch(cause){if(active.current)setErrors(all=>({...all,[id]:cause instanceof DomainCommandError?cause.message:'Não foi possível confirmar a decisão. Tente de novo.'}));}
  finally{inFlight.current=false;if(active.current)setBusy(null);}
 }
 return <section aria-labelledby="cycle-decisions" className="v3-panel"><h3 id="cycle-decisions">Decisões pendentes da CAM</h3>
  <p>O revisor aceitou estes itens sem número. Eles só contam depois da decisão da CAM, com referência e motivo.</p>
  <ul aria-label="Decisões pendentes da CAM">{positionIds.map(positionId=>{
   const row=rows.find(candidate=>candidate.position.id===positionId);
   if(!row)return <li key={positionId}>Posição fora da lista autorizada carregada.</li>;
   const code=row.position.escopoCodigo;const label=positionLabel(row.position);const field=fields[positionId]??{reference:'',reason:''};
   const change=(patch:Partial<typeof field>)=>setFields(all=>({...all,[positionId]:{...field,...patch}}));
   const target=decisionContext(row);
   return <li key={positionId}><strong>{label} · {stateLabels[row.position.estadoDado??'']??'Aguardando decisão'}</strong>
    {onOpenPosition&&<button type="button" onClick={()=>onOpenPosition(positionId)}>Ver entrada de {label}</button>}
    {target?<>
     <label>Referência da decisão<input maxLength={500} disabled={busy===positionId} value={field.reference} onChange={event=>change({reference:event.target.value})} /></label>
     <label>Motivo da decisão<textarea maxLength={1000} disabled={busy===positionId} value={field.reason} onChange={event=>change({reason:event.target.value})} /></label>
     <button type="button" disabled={!!busy||!field.reference.trim()||!field.reason.trim()} onClick={()=>void decide(row,target)}>Decidir {label}</button>
    </>:<p>{`Abra o contexto de ${scopeName(code)} para decidir.`}</p>}
    {errors[positionId]&&<p role="alert">{errors[positionId]}</p>}
   </li>;
  })}</ul>
 </section>;
}
export function CyclePage({client,context,group,contexts,renderExport,authorizedPositions=[],onOpenPosition}:{client:SupabaseClient;context:AuthorizedContext;group?:ContextGroup;contexts?:AuthorizedContext[];renderExport?:(checklist:CycleChecklist)=>ReactNode;authorizedPositions?:PositionSummary[];onOpenPosition?:(id:string)=>void}) {
 const v3=group?.modelo===3;
 // Every CAM context of the actor in this competence, from all groups.
 const camContexts=(contexts??group?.contexts??[]).filter(c=>c.role==='cam'&&c.competenciaId===context.competenciaId);
 // null until read: the checklist items 1-3 never count an unread list as done.
 const [groupRows,setGroupRows]=useState<GroupPosition[]|null>(null);
 const [decided,setDecided]=useState<string|null>(null);
 const [decisionFields,setDecisionFields]=useState<DecisionFields>({});
 const [checklist,setChecklist]=useState<CycleChecklist|null>(null);const [error,setError]=useState<string|null>(null);
 const [reason,setReason]=useState('');const [reference,setReference]=useState('');const [confirm,setConfirm]=useState<Action|null>(null);
 const [pending,setPending]=useState<Pending|null>(null);const [busy,setBusy]=useState(false);const [reload,setReload]=useState(0);
 const generation=useRef(0);const active=useRef(true);const inFlight=useRef(false);
 const confirmTrigger=useRef<HTMLButtonElement|null>(null);const heading=useRef<HTMLHeadingElement>(null);const decidedStatus=useRef<HTMLParagraphElement>(null);
 const decisionsDirty=Object.values(decisionFields).some(field=>field.reference||field.reason);
 useNavigationDraft(busy||!!pending||!!reason||!!reference||decisionsDirty);
 useEffect(()=>{active.current=true;return()=>{active.current=false;generation.current++;};},[]);
 // The decided item and the whole checklist unmount while the cycle is read again; the receipt stays.
 useEffect(()=>{if(decided)decidedStatus.current?.focus();},[decided]);
 useEffect(()=>{
  const request=++generation.current;setError(null);setChecklist(null);
  void loadCycleChecklist(client,toCommandContext(context)).then(c=>{if(generation.current===request)setChecklist(c);}).catch(()=>{if(generation.current===request)setError('Não foi possível carregar o checklist autorizado do ciclo.');});
  return()=>{generation.current++;};
 },[client,context,reload]);
 useEffect(()=>{
  if(!group||group.modelo!==3)return;
  // A stale list never feeds checklist items 1-3 while the cycle is read again.
  let current=true;setGroupRows(null);
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
 const positions=v3?(groupRows??[]).map(row=>row.position):authorizedPositions;
 const primary=v3?'primary':undefined;
 const ready=checklist?checklist.ready??checklist.reviewed:0;
 // CAM-03: why the consolidation button is disabled (ready includes decided unavailability, so "prontas").
 const missing=v3&&checklist?.state==='aberta'&&ready<checklist.expected?checklist.expected-ready:0;
 const checks=v3&&checklist&&groupRows?closingChecklist(checklist,countByStatus(groupRows)):null;const checksDone=checks?.filter(item=>item.done).length??0;
 const controls=checklist&&<>
  <label>Motivo do ciclo<textarea maxLength={1000} disabled={busy||!!pending} value={reason} onChange={e=>setReason(e.target.value)} /></label>
  <label>Referência do ciclo<input maxLength={500} disabled={busy||!!pending} value={reference} onChange={e=>setReference(e.target.value)} /></label>
  {checklist.state==='aberta'&&<button type="button" className={primary} aria-describedby={missing?'cycle-why':undefined} disabled={busy||!!pending||!checklist.canConsolidate} onClick={()=>void execute('consolidate')}>Iniciar consolidação</button>}
  {checklist.state==='em_consolidacao'&&<><button type="button" disabled={busy||!!pending||!checklist.fullCoverage} onClick={()=>void execute('reopen')}>Retornar à aberta</button><button type="button" className={primary} disabled={busy||!!pending||!checklist.canClose} onClick={event=>{confirmTrigger.current=event.currentTarget;setConfirm('close');}}>Fechar ciclo</button></>}
  {checklist.snapshotId&&checklist.publication==='nao_publicada'&&<button type="button" className={primary} disabled={busy||!!pending} onClick={event=>{confirmTrigger.current=event.currentTarget;setConfirm('publish');}}>Publicar demonstração</button>}
  {renderExport?.(checklist)}
 </>;
 // Model 3: the shell shows the page heading; focus after closing or publishing goes to the closing panel.
 return <section aria-label="Ciclo CAM">{!v3&&<><h2 ref={heading} tabIndex={-1}>Ciclo da demonstração acadêmica</h2><p>Não representa decisão institucional nem pagamento.</p></>}
  <button type="button" disabled={busy||!!pending} onClick={()=>{if(decisionsDirty&&!requestAcademicLeave())return;setReload(n=>n+1);}}>Atualizar ciclo</button>
  {decided&&<p ref={decidedStatus} tabIndex={-1} role="status">Decisão registrada para {decided}.</p>}
  {!checklist&&!error&&<p role="status">Carregando ciclo…</p>}
  {checklist&&(v3?<><CycleStepper checklist={checklist}/>
   {missing>0&&<p id="cycle-why" className="sub">{`Para consolidar, as ${checklist.expected} entradas precisam estar prontas. ${missing===1?'Falta':'Faltam'} ${missing}.`}</p>}
   <div className="grid2"><div className="stack">
    {decisions.length>0&&<PendingDecisions client={client} positionIds={decisions.map(b=>b.positionId!)} rows={groupRows??[]} camContexts={camContexts} fields={decisionFields} setFields={setDecisionFields} onOpenPosition={onOpenPosition} onDecided={label=>{setDecided(label);setReload(n=>n+1);}} />}
    {blockers.length>0?<section aria-labelledby="cycle-blockers" className="block"><div className="block-head"><h3 id="cycle-blockers">Requer ação<span className="pill" aria-hidden="true">{blockers.length}</span></h3></div>
      <div className="box"><CycleBlockers blockers={blockers} positions={positions} onOpenPosition={onOpenPosition}/></div></section>
     :decisions.length===0&&<section aria-labelledby="cycle-blockers" className="block"><div className="block-head"><h3 id="cycle-blockers">Nada bloqueia</h3></div>
      <div className="box"><div className="empty"><strong>Todas as entradas estão prontas.</strong></div></div></section>}
   </div><div className="stack">
    {checks&&<section aria-labelledby="cycle-checks" className="box"><div className="check-head"><div className="block-head"><h3 id="cycle-checks">Checklist do fechamento</h3><span className="sub">{`${checksDone}/${checks.length} concluídos`}</span></div>
      <span className="progress" role="progressbar" aria-label="Checklist do fechamento" aria-valuemin={0} aria-valuemax={checks.length} aria-valuenow={checksDone}><span style={{width:`${checksDone/checks.length*100}%`}}/></span></div>
     <ul className="checks">{checks.map(item=><li key={item.title} className={item.done?'is-done':undefined}><span className={`ck ${item.done?'ok':'no'}`} aria-hidden="true">{item.done?'✓':''}</span>
      <div><strong>{item.title}</strong><span className="sr-only">{item.done?' (concluído)':' (pendente)'}</span><span className="sub">{item.sub}</span></div></li>)}</ul></section>}
    <section aria-labelledby="cycle-closing" className="box facts-box"><h3 id="cycle-closing" ref={heading} tabIndex={-1}>Fechamento e publicação</h3>
     {/* Each row reads "Label: value" as one text (E2E gates); the colon is for that text only. */}
     <dl className="facts">{[['Situação do ciclo',competenceStateLabels[checklist.state]],['Publicação',publicationLabels[checklist.publication]],['Snapshot',checklist.snapshotId??'Ainda não fechado']].map(([label,value])=>
      <div key={label}><dt>{label}<span className="sr-only">:</span></dt>{' '}<dd>{value}</dd></div>)}</dl>
     {controls}
     <p className="sub">Publicação de demonstração acadêmica. Não é decisão institucional nem pagamento.</p>
    </section></div></div></>
  :<><p>Estado do ciclo: {checklist.state}</p><p>Esperadas: {checklist.expected} · Recebidas: {checklist.received} · Conferidas: {checklist.reviewed}</p>
   <p>Indisponíveis: {checklist.unavailable} · Decididas: {checklist.decidedUnavailable} · Não aplicáveis: {checklist.notApplicable}</p>
   <ul>{blockers.map((b,i)=>{
    // A blocker outside the loaded queue page is still opened by id through the
    // authorized detail read; its code is not invented while it is unknown.
    const positionId=b.positionId;const target=positions.find(position=>position.id===positionId);
    return <li key={`${positionId}-${b.code}-${i}`}>{target&&<strong>{target.escopoCodigo}: </strong>}{b.message}{positionId&&onOpenPosition&&<button type="button" onClick={()=>onOpenPosition(positionId)}>{target?`Ver pendência de ${target.escopoCodigo}`:`Ver pendência: ${b.message}`}</button>}</li>;
   })}</ul>
   {checklist.snapshotId&&<p>Snapshot fechado: {checklist.snapshotId}</p>}<p>Publicação: {checklist.publication}</p>
   {controls}
  </>)}
  {confirm&&<CycleConfirmation action={confirm} trigger={confirmTrigger.current} fallback={heading.current} onConfirm={()=>void execute(confirm)} onDismiss={()=>setConfirm(null)} />}
  {pending&&!busy&&<button type="button" onClick={()=>void execute(pending.action)}>Repetir operação do ciclo</button>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
