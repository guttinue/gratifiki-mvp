import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AuthorizedContext, ContextGroup, PositionSummary } from '../pilot/types';
import { competenceStateLabels } from './displayNames';
import { toCommandContext } from '../context/contextApi';
import { listPositions, loadPositionDetail, type PositionDetail } from '../submission/positionApi';
import { DraftForm } from '../submission/DraftForm';
import { ReviewQueue } from '../review/ReviewQueue';
import { CorrectionForm } from '../review/CorrectionForm';
import { CyclePage } from '../cycle/CyclePage';
import { ExportPanel } from '../export/ExportPanel';
import { EvaluationPage } from '../evaluation/EvaluationPage';
import { LeadershipPage } from '../leadership/LeadershipPage';
import { AuditPage } from '../audit/AuditPage';
import { ScopeAdminPage } from '../admin/ScopeAdminPage';
import { AccessAdminPage } from '../admin/AccessAdminPage';
import { CompetenceAdminPage } from '../admin/CompetenceAdminPage';
import { RuleAdminPage } from '../admin/RuleAdminPage';
import { RuleCatalogPage } from '../admin/RuleCatalogPage';
import { ResultsPage } from '../results/ResultsPage';
import { BatchEntryPage } from '../batch/BatchEntryPage';
import { AcademicDashboard, AcademicV3Dashboard } from './DashboardPage';
import { AcademicNavigation } from './WorkspaceShell';
import { academicPageFromHash, getAcademicDestinations, requestAcademicLeave } from './academicNavigation';
import { NavigationSafety } from './NavigationSafety';
// contexts: every authorized context of the actor (all groups); the model-3 CAM
// decides each pending item with the context of that item's unit and indicator.
export interface AcademicWorkspaceProps { client:SupabaseClient; group:ContextGroup; contexts?:AuthorizedContext[]; onSignOut:()=>void; contextPicker?:ReactNode; isSigningOut?:boolean; signOutError?:string|null }
export function AcademicWorkspace(props:AcademicWorkspaceProps) {
 // Key the owned data/edit subtree to the group and to each of its contexts; no
 // response from a previous actor/link/month, and nothing loaded for a context
 // the group no longer holds, can populate the next selection.
 return <NavigationSafety key={`${props.group.key}|${props.group.contexts.map(({key})=>key).join('|')}`}><AcademicContextWorkspace {...props} /></NavigationSafety>;
}
function AcademicContextWorkspace({client,group,contexts,onSignOut,contextPicker,isSigningOut=false,signOutError}:AcademicWorkspaceProps) {
 // Model-2 pages still operate on one context; the model-3 pages (results,
 // dashboards, rule catalogue) read what they need from the current group.
 const context=group.contexts[0];
 const v3=group.modelo===3;
 const manager=context.role==='gestor_unidade'||context.role==='gestor_distrital';
 const [page,setPage]=useState(()=>academicPageFromHash(context.role,window.location.hash));
 const [adminPage,setAdminPage]=useState<'scopes'|'links'|'competences'|'rules'>('scopes');
 const [positions,setPositions]=useState<PositionSummary[]>([]);
 const [detail,setDetail]=useState<PositionDetail|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [loading,setLoading]=useState(false);
 const [reload,setReload]=useState(0);
 const [camPositions,setCamPositions]=useState<PositionSummary[]>([]);
 const [positionRequest,setPositionRequest]=useState<{id:string;key:number}>();
 const generation=useRef(0);
 const detailGeneration=useRef(0);
 const contentRef=useRef<HTMLElement>(null);
 const pageRef=useRef(page);pageRef.current=page;
 useEffect(()=>{
  function syncPage(){
   const next=academicPageFromHash(context.role,window.location.hash);
   const changed=next!==pageRef.current;
   if(changed&&!requestAcademicLeave()){
    window.history.replaceState({},'',`#academico/${pageRef.current}`);return;
   }
   window.history.replaceState({},'',`#academico/${next}`);
   if(changed){detailGeneration.current++;setDetail(null);setPage(next);contentRef.current?.focus();}
  }
  window.history.replaceState({},'',`#academico/${pageRef.current}`);
  window.addEventListener('hashchange',syncPage);
  return()=>window.removeEventListener('hashchange',syncPage);
 },[context.role]);
 function navigate(destination:string){
  if(destination===page||!getAcademicDestinations(context.role).some(d=>d.id===destination)||!requestAcademicLeave())return;
  detailGeneration.current++;setDetail(null);setPage(destination);
  window.history.pushState({},'',`#academico/${destination}`);
  contentRef.current?.focus();
 }
 useEffect(()=>{
  const request=++generation.current;
  if(context.role!=='area_tecnica'||page!=='preenchimento'||v3) return;
  setLoading(true);setError(null);
  void listPositions(client,toCommandContext(context),{page:1,pageSize:25}).then(page=>{
   if(generation.current===request)setPositions(page.items);
  }).catch(()=>{if(generation.current===request)setError('Não foi possível carregar as posições autorizadas.');})
   .finally(()=>{if(generation.current===request)setLoading(false);});
  return()=>{generation.current++;detailGeneration.current++;};
 },[client,context,reload,page,v3]);
 async function selectPosition(id:string) {
  if(!requestAcademicLeave())return;
  const request=++detailGeneration.current;setDetail(null);setError(null);
  try {const loaded=await loadPositionDetail(client,toCommandContext(context),id);if(detailGeneration.current===request)setDetail(loaded);}
  catch {if(detailGeneration.current===request)setError('Não foi possível carregar o detalhe autorizado.');}
 }
 return <div className="academic-app"><a className="skip-link" href="#academic-content" onClick={event=>{event.preventDefault();contentRef.current?.focus();}}>Pular para o conteúdo</a>
  <aside className="academic-side" aria-label="Menu"><div className="academic-brand"><span className="academic-brand-mark" aria-hidden="true">G</span><span><b>Gratifiki</b><span>Avaliação por desempenho</span></span></div>
   <AcademicNavigation role={context.role} page={page} onNavigate={navigate}/></aside>
  <div className="academic-body"><header className="academic-top">
  <p className="academic-demo-strip">Regra fictícia DEMO-v1 · dados sintéticos · sem efeito institucional</p>
  <div className="academic-top-row"><h1>Contexto acadêmico autorizado</h1>
  <p className="academic-profile">Perfil {context.role} · {context.escopoCodigo} · {context.competenciaCodigo}</p>
  {context.competenciaEstado&&<p className="academic-competence-state"><span aria-hidden="true">· </span><span className="sr-only">Situação da competência: </span>{competenceStateLabels[context.competenciaEstado]}</p>}
  {contextPicker}
  <button type="button" className="academic-signout" disabled={isSigningOut} onClick={()=>{if(requestAcademicLeave())onSignOut();}}>Sair</button></div>
  </header><main id="academic-content" ref={contentRef} tabIndex={-1} className="academic-content">
  {page==='historico'?<AuditPage client={client} context={context}/>
  :v3&&((page==='painel'&&manager)||(page==='resultados'&&(manager||context.role==='cam')))?<ResultsPage client={client} group={group}/>
  :v3&&page==='painel'&&['area_tecnica','revisor_tecnico','cam'].includes(context.role)?<AcademicV3Dashboard client={client} group={group} onNavigate={navigate}/>
  :v3&&page==='regras'&&context.role==='administrador'?<RuleCatalogPage client={client} group={group}/>
  :page==='painel'&&['area_tecnica','revisor_tecnico','cam'].includes(context.role)?<AcademicDashboard client={client} context={context}/>:<>
  {manager&&!v3&&<EvaluationPage client={client} context={context}/>}
  {context.role==='lideranca'&&<LeadershipPage client={client} context={context}/>}
  {context.role==='administrador'&&<><p>Administração de metadados sintéticos, sem acesso a valores de avaliação.</p><nav aria-label="Administração">{([{id:'scopes',label:'Escopos'},{id:'links',label:'Vínculos de negócio'},{id:'competences',label:'Competências e atribuições'},{id:'rules',label:'Regras futuras'}] as const).filter(destination=>!v3||(destination.id!=='rules'&&destination.id!=='competences')).map(destination=><button key={destination.id} type="button" aria-pressed={adminPage===destination.id} onClick={()=>{if(adminPage!==destination.id&&requestAcademicLeave()){setAdminPage(destination.id);contentRef.current?.focus();}}}>{destination.label}</button>)}</nav>{v3&&<p className="v3-note">A configuração do modelo 3 é feita por migração/seed.</p>}{adminPage==='scopes'?<ScopeAdminPage client={client} context={context}/>:adminPage==='links'?<AccessAdminPage client={client} context={context} actorId={context.actorId}/>:adminPage==='competences'?<CompetenceAdminPage client={client} context={context} actorId={context.actorId}/>:<RuleAdminPage client={client} context={context}/>}</>}
  {v3&&context.role==='area_tecnica'&&page==='preenchimento'?<BatchEntryPage client={client} group={group}/>
  :context.role==='area_tecnica'&&<section aria-label="Posições autorizadas">
   <h2>Rascunhos do indicador</h2>
   {loading&&<p role="status">Carregando posições…</p>}
   <button type="button" onClick={()=>{if(requestAcademicLeave()){detailGeneration.current++;setDetail(null);setReload(n=>n+1);}}}>Atualizar consulta</button>
   <ul>{positions.map(position=><li key={position.id}><button type="button" onClick={()=>void selectPosition(position.id)}>{position.escopoCodigo} · {position.status}</button></li>)}</ul>
   {!loading&&!positions.length&&!error&&<p>Nenhuma posição autorizada.</p>}
   {detail&&<section aria-label="Detalhe da posição"><h3>{detail.position.escopoCodigo}</h3>
    {detail.decisions.filter(decision=>
     decision.revisionId===detail.position.revisionId&&
     (decision.type==='devolver'||decision.type==='autorizar_retificacao')
    ).map(decision=><p key={decision.id}>
     {decision.type==='devolver'?'Motivo da devolução técnica':'Motivo da retificação CAM'}: {decision.reason}
    </p>)}
    {detail.position.aplicavel&&detail.position.status==='devolvida'?<CorrectionForm key={detail.position.id} client={client} context={toCommandContext(context)} detail={detail} onSubmitted={receipt=>{
     setPositions(rows=>rows.map(row=>row.id===receipt.resourceId?{...row,status:'enviada',version:receipt.version,revisionId:receipt.revisionId,resultValue:receipt.resultValue}:row));
    }} />:detail.position.aplicavel&&['ausente','rascunho','enviada'].includes(detail.position.status)
     ? <DraftForm key={detail.position.id} actorId={context.actorId} client={client} context={toCommandContext(context)} detail={detail} onSubmitted={(receipt)=>{
      setPositions(rows=>rows.map(row=>row.id===receipt.resourceId?{...row,status:'enviada',version:receipt.version,revisionId:receipt.revisionId,resultValue:receipt.resultValue}:row));
     }} onSaved={(receipt)=>{
      setPositions(rows=>rows.map(row=>row.id===receipt.resourceId?{...row,status:'rascunho',version:receipt.version,revisionId:receipt.revisionId}:row));
     }} /> : <p>Esta posição não está disponível para editar rascunho.</p>}
   </section>}
  </section>}
  {(context.role==='revisor_tecnico'||context.role==='cam')&&(!v3||context.role==='revisor_tecnico'||page==='entradas')&&<ReviewQueue client={client} context={context} group={v3?group:undefined} readOnly={v3&&context.role==='cam'} requestedPositionId={positionRequest?.id} positionRequestKey={positionRequest?.key} onPositionsLoaded={context.role==='cam'?setCamPositions:undefined} />}
  {context.role==='cam'&&(!v3||page==='ciclo')&&<CyclePage key={context.key} client={client} context={context} group={v3?group:undefined} contexts={v3?contexts:undefined} authorizedPositions={camPositions} onOpenPosition={id=>{setPositionRequest(previous=>({id,key:(previous?.key??0)+1}));if(v3)navigate('entradas');}} renderExport={checklist=><ExportPanel client={client} context={context} checklist={checklist}/>} />}
  </>}
  {error&&<p role="alert">{error}</p>}{signOutError&&<p role="alert">{signOutError}</p>}
 </main></div></div>;
}
