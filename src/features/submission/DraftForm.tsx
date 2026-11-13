import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CommandContext, CommandReceipt, DraftInput } from '../pilot/types';
import { parseInputDecimal } from '../pilot/decimal';
import { DomainCommandError } from '../pilot/commandApi';
import { loadAcademicPending,saveAcademicPending,clearAcademicPending,PendingEntryStorageError,type AcademicPendingSubmit } from '../entry/pendingEntry';
import { saveDraft, type PositionDetail } from './positionApi';
import { submitPosition } from './submitApi';
import { useNavigationDraft } from '../workspace/NavigationSafety';
export interface DraftFormProps {
 client:SupabaseClient;context:CommandContext;detail:PositionDetail;actorId?:string;
 // Model-3 groups only: offers the "Não se aplica" state.
 allowNotApplicable?:boolean;
 onSaved:(receipt:CommandReceipt)=>void|Promise<void>;
 onSubmitted?:(receipt:CommandReceipt)=>void|Promise<void>;
}
function validPeriod(period:string):boolean {
 return /^\d{4}-\d{2}-\d{2}$/.test(period)&&Number.isFinite(Date.parse(`${period}T00:00:00Z`))&&new Date(`${period}T00:00:00Z`).toISOString().slice(0,10)===period;
}
export function DraftForm({client,context,detail,actorId,allowNotApplicable=false,onSaved,onSubmitted}:DraftFormProps) {
 const revision=detail.revisions.find(r=>r.id===detail.position.revisionId);
 const initial:DraftInput={estadoDado:revision?.estadoDado??'valor',valor:revision?.value??null,fonte:revision?.source??'',periodoFonte:revision?.sourcePeriod??'',motivo:revision?.reason??''};
 const [state,setState]=useState(initial.estadoDado);
 const [value,setValue]=useState(initial.valor??'');
 const [source,setSource]=useState(initial.fonte);
 const [period,setPeriod]=useState(initial.periodoFonte);
 const [reason,setReason]=useState(initial.motivo);
 const [version,setVersion]=useState(detail.position.version);
 const inheritedDraft=detail.position.status==='rascunho'&&!!actorId&&revision?.authorId!==actorId;
 const [savedInput,setSavedInput]=useState<DraftInput|null>(detail.position.status==='rascunho'&&!inheritedDraft?initial:null);
 const [busy,setBusy]=useState<'save'|'submit'|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [saved,setSaved]=useState(false);
 const [submitted,setSubmitted]=useState(false);
 const [resultValue,setResultValue]=useState(detail.position.resultValue);
 const scope={actorId:actorId??'',vinculoId:context.vinculoId,competenciaId:context.competenciaId,indicadorId:context.indicadorId,positionId:detail.position.id};
 const identity=JSON.stringify(scope);
 const currentIdentity=useRef(identity);currentIdentity.current=identity;
 const [restored]=useState(()=>{try{return {pending:actorId?loadAcademicPending(scope):null,failed:false};}catch{return {pending:null,failed:true};}});
 const [pendingSubmit,setPendingSubmit]=useState<AcademicPendingSubmit|null>(restored.pending);
 const [storageFailed,setStorageFailed]=useState(restored.failed);
 const active=useRef(true);
 const inFlight=useRef(false);
 const pendingSave=useRef<{signature:string;id:string}|null>(null);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const sent=detail.position.status==='enviada'||submitted;
 const locked=!!busy||!!pendingSubmit||sent||storageFailed;
 function input():DraftInput {
  const normalized={estadoDado:state,valor:state!=='valor'||!value.trim()?null:parseInputDecimal(value),fonte:source.trim(),periodoFonte:period.trim(),motivo:reason.trim()};
  if(normalized.fonte.length>500||normalized.motivo.length>1000||(normalized.periodoFonte&&!validPeriod(normalized.periodoFonte)))throw new Error('invalid_input');
  return normalized;
 }
 function showError(cause:unknown) {
  if(cause instanceof PendingEntryStorageError){setStorageFailed(true);setError('O armazenamento da operação está indisponível. Nenhum novo envio será iniciado; recarregue em um navegador com armazenamento disponível.');}
  else setError(cause instanceof DomainCommandError?cause.message:'Não foi possível confirmar a operação. O conteúdo foi preservado; tente novamente.');
 }
 async function handleSave(event:FormEvent) {
  event.preventDefault();if(inFlight.current||locked)return;
  setError(null);setSaved(false);
  let normalized:DraftInput;
  try{normalized=input();}catch{setError('Informe um decimal válido (até 4 casas), uma data válida e respeite os limites dos campos.');return;}
  const signature=JSON.stringify([identity,version,normalized]);
  if(pendingSave.current?.signature!==signature)pendingSave.current={signature,id:crypto.randomUUID()};
  const requestIdentity=identity;
  inFlight.current=true;setBusy('save');
  try{
   const receipt=await saveDraft(client,context,detail.position.id,version,normalized,pendingSave.current.id);
   if(!active.current||currentIdentity.current!==requestIdentity)return;
   setVersion(receipt.version);pendingSave.current=null;setSavedInput(normalized);setSaved(true);
   await onSaved(receipt);
  }catch(cause){if(active.current&&currentIdentity.current===requestIdentity)showError(cause);}
  finally{inFlight.current=false;if(active.current&&currentIdentity.current===requestIdentity)setBusy(null);}
 }
 async function handleSubmit() {
  if(inFlight.current||storageFailed||submitted)return;
  const requestIdentity=identity;
  setError(null);setSaved(false);
  let operation:AcademicPendingSubmit|null=null;
  try{
   if(!actorId)throw new PendingEntryStorageError();
   operation=loadAcademicPending(scope);
   if(!operation){
    const normalized=input();
    if(sent||!savedInput||JSON.stringify(normalized)!==JSON.stringify(savedInput))throw new DomainCommandError('invalid_state');
    if(!normalized.fonte||!validPeriod(normalized.periodoFonte)||(normalized.estadoDado==='valor'&&normalized.valor===null)||(normalized.estadoDado!=='valor'&&!normalized.motivo))throw new DomainCommandError('invalid_input');
    operation={operationId:crypto.randomUUID(),expectedVersion:version};
    saveAcademicPending(scope,operation);
   }
   setPendingSubmit(operation);inFlight.current=true;setBusy('submit');
   const receipt=await submitPosition(client,context,detail.position.id,operation.expectedVersion,operation.operationId);
   if(!active.current||currentIdentity.current!==requestIdentity)return;
   clearAcademicPending(scope,operation.operationId);
   setPendingSubmit(null);setVersion(receipt.version);setResultValue(receipt.resultValue);setSubmitted(true);
   await onSubmitted?.(receipt);
  }catch(cause){
   if(active.current&&currentIdentity.current===requestIdentity){
    // A denied retry cannot tell whether an earlier attempt committed before
    // access was revoked. Keep its key, just as for network/decoder ambiguity.
    if(cause instanceof DomainCommandError&&cause.confirmedRejected&&cause.code!=='access_denied'&&operation){
     try{clearAcademicPending(scope,operation.operationId);setPendingSubmit(null);}catch(storageError){showError(storageError);return;}
    }
    showError(cause);
   }
  }
  finally{inFlight.current=false;if(active.current&&currentIdentity.current===requestIdentity)setBusy(null);}
 }
 let dirty=true;
 try{dirty=!savedInput||JSON.stringify(input())!==JSON.stringify(savedInput);}catch{/* invalid field remains visible */}
 let navigationDirty=true;
 try{navigationDirty=JSON.stringify(input())!==JSON.stringify(savedInput??initial);}catch{/* preserve invalid edits */}
 useNavigationDraft(!submitted&&!sent&&(navigationDirty||!!busy||!!pendingSubmit));
 return <form onSubmit={handleSave} aria-label="Rascunho do indicador">
  <p>Salvar preserva o rascunho. Enviar fixa os dados e aplica somente a regra sintética de demonstração.</p>
  {inheritedDraft&&!saved&&<p>Rascunho de outro informante: salve uma revisão própria antes de enviar. A autoria e o conteúdo anteriores serão preservados.</p>}
  <label>Estado do dado<select value={state} disabled={locked} onChange={e=>setState(e.target.value as DraftInput['estadoDado'])}><option value="valor">Valor</option><option value="indisponivel">Indisponível</option>{allowNotApplicable&&<option value="nao_aplicavel">Não se aplica</option>}</select></label>
  <label>Valor<input inputMode="decimal" value={value} disabled={locked||state!=='valor'} onChange={e=>setValue(e.target.value)} /></label>
  <label>Fonte<input value={source} maxLength={500} disabled={locked} onChange={e=>setSource(e.target.value)} /></label>
  <label>Período da fonte<input type="date" value={period} disabled={locked} onChange={e=>setPeriod(e.target.value)} /></label>
  <label>Motivo<textarea value={reason} maxLength={1000} disabled={locked} onChange={e=>setReason(e.target.value)} /></label>
  {storageFailed&&!error&&<p role="alert">O armazenamento da operação está indisponível. O envio foi bloqueado.</p>}
  {error&&<p role="alert">{error}</p>}{saved&&<p role="status">Rascunho salvo. Ainda não enviado.</p>}
  {submitted&&<p role="status">Envio confirmado. Dados fixados para revisão.</p>}
  {sent&&<p>{resultValue===null?(state==='nao_aplicavel'?'Sem resultado numérico: não se aplica.':'Sem resultado numérico: dado indisponível.'):`Resultado sintético: ${resultValue}`}</p>}
  {pendingSubmit&&<p>Há um envio pendente de confirmação. Repetir usa a mesma operação, sem novo cálculo.</p>}
  <button type="submit" disabled={locked}>{busy==='save'?'Salvando…':'Salvar rascunho'}</button>
  <button type="button" onClick={()=>void handleSubmit()} disabled={!!busy||storageFailed||submitted||(!pendingSubmit&&(sent||dirty))}>{busy==='submit'?'Enviando…':pendingSubmit?'Repetir envio pendente':'Enviar'}</button>
 </form>;
}
