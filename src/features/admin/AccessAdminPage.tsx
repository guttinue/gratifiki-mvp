import { useEffect, useId, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext } from '../pilot/types';
import { DomainCommandError } from '../pilot/commandApi';
import type { BusinessLinkInput } from './adminTypes';
import { businessLinks, businessRoles, setDemoBusinessLink } from './adminApi';
import { useAdminCatalog } from './useAdminCatalog';
import { useNavigationDraft } from '../workspace/NavigationSafety';
import { requestAcademicLeave } from '../workspace/academicNavigation';
import { plural, roleLabels, scopeName } from '../workspace/displayNames';
type Pending={id:string;actorId:string;version:number;input:BusinessLinkInput};
// v4 (model 3 only): closed form behind "Novo vínculo", V4 table and role names; model 2 keeps its screen.
export function AccessAdminPage({client,context,actorId,v4=false}:{client:SupabaseClient;context:CommandContext;actorId:string;v4?:boolean}){
 const {catalog,error:loadError,refresh}=useAdminCatalog(client,context);const [target,setTarget]=useState(''),[input,setInput]=useState<BusinessLinkInput>({role:'area_tecnica',escopoId:'',indicadorId:context.indicadorId,ativo:true,vigenciaInicio:'',vigenciaFim:null});
 const [pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[success,setSuccess]=useState(false);const active=useRef(true),inFlight=useRef(false),firstField=useRef<HTMLSelectElement>(null),formId=useId();
 const [open,setOpen]=useState(false),[focusKey,setFocusKey]=useState(0);
 const shown=!v4||open,dirty=!success&&(!!target||!!input.escopoId||!!input.vigenciaInicio||!!input.vigenciaFim||input.role!=='area_tecnica'||!input.ativo);
 useEffect(()=>{if(focusKey)firstField.current?.focus();},[focusKey]);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useNavigationDraft(busy||!!pending||dirty);
 function toggleForm(){
  if(!open){setOpen(true);setFocusKey(k=>k+1);return;}
  if(!requestAcademicLeave())return;
  setOpen(false);setTarget('');setInput(i=>({...i,role:'area_tecnica',escopoId:'',ativo:true,vigenciaInicio:'',vigenciaFim:null}));setSuccess(false);
 }
 const existing=catalog?.links.find(l=>l.actorId===target&&l.role===input.role&&l.escopoId===input.escopoId&&l.indicadorId===input.indicadorId);
 async function save(){
  if(inFlight.current)return;const operation=pending??{id:crypto.randomUUID(),actorId:target,version:existing?.version??0,input:{...input}};
  setPending(operation);setBusy(true);inFlight.current=true;setError(null);setSuccess(false);
  try{await setDemoBusinessLink(client,context,operation.actorId,operation.version,operation.input,operation.id);if(active.current){setPending(null);setSuccess(true);refresh();}}
  catch(cause){if(active.current){if(cause instanceof DomainCommandError&&cause.confirmedRejected&&cause.code!=='access_denied')setPending(null);setError(cause instanceof Error?cause.message:'Não foi possível confirmar o vínculo.');}}
  finally{inFlight.current=false;if(active.current)setBusy(false);}
 }
 return <section aria-label="Vínculos de negócio"><h2>Vínculos de contas de demonstração</h2><p>Somente outras contas fictícias pré-provisionadas. Não altera senha, Auth, atribuição de posição ou cria administrador.</p>
  <button type="button" disabled={busy||!!pending} onClick={refresh}>Atualizar vínculos</button>
  {v4&&<button type="button" aria-expanded={open} aria-controls={formId} disabled={busy||!!pending} onClick={toggleForm}>Novo vínculo</button>}
  {!catalog&&!loadError&&<p role="status">Carregando vínculos…</p>}
  {catalog&&<><div className={v4?'v4-tbl':'table-scroll'}><table className={v4?undefined:'v3-table'} aria-label="Vínculos cadastrados"><thead><tr><th scope="col">Pessoa</th><th scope="col">Papel</th><th scope="col">Escopo</th><th scope="col">Indicador</th><th scope="col">Situação</th>{!v4&&<th scope="col" className="r">Versão</th>}<th scope="col"><span className="sr-only">Ação</span></th></tr></thead>
   <tbody>{businessLinks(catalog,actorId).map(l=>{const label=catalog.accounts.find(a=>a.actorId===l.actorId)?.label??l.actorId;const scope=catalog.scopes.find(s=>s.id===l.escopoId)?.codigo??l.escopoId;return<tr key={l.id}>
    <td data-label="Pessoa">{label}</td><td data-label="Papel">{roleLabels[l.role]}</td><td data-label="Escopo">{scopeName(scope)}</td><td data-label="Indicador">{catalog.indicators.find(i=>i.id===l.indicadorId)?.codigo??l.indicadorId}</td>
    <td data-label="Situação">{v4?<span className={`v3-badge ${l.ativo?'t-ok':'t-neutral'}`}>{l.ativo?'Ativo':'Inativo'}</span>:l.ativo?'Ativo':'Inativo'}</td>{!v4&&<td className="r">{l.version}</td>}
    <td><button type="button" disabled={busy||!!pending||!catalog.accounts.some(a=>a.actorId===l.actorId&&a.ativo)} onClick={()=>{if(!requestAcademicLeave())return;setTarget(l.actorId);setInput({role:l.role as BusinessLinkInput['role'],escopoId:l.escopoId,indicadorId:l.indicadorId,ativo:l.ativo,vigenciaInicio:l.vigenciaInicio,vigenciaFim:l.vigenciaFim});setOpen(true);setFocusKey(k=>k+1);setSuccess(false);}}>Editar <span className="sr-only">{v4?`vínculo ${label} · ${roleLabels[l.role]} · ${scopeName(scope)}`:`vínculo ${label} · ${l.role} · ${scope}`}</span></button></td></tr>;})}</tbody></table>{v4&&<p className="tbl-foot">{plural(businessLinks(catalog,actorId).filter(l=>l.ativo).length,'vínculo ativo','vínculos ativos')}</p>}</div>
   {shown&&<form id={formId} onChangeCapture={()=>setSuccess(false)} onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy||!!pending}><legend>Conceder, atualizar ou revogar vínculo</legend>
    <label>Conta de demonstração<select ref={firstField} required value={target} onChange={e=>setTarget(e.target.value)}><option value="">Selecione</option>{catalog.accounts.filter(a=>a.ativo&&a.actorId!==actorId).map(a=><option key={a.actorId} value={a.actorId}>{a.label}</option>)}</select></label>
    <label>Papel de negócio<select value={input.role} onChange={e=>setInput({...input,role:e.target.value as BusinessLinkInput['role']})}>{businessRoles.map(role=><option key={role} value={role}>{v4?roleLabels[role]:role}</option>)}</select></label>
    <label>Escopo do vínculo<select required value={input.escopoId} onChange={e=>setInput({...input,escopoId:e.target.value})}><option value="">Selecione</option>{catalog.scopes.filter(s=>s.ativo||s.id===existing?.escopoId).map(s=><option key={s.id} value={s.id}>{v4?scopeName(s.codigo):s.codigo}</option>)}</select></label>
    <label>Início da vigência<input required type="date" value={input.vigenciaInicio} onChange={e=>setInput({...input,vigenciaInicio:e.target.value})}/></label>
    <label>Fim da vigência<input type="date" value={input.vigenciaFim??''} onChange={e=>setInput({...input,vigenciaFim:e.target.value||null})}/></label>
    <label><input type="checkbox" checked={input.ativo} onChange={e=>setInput({...input,ativo:e.target.checked})}/>Vínculo ativo</label>
    <p>Versão esperada: {existing?.version??0}</p><button type="submit" className="primary">Salvar vínculo</button>
   </fieldset></form>}</>}
  {pending&&!busy&&<button type="button" onClick={()=>void save()}>Repetir vínculo pendente</button>}
  {success&&<p role="status">Vínculo salvo.</p>}{(error||loadError)&&<p role="alert">{error||loadError}</p>}
 </section>;
}
