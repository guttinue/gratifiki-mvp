import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import type { CommandContext } from '../pilot/types';
import { DomainCommandError } from '../pilot/commandApi';
import { scheduleDemoRule } from './configurationApi';
import { useNavigationDraft } from '../workspace/NavigationSafety';
type Pending={id:string;factor:string;month:string;reference:string};
export function RuleAdminPage({client,context}:{client:SupabaseClient;context:CommandContext}){
 const [factor,setFactor]=useState(''),[month,setMonth]=useState(''),[reference,setReference]=useState('');
 const [pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[success,setSuccess]=useState(false);
 const active=useRef(true),inFlight=useRef(false);useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useNavigationDraft(busy||!!pending||(!success&&(!!factor||!!month||!!reference)));
 async function save(){
  if(inFlight.current)return;const operation=pending??{id:crypto.randomUUID(),factor,month,reference};
  setPending(operation);setBusy(true);inFlight.current=true;setError(null);setSuccess(false);
  try{await scheduleDemoRule(client,context,operation.factor,operation.month,operation.reference,operation.id);if(active.current){setPending(null);setSuccess(true);}}
  catch(cause){if(active.current){if(cause instanceof DomainCommandError&&cause.confirmedRejected&&cause.code!=='access_denied')setPending(null);setError(cause instanceof Error?cause.message:'Não foi possível confirmar o agendamento.');}}
  finally{inFlight.current=false;if(active.current)setBusy(false);}
 }
 return <section aria-label="Regra futura"><h2>Versão futura do fator sintético</h2><p>Demonstração acadêmica: não é editor de portaria. O agendamento não muda regra, vigência ou resultado de competência já aberta.</p>
  <form onChangeCapture={()=>setSuccess(false)} onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy||!!pending}><legend>Agendar nova versão</legend>
   <label>Fator sintético futuro<input required inputMode="decimal" value={factor} onChange={e=>setFactor(e.target.value)}/></label>
   <label>Primeiro mês da versão<input required type="date" value={month} onChange={e=>setMonth(e.target.value)}/></label>
   <label>Referência de aprovação de demonstração<input required maxLength={500} value={reference} onChange={e=>setReference(e.target.value)}/></label>
   <button type="submit">Agendar regra futura</button>
  </fieldset></form>
  {pending&&!busy&&<button type="button" onClick={()=>void save()}>Repetir agendamento pendente</button>}
  {success&&<p role="status">Versão futura agendada. Competências anteriores preservadas.</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
