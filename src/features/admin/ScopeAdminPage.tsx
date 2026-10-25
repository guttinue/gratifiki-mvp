import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext } from '../pilot/types';
import { DomainCommandError } from '../pilot/commandApi';
import type { ScopeInput } from './adminTypes';
import { saveDemoScope } from './adminApi';
import { useAdminCatalog } from './useAdminCatalog';
import { useNavigationDraft } from '../workspace/NavigationSafety';
import { requestAcademicLeave } from '../workspace/academicNavigation';
type Pending={id:string;scopeId:string|null;version:number;input:ScopeInput};
const empty:ScopeInput={codigo:'',tipo:'distrito',distritoId:null,ativo:true};
export function ScopeAdminPage({client,context}:{client:SupabaseClient;context:CommandContext}){
 const {catalog,error:loadError,refresh}=useAdminCatalog(client,context);const [input,setInput]=useState<ScopeInput>(empty),[scopeId,setScopeId]=useState<string|null>(null),[version,setVersion]=useState(0);
 const [pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[success,setSuccess]=useState(false);const active=useRef(true),inFlight=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useNavigationDraft(busy||!!pending||(!success&&(!!scopeId||JSON.stringify(input)!==JSON.stringify(empty))));
 async function save(){
  if(inFlight.current)return;const operation=pending??{id:crypto.randomUUID(),scopeId,version,input:{...input,codigo:input.codigo.trim()}};
  setPending(operation);setBusy(true);inFlight.current=true;setError(null);setSuccess(false);
  try{await saveDemoScope(client,context,operation.scopeId,operation.version,operation.input,operation.id);if(active.current){setPending(null);setInput(empty);setScopeId(null);setVersion(0);setSuccess(true);refresh();}}
  catch(cause){if(active.current){if(cause instanceof DomainCommandError&&cause.confirmedRejected&&cause.code!=='access_denied')setPending(null);setError(cause instanceof Error?cause.message:'Não foi possível confirmar o cadastro.');}}
  finally{inFlight.current=false;if(active.current)setBusy(false);}
 }
 return <section aria-label="Cadastros de escopos"><h2>Unidades e distritos de demonstração</h2><p>Desativar impede novos usos; não apaga posições, territórios ou snapshots anteriores.</p>
  <button type="button" disabled={busy||!!pending} onClick={refresh}>Atualizar cadastros</button>
  {!catalog&&!loadError&&<p role="status">Carregando cadastros…</p>}
  {catalog&&<><ul>{catalog.scopes.map(s=><li key={s.id}>{s.codigo} · {s.tipo} · {s.ativo?'ativo':'inativo'} · versão {s.version} <button type="button" disabled={busy||!!pending} onClick={()=>{if(!requestAcademicLeave())return;setScopeId(s.id);setVersion(s.version);setInput({codigo:s.codigo,tipo:s.tipo,distritoId:s.distritoId,ativo:s.ativo});setSuccess(false);}}>Editar {s.codigo}</button></li>)}</ul>
   <button type="button" disabled={busy||!!pending} onClick={()=>{if(!requestAcademicLeave())return;setScopeId(null);setVersion(0);setInput(empty);setSuccess(false);}}>Novo escopo</button>
   <form onChangeCapture={()=>setSuccess(false)} onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy||!!pending}><legend>{scopeId?'Editar escopo':'Criar escopo'}</legend>
    <label>Código do escopo<input required maxLength={100} value={input.codigo} onChange={e=>setInput({...input,codigo:e.target.value})}/></label>
    <label>Tipo do escopo<select value={input.tipo} onChange={e=>setInput({...input,tipo:e.target.value as ScopeInput['tipo'],distritoId:null})}><option value="distrito">distrito</option><option value="unidade">unidade</option></select></label>
    {input.tipo==='unidade'&&<label>Distrito atual<select required value={input.distritoId??''} onChange={e=>setInput({...input,distritoId:e.target.value||null})}><option value="">Selecione</option>{catalog.scopes.filter(s=>s.tipo==='distrito'&&(s.ativo||s.id===input.distritoId)&&s.id!==scopeId).map(s=><option key={s.id} value={s.id}>{s.codigo}</option>)}</select></label>}
    <label><input type="checkbox" checked={input.ativo} onChange={e=>setInput({...input,ativo:e.target.checked})}/>Escopo ativo</label>
    <button type="submit">Salvar escopo</button>
   </fieldset></form></>}
  {pending&&!busy&&<button type="button" onClick={()=>void save()}>Repetir cadastro pendente</button>}
  {success&&<p role="status">Cadastro salvo.</p>}{(error||loadError)&&<p role="alert">{error||loadError}</p>}
 </section>;
}
