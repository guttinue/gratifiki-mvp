import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AuthorizedContext, ContextGroup, PositionSummary, Role } from '../pilot/types';
import { competenceLabel, competenceStateLabels, roleLabels, scopeSummary } from './displayNames';
import { pickDefaultGroup, roleOrder } from '../context/contextGroups';
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
import { AdminSummary } from '../admin/AdminSummary';
import { ResultsPage } from '../results/ResultsPage';
import { BatchEntryPage } from '../batch/BatchEntryPage';
import { loadGroupPositions } from '../batch/groupPositions';
import { AcademicDashboard, AcademicV3Dashboard, type UnitFocus } from './DashboardPage';
import { AcademicNavigation } from './WorkspaceShell';
import { academicPageFromHash, academicPageHeading, getAcademicDestinations, requestAcademicLeave } from './academicNavigation';
import { NavigationSafety } from './NavigationSafety';
// The painel's unit request: the unit to open and, for a to-do, the field to focus there (used by the fill screen from Task 6).
type UnitRequest={unitId:string}&Partial<UnitFocus>;
// Where opening a unit from the painel leads, by role (spec §5.1).
const unitDestinations:Partial<Record<Role,string>>={area_tecnica:'preenchimento',revisor_tecnico:'conferencia',cam:'resultados',gestor_distrital:'resultados'};
// Menu counts (spec §5.1, SH-03): the destination that shows the count and the statuses it counts. Other roles: none.
const menuCounts:Partial<Record<Role,{page:string;counts:(status:PositionSummary['status'])=>boolean}>>={
 area_tecnica:{page:'preenchimento',counts:status=>status==='ausente'||status==='rascunho'||status==='devolvida'},
 revisor_tecnico:{page:'conferencia',counts:status=>status==='enviada'||status==='em_revisao'},
 cam:{page:'ciclo',counts:status=>status!=='validada'},
};
// contexts: every authorized context of the actor (all groups); the model-3 CAM
// decides each pending item with the context of that item's unit and indicator.
// groups/onSelectGroup: every authorized group and the guarded switch to one of
// them (the model-3 header picks month and role through it).
export interface AcademicWorkspaceProps { client:SupabaseClient; group:ContextGroup; contexts?:AuthorizedContext[]; onSignOut:()=>void; contextPicker?:ReactNode; isSigningOut?:boolean; signOutError?:string|null; groups?:ContextGroup[]; onSelectGroup?:(key:string)=>void }
export function AcademicWorkspace(props:AcademicWorkspaceProps) {
 // Key the owned data/edit subtree to the group and to each of its contexts; no
 // response from a previous actor/link/month, and nothing loaded for a context
 // the group no longer holds, can populate the next selection.
 return <NavigationSafety key={`${props.group.key}|${props.group.contexts.map(({key})=>key).join('|')}`}><AcademicContextWorkspace {...props} /></NavigationSafety>;
}
function AcademicContextWorkspace({client,group,contexts,onSignOut,contextPicker,isSigningOut=false,signOutError,groups,onSelectGroup}:AcademicWorkspaceProps) {
 // Model-2 pages still operate on one context; the model-3 pages (results,
 // dashboards, rule catalogue) read what they need from the current group.
 const context=group.contexts[0];
 const v3=group.modelo===3;
 const manager=context.role==='gestor_unidade'||context.role==='gestor_distrital';
 const [page,setPage]=useState(()=>academicPageFromHash(context.role,window.location.hash));
 // Model 3 opens "Usuários e vínculos" on the business links (AD-02); model 2 keeps scopes first.
 const [adminPage,setAdminPage]=useState<'scopes'|'links'|'competences'|'rules'>(v3?'links':'scopes');
 const [positions,setPositions]=useState<PositionSummary[]>([]);
 const [detail,setDetail]=useState<PositionDetail|null>(null);
 const [error,setError]=useState<string|null>(null);
 const [loading,setLoading]=useState(false);
 const [reload,setReload]=useState(0);
 const [camPositions,setCamPositions]=useState<PositionSummary[]>([]);
 const [positionRequest,setPositionRequest]=useState<{id:string;key:number}>();
 const [unitRequest,setUnitRequest]=useState<UnitRequest>();
 const generation=useRef(0);
 const detailGeneration=useRef(0);
 const contentRef=useRef<HTMLElement>(null);
 const pageRef=useRef(page);pageRef.current=page;
 const [menuOpen,setMenuOpen]=useState(false);
 const [othersOpen,setOthersOpen]=useState(false);
 const menuToggle=useRef<HTMLButtonElement>(null);
 const menuRef=useRef<HTMLElement>(null);
 const [navCounts,setNavCounts]=useState<Partial<Record<string,number>>>({});
 // Read on mount and on each page change; the CAM count only while the month is open (preflight F3).
 // A failed read shows no count and no alert. Reading never runs a command.
 useEffect(()=>{
  const counted=menuCounts[context.role];
  // The month state can change without a remount: drop the old count before skipping the read.
  if(!v3||!counted||(context.role==='cam'&&context.competenciaEstado!=='aberta')){setNavCounts({});return;}
  let current=true;
  void loadGroupPositions(client,group).then(rows=>{if(current)setNavCounts({[counted.page]:rows.filter(row=>counted.counts(row.position.status)).length});})
   .catch(()=>{if(current)setNavCounts({});});
  return()=>{current=false;};
 },[client,group,page,v3,context.role,context.competenciaEstado]);
 function closeMenu(){setMenuOpen(false);menuToggle.current?.focus();}
 useEffect(()=>{
  if(!menuOpen)return;
  // The aside precedes the header in the DOM: start inside it so Tab does not reach the content under the overlay.
  menuRef.current?.querySelector('button')?.focus();
  const close=(event:KeyboardEvent)=>{if(event.key==='Escape')closeMenu();};
  document.addEventListener('keydown',close);
  return()=>document.removeEventListener('keydown',close);
 },[menuOpen]);
 // Model-3 header: months of the current role (newest first), the roles held in model 3, and every unit of the view.
 const v3Groups=(groups??[group]).filter(g=>g.modelo===3);
 const months=v3Groups.filter(g=>g.role===group.role).sort((a,b)=>b.competenciaCodigo.localeCompare(a.competenciaCodigo));
 const roles=roleOrder.filter(role=>v3Groups.some(g=>g.role===role));
 const scopes=group.contexts.map(c=>c.escopoCodigo);
 const heading=academicPageHeading(context.role,page,{competence:group.competenciaCodigo,scopes});
 function selectRole(role:Role){
  const held=v3Groups.filter(g=>g.role===role);
  const target=held.find(g=>g.competenciaCodigo===group.competenciaCodigo)??pickDefaultGroup(held);
  if(target)onSelectGroup?.(target.key);
 }
 // Every page change, from the menu or from browser history, starts the page clean: the painel's
 // position and unit requests apply to the visit they were made for, and "vinculos" opens on the links (AD-02).
 function enterPage(next:string){
  detailGeneration.current++;setDetail(null);setPage(next);
  // Keep the key so the model-2 queue never sees an older one; an empty id requests nothing.
  setPositionRequest(previous=>previous&&{...previous,id:''});setUnitRequest(undefined);
  if(v3&&next==='vinculos')setAdminPage('links');
  contentRef.current?.focus();
 }
 useEffect(()=>{
  function syncPage(){
   const next=academicPageFromHash(context.role,window.location.hash);
   const changed=next!==pageRef.current;
   if(changed&&!requestAcademicLeave()){
    window.history.replaceState({},'',`#academico/${pageRef.current}`);return;
   }
   window.history.replaceState({},'',`#academico/${next}`);
   if(changed)enterPage(next);
  }
  window.history.replaceState({},'',`#academico/${pageRef.current}`);
  window.addEventListener('hashchange',syncPage);
  return()=>window.removeEventListener('hashchange',syncPage);
 },[context.role]);
 function navigate(destination:string):boolean{
  setMenuOpen(false);
  if(destination===page||!getAcademicDestinations(context.role).some(d=>d.id===destination)||!requestAcademicLeave())return false;
  window.history.pushState({},'',`#academico/${destination}`);
  enterPage(destination);
  return true;
 }
 // Opening a unit only navigates: the request is applied by the destination page, never as a command.
 function openUnit(unitId:string,focus?:UnitFocus){const target=unitDestinations[context.role];if(target&&navigate(target))setUnitRequest({unitId,...focus});}
 // Opens one position in the queue page of the role; model 2 shows the queue on every page.
 function openPosition(id:string){
  const target=context.role==='cam'?'entradas':'conferencia';
  // A cancelled leave prompt keeps the page and must not leave a request for the next visit.
  if(v3&&page!==target&&!navigate(target))return;
  setPositionRequest(previous=>({id,key:(previous?.key??0)+1}));
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
  <aside ref={menuRef} id="academic-menu" className="academic-side" aria-label="Menu" data-open={menuOpen} onBlur={event=>{if(menuOpen&&event.relatedTarget instanceof Node&&!event.currentTarget.contains(event.relatedTarget))setMenuOpen(false);}}><div className="academic-brand"><span className="academic-brand-mark" aria-hidden="true">G</span><span><b>Gratifiki</b><span>Avaliação por desempenho</span></span></div>
   <div className="nav-group">{v3&&<span className="nav-label" aria-hidden="true">Geral</span>}<AcademicNavigation role={context.role} page={page} onNavigate={navigate} counts={navCounts}/></div>
   {v3&&<div className="academic-side-foot"><span className="nav-label">Regra em uso</span><p>Regra fictícia DEMO-v1 com 4 indicadores. Sem efeito institucional.</p></div>}</aside>
  <div className="academic-scrim" hidden={!menuOpen} onClick={closeMenu}/>
  <div className="academic-body"><header className="academic-top">
  <p className="academic-demo-strip">{v3?'Regra fictícia DEMO-v1 · dados sintéticos · sem efeito institucional':'Dados sintéticos · baseline do modelo 2 · sem efeito institucional'}</p>
  <div className={v3?'academic-top-row topbar':'academic-top-row'}>
  <button ref={menuToggle} type="button" className="academic-menu-toggle" aria-controls="academic-menu" aria-expanded={menuOpen} onClick={()=>setMenuOpen(open=>!open)}>Menu</button>
  {v3?<>
   <h1 className="sr-only">Contexto acadêmico autorizado</h1>
   <label className="ctl ctl-month"><span className="academic-label">Competência</span><select value={group.key} onChange={event=>onSelectGroup?.(event.target.value)}>{months.map(g=><option key={g.key} value={g.key}>{competenceLabel(g.competenciaCodigo)}</option>)}</select></label>
   {context.competenciaEstado&&<p className={`academic-competence-state v3-badge v3-st-${context.competenciaEstado}`}><span className="sr-only">Situação da competência: </span>{competenceStateLabels[context.competenciaEstado]}</p>}
   <span className="academic-spacer" aria-hidden="true"/>
   {roles.length>1&&<label className="ctl ctl-role"><span className="academic-label">Papel</span><select value={group.role} onChange={event=>selectRole(event.target.value as Role)}>{roles.map(role=><option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>}
   <div className="academic-person user"><span className="academic-avatar" aria-hidden="true">{roleLabels[context.role][0]}</span><span><strong>{roleLabels[context.role]}</strong><span>{scopeSummary(scopes)}</span></span></div>
   {groups?.some(g=>g.modelo!==3||g.role!==group.role)&&<button type="button" className="academic-others" aria-expanded={othersOpen} aria-controls="academic-other-contexts" onClick={()=>setOthersOpen(open=>!open)}>Outros contextos</button>}
  </>:<>
   <h1>Contexto acadêmico autorizado</h1>
   <p className="academic-profile">Perfil {context.role} · {context.escopoCodigo} · {context.competenciaCodigo}</p>
   {context.competenciaEstado&&<p className="academic-competence-state"><span aria-hidden="true">· </span><span className="sr-only">Situação da competência: </span>{competenceStateLabels[context.competenciaEstado]}</p>}
   {contextPicker}
  </>}
  <button type="button" className="academic-signout" disabled={isSigningOut} onClick={()=>{if(requestAcademicLeave())onSignOut();}}>Sair</button></div>
  {v3&&othersOpen&&<div id="academic-other-contexts" className="academic-other-contexts">{contextPicker}</div>}
  </header><main id="academic-content" ref={contentRef} tabIndex={-1} className="academic-content">
  {v3&&<div className="academic-page-head"><h2>{heading.title}</h2><p>{heading.subtitle}</p></div>}
  {page==='historico'?<AuditPage client={client} context={context} group={group}/>
  :v3&&((page==='painel'&&manager)||(page==='resultados'&&(manager||context.role==='cam')))?<ResultsPage client={client} group={group}/>
  :v3&&page==='painel'&&['area_tecnica','revisor_tecnico','cam'].includes(context.role)?<AcademicV3Dashboard client={client} group={group} onNavigate={navigate} onOpenUnit={openUnit} onOpenPosition={openPosition} onOpenHistory={()=>navigate('historico')}/>
  :v3&&page==='regras'&&context.role==='administrador'?<RuleCatalogPage client={client} group={group}/>
  :v3&&page==='painel'&&context.role==='administrador'?<AdminSummary client={client} group={group} onNavigate={navigate}/>
  :page==='painel'&&['area_tecnica','revisor_tecnico','cam'].includes(context.role)?<AcademicDashboard client={client} context={context}/>:<>
  {manager&&!v3&&<EvaluationPage client={client} context={context}/>}
  {context.role==='lideranca'&&<LeadershipPage client={client} context={context}/>}
  {context.role==='administrador'&&<><p>Administração de metadados sintéticos, sem acesso a valores de avaliação.</p><nav aria-label="Administração">{(v3?[{id:'links',label:'Vínculos de negócio'},{id:'scopes',label:'Escopos'}] as const:[{id:'scopes',label:'Escopos'},{id:'links',label:'Vínculos de negócio'},{id:'competences',label:'Competências e atribuições'},{id:'rules',label:'Regras futuras'}] as const).map(destination=><button key={destination.id} type="button" aria-pressed={adminPage===destination.id} onClick={()=>{if(adminPage!==destination.id&&requestAcademicLeave()){setAdminPage(destination.id);contentRef.current?.focus();}}}>{destination.label}</button>)}</nav>{v3&&<p className="v3-note">A configuração do modelo 3 é feita por migração/seed.</p>}{adminPage==='scopes'?<ScopeAdminPage client={client} context={context}/>:adminPage==='links'?<AccessAdminPage client={client} context={context} actorId={context.actorId}/>:adminPage==='competences'?<CompetenceAdminPage client={client} context={context} actorId={context.actorId}/>:<RuleAdminPage client={client} context={context}/>}</>}
  {v3&&context.role==='area_tecnica'&&page==='preenchimento'?<BatchEntryPage client={client} group={group} initialUnitId={unitRequest?.unitId} initialFocus={unitRequest}/>
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
  {(context.role==='revisor_tecnico'||context.role==='cam')&&(!v3||context.role==='revisor_tecnico'||page==='entradas')&&<ReviewQueue client={client} context={context} group={v3?group:undefined} readOnly={v3&&context.role==='cam'} requestedPositionId={positionRequest?.id} positionRequestKey={positionRequest?.key} initialUnitId={unitRequest?.unitId} onPositionsLoaded={context.role==='cam'?setCamPositions:undefined} />}
  {context.role==='cam'&&(!v3||page==='ciclo')&&<CyclePage key={context.key} client={client} context={context} group={v3?group:undefined} contexts={v3?contexts:undefined} authorizedPositions={camPositions} onOpenPosition={openPosition} renderExport={checklist=><ExportPanel client={client} context={context} checklist={checklist}/>} />}
  </>}
  {error&&<p role="alert">{error}</p>}{signOutError&&<p role="alert">{signOutError}</p>}
 </main></div></div>;
}
