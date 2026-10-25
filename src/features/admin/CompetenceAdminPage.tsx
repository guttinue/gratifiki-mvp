import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import type { CommandContext } from '../pilot/types';
import { DomainCommandError } from '../pilot/commandApi';
import { loadAdminCatalog } from './adminApi';
import type { AdminCatalog } from './adminTypes';
import { loadDemoConfiguration, openDemoCompetence, reassignDemoPosition, type AssignmentInput, type DemoConfiguration } from './configurationApi';
import { useNavigationDraft } from '../workspace/NavigationSafety';
type Pending={id:string;kind:'open';month:string;assignments:AssignmentInput[]}|{id:string;kind:'reassign';positionId:string;version:number;input:Pick<AssignmentInput,'informanteId'|'revisorId'>;reason:string};
export function CompetenceAdminPage({client,context,actorId}:{client:SupabaseClient;context:CommandContext;actorId:string}){
 const [catalog,setCatalog]=useState<AdminCatalog|null>(null),[configuration,setConfiguration]=useState<DemoConfiguration|null>(null),[reload,setReload]=useState(0);
 const [month,setMonth]=useState(''),[assignments,setAssignments]=useState<Record<string,AssignmentInput>>({});
 const [positionId,setPositionId]=useState(''),[informant,setInformant]=useState(''),[reviewer,setReviewer]=useState(''),[reason,setReason]=useState('');
 const [pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[success,setSuccess]=useState<Pending['kind']|false>(false);
 const generation=useRef(0),active=useRef(true),inFlight=useRef(false);
 const assignmentBaseline=useRef<Record<string,AssignmentInput>>({});
 const openingMonthBaseline=useRef('');
 const assignmentsChanged=JSON.stringify(assignments)!==JSON.stringify(assignmentBaseline.current);
 // Opening and reassignment are separate commands: confirming one cannot
 // acknowledge the other form's unsent month or assignment choices.
 useNavigationDraft(busy||!!pending||assignmentsChanged||month!==openingMonthBaseline.current||(!success&&(!!positionId||!!reason)));
 useEffect(()=>{active.current=true;return()=>{active.current=false;generation.current++;};},[]);
 useEffect(()=>{
  const request=++generation.current;setCatalog(null);setConfiguration(null);setError(null);
  void Promise.all([loadAdminCatalog(client,context),loadDemoConfiguration(client,context)]).then(([nextCatalog,nextConfiguration])=>{
   if(generation.current!==request)return;setCatalog(nextCatalog);setConfiguration(nextConfiguration);
   const scopes=nextCatalog.scopes.filter(s=>s.ativo);
   const suggestions=Object.fromEntries(scopes.map(s=>[s.id,{escopoId:s.id,informanteId:eligible(nextCatalog,s.id,'area_tecnica')[0]?.actorId??'',revisorId:eligible(nextCatalog,s.id,'revisor_tecnico')[0]?.actorId??'',aplicavel:true}]));
   // Automatic suggestions establish a baseline, not an edit. Preserve dirty
   // choices on metadata refresh; new automatic scopes get their own baseline.
   assignmentBaseline.current=Object.fromEntries(scopes.map(s=>[s.id,assignmentBaseline.current[s.id]??suggestions[s.id]]));
   setAssignments(previous=>Object.fromEntries(scopes.map(s=>[s.id,previous[s.id]??suggestions[s.id]])));
  }).catch(cause=>{if(generation.current===request)setError(cause instanceof Error?cause.message:'Não foi possível consultar a configuração.');});
  return()=>{generation.current++;};
 },[client,context,reload]);
 function eligible(c:AdminCatalog,scope:string,role:'area_tecnica'|'revisor_tecnico'){
  // Candidate hints only. Current account/link/window authority is always SQL.
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Recife',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const today=['year','month','day'].map(type=>parts.find(part=>part.type===type)!.value).join('-');
  return c.accounts.filter(a=>a.ativo&&a.actorId!==actorId&&c.links.some(l=>l.actorId===a.actorId&&l.role===role&&l.escopoId===scope&&l.indicadorId===context.indicadorId&&l.ativo&&l.vigenciaInicio!==null&&l.vigenciaInicio<=today&&(l.vigenciaFim===null||l.vigenciaFim>=today)));
 }
 const current=configuration?.competences.find(c=>c.id===context.competenciaId);
 const positions=configuration?.positions.filter(p=>p.competenceId===context.competenciaId)??[];
 const selected=positions.find(p=>p.id===positionId);
 async function execute(kind:'open'|'reassign'){
  if(inFlight.current||!catalog)return;
  let operation=pending;
  if(!operation){
   if(kind==='open')operation={id:crypto.randomUUID(),kind,month,assignments:catalog.scopes.filter(s=>s.ativo).map(s=>({...assignments[s.id]}))};
   else{if(!selected)return;operation={id:crypto.randomUUID(),kind,positionId:selected.id,version:selected.version,input:{informanteId:informant,revisorId:reviewer},reason};}
  }
  setPending(operation);setBusy(true);inFlight.current=true;setError(null);setSuccess(false);
  try{
   if(operation.kind==='open')await openDemoCompetence(client,context,operation.month,operation.assignments,operation.id);
   else await reassignDemoPosition(client,context,operation.positionId,operation.version,operation.input,operation.reason,operation.id);
   if(active.current){
    if(operation.kind==='open'){
     assignmentBaseline.current=Object.fromEntries(operation.assignments.map(assignment=>[assignment.escopoId,{...assignment}]));
     openingMonthBaseline.current=operation.month;
    }
    setPending(null);setSuccess(operation.kind);setPositionId('');setReload(n=>n+1);
   }
  }catch(cause){if(active.current){if(cause instanceof DomainCommandError&&cause.confirmedRejected&&cause.code!=='access_denied')setPending(null);setError(cause instanceof Error?cause.message:'Não foi possível confirmar a configuração.');}}
  finally{inFlight.current=false;if(active.current)setBusy(false);}
 }
 return <section aria-label="Competências e atribuições"><h2>Competências e atribuições de demonstração</h2>
  <p>Universo completo de unidades e distritos ativos. Vínculos compatíveis devem existir antes, na área Vínculos de negócio; esta tela não cria vínculos nem contas.</p>
  <button type="button" disabled={busy||!!pending} onClick={()=>{setPositionId('');setReload(n=>n+1);}}>Atualizar configuração</button>
  {!configuration&&!error&&<p role="status">Carregando configuração…</p>}
  {catalog&&configuration&&<>
   <h3>Competências registradas</h3><ul>{configuration.competences.map(c=><li key={c.id}>{c.codigo} · {c.state} · versão {c.version}</li>)}</ul>
   <h3>Versões sintéticas preservadas</h3><ul>{configuration.rules.map(r=><li key={r.id}>Versão {r.version} · fator {r.factor} · {r.startMonth??'baseline fixada'}{r.reference?` · ${r.reference}`:''}</li>)}</ul>
   <form onChangeCapture={()=>setSuccess(false)} onSubmit={e=>{e.preventDefault();void execute('open');}}><fieldset disabled={busy||!!pending}><legend>Abrir mês futuro</legend>
    <label>Mês da nova competência<input type="date" required value={month} onChange={e=>setMonth(e.target.value)}/></label>
    {catalog.scopes.filter(s=>s.ativo).map(s=>{const assignment=assignments[s.id];if(!assignment)return null;return <fieldset key={s.id}><legend>{s.codigo}</legend>
     <label>Informante de {s.codigo}<select required value={assignment.informanteId} onChange={e=>setAssignments({...assignments,[s.id]:{...assignment,informanteId:e.target.value}})}><option value="">Selecione vínculo</option>{eligible(catalog,s.id,'area_tecnica').map(a=><option key={a.actorId} value={a.actorId}>{a.label}</option>)}</select></label>
     <label>Revisor de {s.codigo}<select required value={assignment.revisorId} onChange={e=>setAssignments({...assignments,[s.id]:{...assignment,revisorId:e.target.value}})}><option value="">Selecione vínculo</option>{eligible(catalog,s.id,'revisor_tecnico').map(a=><option key={a.actorId} value={a.actorId}>{a.label}</option>)}</select></label>
     <label><input type="checkbox" checked={assignment.aplicavel} onChange={e=>setAssignments({...assignments,[s.id]:{...assignment,aplicavel:e.target.checked}})}/>Aplicável: {s.codigo}</label>
    </fieldset>;})}
    <p>Após abrir, o conjunto, a aplicabilidade, o território e a regra não podem ser removidos ou alterados para ocultar faltantes.</p><button type="submit" disabled={!catalog.scopes.some(s=>s.ativo)}>Abrir competência de demonstração</button>
   </fieldset></form>
   <form onChangeCapture={()=>setSuccess(false)} onSubmit={e=>{e.preventDefault();void execute('reassign');}}><fieldset disabled={busy||!!pending||current?.state!=='aberta'}><legend>Reatribuir no mês do contexto selecionado</legend>
    <label>Posição para reatribuição<select required value={positionId} onChange={e=>{const p=positions.find(row=>row.id===e.target.value);setPositionId(e.target.value);setInformant(p?.informanteId??'');setReviewer(p?.revisorId??'');setReason('');}}><option value="">Selecione</option>{positions.map(p=><option key={p.id} value={p.id}>{catalog.scopes.find(s=>s.id===p.escopoId)?.codigo??p.escopoId} · versão {p.version}</option>)}</select></label>
    {selected&&<>
     <label>Novo informante<select required value={informant} onChange={e=>setInformant(e.target.value)}><option value="">Selecione vínculo</option>{eligible(catalog,selected.escopoId,'area_tecnica').map(a=><option key={a.actorId} value={a.actorId}>{a.label}</option>)}</select></label>
     <label>Novo revisor<select required value={reviewer} onChange={e=>setReviewer(e.target.value)}><option value="">Selecione vínculo</option>{eligible(catalog,selected.escopoId,'revisor_tecnico').map(a=><option key={a.actorId} value={a.actorId}>{a.label}</option>)}</select></label>
     <label>Motivo da reatribuição<textarea required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
     <p>Autoria passada é preservada. Rascunho herdado exige novo salvamento; conferência em andamento exige nova tomada de responsabilidade.</p><button type="submit">Salvar reatribuição</button>
    </>}
   </fieldset></form>
  </>}
  {pending&&!busy&&<button type="button" onClick={()=>void execute(pending.kind)}>Repetir configuração pendente</button>}
  {success&&<><p role="status">Configuração confirmada.</p>{success==='reassign'&&<p>Somente a reatribuição foi confirmada. As escolhas de abertura não foram enviadas por esta operação.</p>}<p>Recarregue a página para consultar os novos contextos autorizados.</p></>}{error&&<p role="alert">{error}</p>}
 </section>;
}
