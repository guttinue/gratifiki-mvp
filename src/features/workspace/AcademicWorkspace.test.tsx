import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { AcademicWorkspace } from './AcademicWorkspace';
import type { AuthorizedContext } from '../pilot/types';
import { groupContexts } from '../context/contextGroups';
import { completeUnit } from '../results/resultsFixtures';
const openAcademicPage=(page:string)=>window.history.replaceState({},'',`/#academico/${page}`);
afterEach(()=>{cleanup();vi.restoreAllMocks();window.history.replaceState({},'', '/');});
const context:AuthorizedContext={key:'context',actorId:'actor',role:'area_tecnica',vinculoId:'link',competenciaId:'month',indicadorId:'indicator',escopoId:'scope',escopoCodigo:'NORTE',competenciaCodigo:'2026-10',mode:'academic',modelo:2};
const grp=(item:AuthorizedContext)=>groupContexts([item])[0];
const position={id:'pos',escopoId:'scope',escopoCodigo:'NORTE-1',escopoTipo:'unidade',aplicavel:true,status:'ausente',estadoDado:null,version:1,revisionId:null,inputValue:null,resultValue:null};
it('follows authorized history hashes and canonicalizes forged admin navigation without an admin RPC',async()=>{
 const calls:string[]=[];
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>{
  calls.push(String(url));return new Response(JSON.stringify({items:[],total:0,page:1,pageSize:25}),{headers:{'content-type':'application/json'}});
 }}});
 window.history.replaceState({},'', '/#academico/historico');
 render(<AcademicWorkspace client={client} group={grp({...context,role:'gestor_unidade'})} onSignOut={()=>{}}/>);
 expect(await screen.findByRole('heading',{name:'Histórico autorizado'})).toBeTruthy();
 act(()=>{window.location.hash='#academico/cadastros';window.dispatchEvent(new HashChangeEvent('hashchange'));});
 await waitFor(()=>expect(window.location.hash).toBe('#academico/painel'));
 expect(await screen.findByRole('heading',{name:'Avaliações autorizadas'})).toBeTruthy();
 expect(screen.queryByRole('heading',{name:'Histórico autorizado'})).toBeNull();
 expect(calls.some(url=>url.includes('get_admin_catalog'))).toBe(false);
});
it('keeps an unsaved draft when navigation is cancelled and focuses the destination after leaving',async()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 openAcademicPage('preenchimento');
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>new Response(JSON.stringify(String(url).includes('get_position_detail')?{position,revisions:[],decisions:[],memories:[]}:{items:[position],total:1,page:1,pageSize:25}),{headers:{'content-type':'application/json'}})}});
 render(<AcademicWorkspace client={client} group={grp(context)} onSignOut={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:/NORTE-1/}));
 fireEvent.change(await screen.findByLabelText('Valor'),{target:{value:'12'}});
 fireEvent.click(screen.getByRole('button',{name:'Histórico'}));
 expect(confirm).toHaveBeenCalledTimes(1);
 expect(screen.getByLabelText('Valor')).toHaveProperty('value','12');
 confirm.mockReturnValue(true);
 fireEvent.click(screen.getByRole('button',{name:'Histórico'}));
 expect(await screen.findByRole('heading',{name:'Histórico autorizado'})).toBeTruthy();
 expect(document.activeElement).toBe(screen.getByRole('main'));
});
it('loads actual list/detail boundary and offers only a draft action',async()=>{
 openAcademicPage('preenchimento');
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>new Response(JSON.stringify(String(url).includes('get_position_detail')?{position,revisions:[],decisions:[],memories:[]}:{items:[position],total:1,page:1,pageSize:25}),{headers:{'content-type':'application/json'}})}});
 render(<AcademicWorkspace client={client} group={grp(context)} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:/NORTE-1/}));
 expect(await screen.findByRole('button',{name:'Salvar rascunho'})).toBeTruthy();
 expect((screen.getByRole('button',{name:'Enviar'}) as HTMLButtonElement).disabled).toBe(true);
});
it('keeps non-area roles on context confirmation without operational reads',()=>{
 const calls:string[]=[];
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>{calls.push(String(url));throw new Error('should not read');}}});
 render(<AcademicWorkspace client={client} group={grp({...context,role:'gestor_unidade'})} onSignOut={()=>{}} />);
 expect(screen.getByText(/Perfil gestor_unidade/)).toBeTruthy();
 expect(calls.some(url=>url.includes('get_dashboard'))).toBe(false);
 expect(screen.queryByRole('button',{name:'Salvar rascunho'})).toBeNull();
});
it('mounts real manager evaluations and sanitized history in authenticated workspace',async()=>{
 openAcademicPage('resultados');
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>new Response(JSON.stringify({items:[],total:0,page:1,pageSize:25,request:String(url)}),{headers:{'content-type':'application/json'}})}});
 render(<AcademicWorkspace client={client} group={grp({...context,role:'gestor_unidade'})} onSignOut={()=>{}}/>);
 expect(await screen.findByText('Nenhuma avaliação tecnicamente validada disponível neste filtro.')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Histórico'}));
 expect(await screen.findByText('Nenhum evento autorizado neste filtro.')).toBeTruthy();
});
it('integrates catalogue and business links without operational reads for admin',async()=>{
 const calls:string[]=[];
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>{
  calls.push(String(url));return new Response(JSON.stringify({scopes:[],accounts:[],links:[],indicators:[{id:'indicator',codigo:'DEMO-01'}]}),{headers:{'content-type':'application/json'}});
 }}});
 render(<AcademicWorkspace client={client} group={grp({...context,role:'administrador'})} onSignOut={()=>{}}/>);
 expect(await screen.findByRole('button',{name:'Salvar escopo'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Vínculos de negócio'}));
 expect(await screen.findByRole('button',{name:'Salvar vínculo'})).toBeTruthy();
 expect(calls.every(url=>url.endsWith('/rpc/get_admin_catalog'))).toBe(true);
 expect(screen.queryByRole('button',{name:'Fechar ciclo'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Regras futuras'}));
 expect(screen.getByRole('button',{name:'Agendar regra futura'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Competências e atribuições'})).toBeTruthy();
});
it('discards old detail after switching context instead of editing another target',async()=>{
 openAcademicPage('preenchimento');
 let resolveDetail!:(response:Response)=>void;
 const pendingDetail=new Promise<Response>(resolve=>{resolveDetail=resolve;});
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>String(url).includes('get_position_detail')?pendingDetail:new Response(JSON.stringify({items:[position],total:1,page:1,pageSize:25}),{headers:{'content-type':'application/json'}})}});
 const view=render(<AcademicWorkspace client={client} group={grp(context)} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:/NORTE-1/}));
 view.rerender(<AcademicWorkspace client={client} group={grp({...context,key:'other',role:'gestor_unidade',escopoCodigo:'OUTRO'})} onSignOut={()=>{}} />);
 await act(async()=>{resolveDetail(new Response(JSON.stringify({position,revisions:[],decisions:[],memories:[]}),{headers:{'content-type':'application/json'}}));});
 expect(screen.getByText(/Perfil gestor_unidade · OUTRO/)).toBeTruthy();
 expect(screen.queryByLabelText('Valor')).toBeNull();
});
it('opens the authenticated academic dashboard through navigation and applies its card filter',async()=>{
 openAcademicPage('preenchimento');
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url,init)=>{
  if(String(url).includes('get_dashboard'))return new Response(JSON.stringify({expected:2,received:1,reviewed:1,unavailable:0,cards:[{id:'validada',label:'validada',count:1,filter:{page:1,pageSize:25,status:'validada'}}]}),{headers:{'content-type':'application/json'}});
  const request=JSON.parse(String(init?.body));const filtered=request.p_filters.status==='validada';
  return new Response(JSON.stringify({items:filtered?[{...position,escopoCodigo:'FILTRO-ALFA',status:'validada'}]:[position],total:1,page:1,pageSize:25}),{headers:{'content-type':'application/json'}});
 }}});
 render(<AcademicWorkspace client={client} group={grp(context)} onSignOut={()=>{}}/>);
 expect(await screen.findByRole('button',{name:'NORTE-1 · ausente'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Painel'}));
 fireEvent.click(await screen.findByRole('button',{name:'validada: 1 de 2'}));
 expect(await screen.findByText('FILTRO-ALFA · validada')).toBeTruthy();expect(screen.getByText('Posições no filtro: 1')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'NORTE-1 · ausente'})).toBeNull();
});
it('shows the published aggregates as the leadership painel without the academic dashboard read',async()=>{
 const calls:string[]=[];
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>{
  calls.push(String(url));return new Response(JSON.stringify([]),{headers:{'content-type':'application/json'}});
 }}});
 render(<AcademicWorkspace client={client} group={grp({...context,role:'lideranca'})} onSignOut={()=>{}}/>);
 expect(await screen.findByRole('heading',{name:'Agregados de unidades publicadas'})).toBeTruthy();
 expect(window.location.hash).toBe('#academico/painel');
 expect(calls.some(url=>url.includes('get_dashboard'))).toBe(false);
});
it.each([
 ['gestor_unidade','Avaliações autorizadas'],['administrador','Administração de metadados sintéticos, sem acesso a valores de avaliação.'],
] as const)('keeps the model-2 landing page for %s on painel without a dashboard read or alert',async(role,landing)=>{
 const calls:string[]=[];
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>{
  calls.push(String(url));return new Response(JSON.stringify({items:[],total:0,page:1,pageSize:25,scopes:[],accounts:[],links:[],indicators:[{id:'indicator',codigo:'DEMO-01'}]}),{headers:{'content-type':'application/json'}});
 }}});
 render(<AcademicWorkspace client={client} group={grp({...context,role})} onSignOut={()=>{}}/>);
 expect(await screen.findByText(landing,{selector:role==='administrador'?'p':'h2'})).toBeTruthy();
 await waitFor(()=>expect(calls.length).toBeGreaterThan(0));
 expect(window.location.hash).toBe('#academico/painel');
 expect(calls.some(url=>url.includes('get_dashboard'))).toBe(false);
 expect(screen.queryByRole('alert')).toBeNull();
});
it('shows the V3 shell: the CAM destinations in a navigation, and the synthetic-rule strip in the banner',()=>{
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>new Response(JSON.stringify({}),{headers:{'content-type':'application/json'}})}});
 render(<AcademicWorkspace client={client} group={grp({...context,role:'cam'})} onSignOut={()=>{}} contextPicker={<label>Contexto autorizado<select/></label>}/>);
 const navigation=screen.getByRole('navigation',{name:'Navegação acadêmica'});
 expect(Array.from(navigation.querySelectorAll('button')).map(button=>button.textContent)).toEqual(['Painel','Ciclo e fechamento','Resultados','Todas as entradas','Auditoria']);
 const banner=screen.getByRole('banner');
 expect(banner.textContent).toContain('baseline do modelo 2');
 expect(banner.textContent).toContain('2026-10');
 expect(banner.textContent).toContain('NORTE');
 expect(within(banner).getByLabelText('Contexto autorizado')).toBeTruthy();
 expect(within(banner).getByRole('button',{name:'Sair'})).toBeTruthy();
 expect(screen.getByRole('main')).toBeTruthy();
});
it('discards the loaded detail when the same group comes back narrowed to other contexts',async()=>{
 openAcademicPage('preenchimento');
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>new Response(JSON.stringify(String(url).includes('get_position_detail')?{position,revisions:[],decisions:[],memories:[]}:{items:[position],total:1,page:1,pageSize:25}),{headers:{'content-type':'application/json'}})}});
 const second={...context,key:'context-2',vinculoId:'link-2',indicadorId:'indicator-2'};
 const view=render(<AcademicWorkspace client={client} group={grp(context)} onSignOut={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:/NORTE-1/}));
 expect(await screen.findByLabelText('Valor')).toBeTruthy();
 view.rerender(<AcademicWorkspace client={client} group={groupContexts([second])[0]} onSignOut={()=>{}}/>);
 expect(screen.queryByLabelText('Valor')).toBeNull();
});
it('shows the competence state next to its code in the model-2 header, with the picker visible',()=>{
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>{throw new Error('should not read');}}});
 const view=render(<AcademicWorkspace client={client} group={grp({...context,role:'gestor_unidade',competenciaEstado:'em_consolidacao'})} onSignOut={()=>{}} contextPicker={<label>Contexto autorizado<select/></label>}/>);
 expect(screen.getByText('Perfil gestor_unidade · NORTE · 2026-10')).toBeTruthy();
 expect(within(screen.getByRole('banner')).getByLabelText('Contexto autorizado')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Outros contextos'})).toBeNull();
 expect(screen.getByRole('banner').textContent).toContain('Dados sintéticos · baseline do modelo 2 · sem efeito institucional');
 expect(screen.getByText('Em consolidação').textContent).toBe('· Situação da competência: Em consolidação');
 view.unmount();
 render(<AcademicWorkspace client={client} group={grp({...context,role:'gestor_unidade',competenciaEstado:'aberta'})} onSignOut={()=>{}} />);
 expect(screen.getByText('Aberta')).toBeTruthy();
});
// T11: a model-3 technician fills the unit on the batch page (its situation buttons offer "Não se aplica");
// the single-position draft form stays the model-2 screen and never offers it.
it('offers "Não se aplica" through the batch page for a model-3 group and not in the model-2 draft form',async()=>{
 openAcademicPage('preenchimento');
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>new Response(JSON.stringify(String(url).includes('get_position_detail')?{position,revisions:[],decisions:[],memories:[]}:{items:[position],total:1,page:1,pageSize:25}),{headers:{'content-type':'application/json'}})}});
 const view=render(<AcademicWorkspace client={client} group={grp(context)} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:/NORTE-1/}));
 expect(within(await screen.findByLabelText('Estado do dado')).getAllByRole('option').map(o=>o.textContent)).toEqual(['Valor','Indisponível']);
 view.unmount();
 const batch=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>new Response(JSON.stringify(String(url).includes('get_unit_batch')?{unitId:'scope',unitCode:'NORTE-1',mode:'zero',items:[{positionId:'pos',indicatorCode:'DEMO-V1-01',name:'Registros conferidos',meta:'95',direction:'maior_melhor',weight:'30',decimals:2,max:'100',unit:'%',status:'ausente',version:1,estadoDado:null,valor:null,fonte:null,motivo:null,periodoFonte:null,returnReason:null,revisionNumber:null}]}:{items:[position],total:1,page:1,pageSize:25}),{headers:{'content-type':'application/json'}})}});
 render(<AcademicWorkspace client={batch} group={grp({...context,modelo:3})} onSignOut={()=>{}} />);
 expect(await screen.findByRole('heading',{name:'Preenchimento',level:2})).toBeTruthy();
 expect(await screen.findByRole('radio',{name:'Não se aplica'})).toBeTruthy();
 expect(screen.queryByRole('heading',{name:'Rascunhos do indicador'})).toBeNull();
 expect(screen.queryByLabelText('Estado do dado')).toBeNull();
});

// ---- Task 9: V3 screens for model-3 groups; model-2 groups keep their pages ----
const v3=(role:AuthorizedContext['role'],extra:Partial<AuthorizedContext>={}):AuthorizedContext=>({...context,role,modelo:3,escopoCodigo:'ACADEMIC-NORTE-1',competenciaCodigo:'ACADEMIC-V3-2026-10',...extra});
const rpc=(handler:(name:string)=>unknown)=>{
 const calls:string[]=[];
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>{
  const name=String(url).split('/rpc/')[1];calls.push(name);return new Response(JSON.stringify(handler(name)),{headers:{'content-type':'application/json'}});
 }}});
 return {client,calls};
};
const unitResults={competencia:'ACADEMIC-V3-2026-10',state:'aberta',publication:'nao_publicada',mode:'zero',units:[completeUnit]};
it.each(['painel','resultados'])('mounts the unit results for a model-3 manager on %s instead of the model-2 evaluations',async page=>{
 openAcademicPage(page);
 const {client,calls}=rpc(()=>unitResults);
 render(<AcademicWorkspace client={client} group={grp(v3('gestor_unidade'))} onSignOut={()=>{}}/>);
 expect(await screen.findByText('93,42')).toBeTruthy();
 expect(screen.getByText('+4,80 vs. setembro')).toBeTruthy();
 expect(calls).toEqual(['get_unit_results']);
 expect(screen.queryByRole('heading',{name:'Avaliações autorizadas'})).toBeNull();
});
it('mounts the unit results on resultados for the CAM of a model-3 group, and the cycle dashboard on painel',async()=>{
 openAcademicPage('resultados');
 const {client,calls}=rpc(name=>name==='get_unit_results'?unitResults:{});
 const view=render(<AcademicWorkspace client={client} group={grp(v3('cam'))} onSignOut={()=>{}}/>);
 expect(await screen.findByText('93,42')).toBeTruthy();
 expect(calls).toEqual(['get_unit_results']);
 view.unmount();cleanup();
 openAcademicPage('painel');
 const second=rpc(name=>name==='get_cycle_checklist'?{version:1,state:'aberta',expected:16,received:0,reviewed:0,unavailable:0,decidedUnavailable:0,notApplicable:0,fullCoverage:true,canConsolidate:false,canClose:false,snapshotId:null,publication:'nao_publicada',publicationId:null,ready:5,blockers:[]}:{});
 render(<AcademicWorkspace client={second.client} group={grp(v3('cam'))} onSignOut={()=>{}}/>);
 expect(await screen.findByText('5 de 16 prontas')).toBeTruthy();
 expect(second.calls).toEqual(['get_cycle_checklist']);
});
it('mounts the V3 dashboard for the technical area and navigates to the fill screen from it',async()=>{
 openAcademicPage('painel');
 const {client,calls}=rpc(name=>name==='get_operational_positions'?{items:[{...position,escopoCodigo:'ACADEMIC-NORTE-1'}],total:1,page:1,pageSize:100}:{});
 render(<AcademicWorkspace client={client} group={grp(v3('area_tecnica'))} onSignOut={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Abrir preenchimento'}));
 expect(window.location.hash).toBe('#academico/preenchimento');
 expect(await screen.findByRole('heading',{name:'Preenchimento',level:2})).toBeTruthy();
 expect(calls).not.toContain('get_dashboard');
});
it('opens the fill screen on the unit chosen in the painel',async()=>{
 openAcademicPage('painel');
 const units:Record<string,string>={alfa:'ACADEMIC-NORTE-1',beta:'ACADEMIC-NORTE-2'};
 const batches:string[]=[];
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url,init)=>{
  const name=String(url).split('/rpc/')[1];const body=JSON.parse(String(init?.body??'{}')) as {p_contexto:{vinculoId:string};p_unidade_id:string};
  const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  if(name==='get_operational_positions'){const id=body.p_contexto.vinculoId;return json({items:[{...position,id:`pos-${id}`,escopoId:id,escopoCodigo:units[id],status:'ausente',indicatorCode:'DEMO-V1-01',indicatorName:'Registros conferidos'}],total:1,page:1,pageSize:100});}
  if(name==='get_unit_batch'){batches.push(body.p_unidade_id);return json({unitId:body.p_unidade_id,unitCode:units[body.p_unidade_id],mode:'zero',items:[{positionId:`pos-${body.p_unidade_id}`,indicatorCode:'DEMO-V1-01',name:'Registros conferidos',meta:'95',direction:'maior_melhor',weight:'30',decimals:2,max:'100',unit:'%',status:'ausente',version:1,estadoDado:null,valor:null,fonte:null,motivo:null,periodoFonte:null,returnReason:null,revisionNumber:null}]});}
  return json({});
 }}});
 const group=groupContexts(Object.entries(units).map(([id,code])=>({...v3('area_tecnica'),key:id,vinculoId:id,escopoId:id,escopoCodigo:code})))[0];
 render(<AcademicWorkspace client={client} group={group} onSignOut={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Abrir Unidade Beta'}));
 expect(window.location.hash).toBe('#academico/preenchimento');
 expect(await screen.findByRole('heading',{name:'Unidade Beta',level:3})).toBeTruthy();
 expect(screen.getByRole('button',{name:/^Unidade Beta/}).getAttribute('aria-pressed')).toBe('true');
 expect(batches).toEqual(['beta']);
});
it('shows the aggregate overview to model-3 leadership and the published aggregates to model 2',async()=>{
 const {client,calls}=rpc(()=>({acceptedPercent:'100.00',mode:'zero',districts:[{districtCode:'ACADEMIC-NORTE',average:'93.42',completeUnits:1,totalUnits:1}],attention:[]}));
 render(<AcademicWorkspace client={client} group={grp(v3('lideranca'))} onSignOut={()=>{}}/>);
 expect(await screen.findByText('100,00%')).toBeTruthy();
 expect(calls).toEqual(['get_leadership_aggregates']);
 expect(screen.queryByRole('heading',{name:'Agregados de unidades publicadas'})).toBeNull();
});
it('opens the read-only rule catalogue for a model-3 administrator on regras, without the future-rule form',async()=>{
 openAcademicPage('regras');
 const catalog={ruleSets:[{id:'set',code:'DEMO',version:1,mode:'zero',synthetic:true,validFrom:'2026-09-01',reference:'DEMO-v1 · regra fictícia acadêmica',inUse:true,items:[{indicatorCode:'DEMO-V1-01',name:'Registros conferidos',meta:'95',direction:'maior_melhor',decimals:2,maximum:'100',unit:'%',weight:'100'}]}]};
 const {client,calls}=rpc(()=>catalog);
 render(<AcademicWorkspace client={client} group={grp(v3('administrador',{escopoCodigo:'ACADEMIC-NORTE'}))} onSignOut={()=>{}}/>);
 expect(await screen.findByText('Regra em uso · bloqueada')).toBeTruthy();
 expect(calls).toEqual(['get_rule_catalog']);
 expect(screen.queryByRole('button',{name:/Agendar|Regras futuras|Salvar|Criar|Editar/})).toBeNull();
});
it('keeps the administration landing for a model-3 administrator on painel but without the model-2 future-rule screen',async()=>{
 const {client}=rpc(()=>({scopes:[],accounts:[],links:[],indicators:[{id:'indicator',codigo:'DEMO-V1-01'}]}));
 render(<AcademicWorkspace client={client} group={grp(v3('administrador',{escopoCodigo:'ACADEMIC-NORTE'}))} onSignOut={()=>{}}/>);
 expect(await screen.findByRole('button',{name:'Salvar escopo'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Vínculos de negócio'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Regras futuras'})).toBeNull();
});
// I-5: the model-2 competence/assignment commands refuse model-3 contexts; the tab is replaced by a read-only notice.
it('hides "Competências e atribuições" from a model-3 administrator and says how model 3 is configured',async()=>{
 const {client}=rpc(()=>({scopes:[],accounts:[],links:[],indicators:[{id:'indicator',codigo:'DEMO-V1-01'}]}));
 render(<AcademicWorkspace client={client} group={grp(v3('administrador',{escopoCodigo:'ACADEMIC-NORTE'}))} onSignOut={()=>{}}/>);
 expect(await screen.findByRole('button',{name:'Salvar escopo'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Competências e atribuições'})).toBeNull();
 expect(screen.getByText('A configuração do modelo 3 é feita por migração/seed.')).toBeTruthy();
});
it('keeps a model-2 CAM and a model-2 administrator on their existing screens',async()=>{
 openAcademicPage('regras');
 const {client,calls}=rpc(()=>({scopes:[],accounts:[],links:[],indicators:[{id:'indicator',codigo:'DEMO-01'}]}));
 render(<AcademicWorkspace client={client} group={grp({...context,role:'administrador'})} onSignOut={()=>{}}/>);
 expect(await screen.findByRole('button',{name:'Salvar escopo'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Regras futuras'})).toBeTruthy();
 expect(calls.every(name=>name==='get_admin_catalog')).toBe(true);
});

// ---- Task 11: model-3 fill, queue and cycle screens routed by destination ----
const naPosition={...position,id:'na',escopoCodigo:'ACADEMIC-NORTE-3',status:'validada',estadoDado:'nao_aplicavel',revisionId:'rev-na'};
function camV3Client(){
 const calls:string[]=[];
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>{
  const name=String(url).split('/rpc/')[1];calls.push(name);
  const data=name==='get_cycle_checklist'?{version:1,state:'aberta',expected:16,received:1,reviewed:1,unavailable:0,decidedUnavailable:0,notApplicable:1,fullCoverage:true,canConsolidate:false,canClose:false,snapshotId:null,publication:'nao_publicada',publicationId:null,ready:0,
    blockers:[{positionId:'na',code:'unavailability_pending',message:'Indisponibilidade sem decisão CAM ou com número indevido.'}]}
   :name==='get_position_detail'?{position:naPosition,revisions:[{id:'rev-na',number:1,authorId:'author',estadoDado:'nao_aplicavel',value:null,source:'Relatório do distrito',sourcePeriod:'2026-10-01',reason:'Unidade sem este serviço.',submittedAt:'2026-10-20T12:00:00Z',correctionExplanation:null}],decisions:[],memories:[]}
   :{items:[naPosition],total:1,page:1,pageSize:100};
  return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
 }}});
 return {client,calls};
}
it('model-3 CAM: Ciclo shows the cycle and its decisions only; "Ver entrada" opens the position in the read-only Todas as entradas',async()=>{
 openAcademicPage('ciclo');
 const {client}=camV3Client();
 render(<AcademicWorkspace client={client} group={grp(v3('cam'))} onSignOut={()=>{}}/>);
 expect(await screen.findByRole('heading',{name:'Decisões pendentes da CAM'})).toBeTruthy();
 expect(screen.queryByRole('tablist',{name:'Filtrar entradas'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Ver entrada de ACADEMIC-NORTE-3'}));
 // The shell's page head names it too until the queue drops its own h2 (Tasks 4–8).
 expect((await screen.findAllByRole('heading',{name:'Todas as entradas',level:2})).length).toBeGreaterThan(0);
 expect(window.location.hash).toBe('#academico/entradas');
 expect(await screen.findByText('Unidade sem este serviço.')).toBeTruthy();
 expect(screen.getByRole('heading',{name:'ACADEMIC-NORTE-3',level:3})).toBeTruthy();
 expect(screen.queryByRole('heading',{name:'Decisões pendentes da CAM'})).toBeNull();
 expect(screen.queryByRole('button',{name:/Iniciar revisão|Aceitar evidência|Devolver com motivo/})).toBeNull();
});
it('model-3 technical area: the fill screen is the batch page, so no single-position correction form exists to send a correction without its explanation',async()=>{
 openAcademicPage('preenchimento');
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>new Response(JSON.stringify(String(url).includes('get_unit_batch')?{unitId:'scope',unitCode:'NORTE-1',mode:'zero',items:[{positionId:'pos',indicatorCode:'DEMO-V1-03',name:'Tempo de resposta',meta:'48',direction:'menor_melhor',weight:'25',decimals:2,max:'8760',unit:'h',status:'devolvida',version:5,estadoDado:'valor',valor:'96',fonte:'Sistema',motivo:'',periodoFonte:'2026-09-01',returnReason:'Confirme outubro.',revisionNumber:1}]}:{items:[{...position,status:'devolvida',revisionId:'rev'}],total:1,page:1,pageSize:100}),{headers:{'content-type':'application/json'}})}});
 render(<AcademicWorkspace client={client} group={grp(v3('area_tecnica'))} onSignOut={()=>{}}/>);
 expect(await screen.findByLabelText('O que você corrigiu?')).toBeTruthy();
 expect(screen.queryByRole('region',{name:'Correção versionada'})).toBeNull();
 expect(screen.queryByLabelText('Justificativa da correção')).toBeNull();
 expect((screen.getByRole('button',{name:'Enviar 0 itens'}) as HTMLButtonElement).disabled).toBe(true);
});
it('model-3 reviewer: the Conferência page mounts the tabbed queue; a model-2 reviewer keeps the paged queue',async()=>{
 openAcademicPage('conferencia');
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>new Response(JSON.stringify({items:[],total:0,page:1,pageSize:25}),{headers:{'content-type':'application/json'}})}});
 const view=render(<AcademicWorkspace client={client} group={grp(v3('revisor_tecnico'))} onSignOut={()=>{}}/>);
 expect(await screen.findByRole('tablist',{name:'Filtrar entradas'})).toBeTruthy();
 view.unmount();
 render(<AcademicWorkspace client={client} group={grp({...context,role:'revisor_tecnico'})} onSignOut={()=>{}}/>);
 expect(await screen.findByRole('navigation',{name:'Páginas da fila'})).toBeTruthy();
 expect(screen.queryByRole('tablist',{name:'Filtrar entradas'})).toBeNull();
});

// ---- Telas V3, Task 3: model-3 header, collapsible menu and page heading ----
const tech=(n:number,month:string,extra:Partial<AuthorizedContext>={})=>v3('area_tecnica',{key:`t-${month}-${n}`,vinculoId:`t-${month}-${n}`,
 competenciaId:month,competenciaCodigo:`ACADEMIC-V3-2026-${month}`,competenciaEstado:month==='10'?'aberta':'fechada',escopoId:`scope-${n}`,escopoCodigo:`ACADEMIC-NORTE-${n}`,...extra});
const headerGroups=(...more:AuthorizedContext[])=>groupContexts([tech(1,'10'),tech(2,'10'),tech(1,'09'),...more]);
const camMonth=(month:string)=>v3('cam',{key:`cam-${month}`,vinculoId:`cam-${month}`,competenciaId:month,competenciaCodigo:`ACADEMIC-V3-2026-${month}`,competenciaEstado:'aberta'});
const dashboardClient=()=>rpc(name=>name==='get_dashboard'?{expected:2,received:0,reviewed:0,unavailable:0,cards:[{id:'todas',label:'todas',count:2,filter:null},{id:'ausente',label:'ausente',count:2,filter:null}]}:{items:[],total:0,page:1,pageSize:25}).client;
it('shows competence, state, role and scope instead of codes, and no person',()=>{
 const groups=headerGroups();
 render(<AcademicWorkspace client={dashboardClient()} group={groups[0]} groups={groups} onSignOut={()=>{}}/>);
 expect(within(screen.getByLabelText('Competência')).getAllByRole('option').map(option=>option.textContent)).toEqual(['Outubro/2026','Setembro/2026']);
 expect(screen.getByText('Aberta').className).toBe('academic-competence-state v3-badge v3-st-aberta');
 expect(screen.getByText('Aberta').textContent).toBe('Situação da competência: Aberta');
 const person=document.querySelector('.academic-person') as HTMLElement;
 expect(person.textContent).toContain('Área técnica');
 expect(person.textContent).toContain('Unidade Alfa e Unidade Beta');
 expect(document.body.textContent).not.toMatch(/@|ACADEMIC-NORTE-1|Perfil area_tecnica/);
 expect(screen.getByRole('heading',{level:1,name:'Contexto acadêmico autorizado'}).className).toBe('sr-only');
 expect(screen.getByRole('banner').textContent).toContain('Regra fictícia DEMO-v1 · dados sintéticos · sem efeito institucional');
 expect(screen.getByText('Regra fictícia DEMO-v1 com 4 indicadores. Sem efeito institucional.')).toBeTruthy();
 expect(screen.queryByLabelText('Papel')).toBeNull();
});
it('changes month through onSelectGroup',()=>{
 const groups=headerGroups();const onSelectGroup=vi.fn();
 render(<AcademicWorkspace client={dashboardClient()} group={groups[0]} groups={groups} onSelectGroup={onSelectGroup} onSignOut={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Competência'),{target:{value:groups[1].key}});
 expect(onSelectGroup).toHaveBeenCalledWith(groups[1].key);
 // Controlled: until the parent switches the group, the select shows the current month.
 expect((screen.getByLabelText('Competência') as HTMLSelectElement).value).toBe(groups[0].key);
});
it('offers other contexts only when they exist and opens the picker',()=>{
 const picker=<label>Contexto autorizado<select/></label>;
 const only=headerGroups();
 const view=render(<AcademicWorkspace client={dashboardClient()} group={only[0]} groups={only} contextPicker={picker} onSignOut={()=>{}}/>);
 expect(screen.queryByRole('button',{name:'Outros contextos'})).toBeNull();
 expect(screen.queryByLabelText('Contexto autorizado')).toBeNull();
 view.unmount();
 const groups=headerGroups({...context,key:'m2',vinculoId:'m2',role:'cam'});
 render(<AcademicWorkspace client={dashboardClient()} group={groups.find(g=>g.modelo===3)!} groups={groups} contextPicker={picker} onSignOut={()=>{}}/>);
 const others=screen.getByRole('button',{name:'Outros contextos'});
 expect(others.getAttribute('aria-expanded')).toBe('false');
 expect(screen.queryByLabelText('Contexto autorizado')).toBeNull();
 fireEvent.click(others);
 expect(others.getAttribute('aria-expanded')).toBe('true');
 expect(document.getElementById(others.getAttribute('aria-controls')!)).toBeTruthy();
 expect(within(screen.getByRole('banner')).getByLabelText('Contexto autorizado')).toBeTruthy();
});
it('switches role keeping the month, or opens the default month of the new role',()=>{
 const groups=headerGroups(camMonth('10'),camMonth('09'));const onSelectGroup=vi.fn();
 const september=groups.find(g=>g.role==='area_tecnica'&&g.competenciaId==='09')!;
 const view=render(<AcademicWorkspace client={dashboardClient()} group={september} groups={groups} onSelectGroup={onSelectGroup} onSignOut={()=>{}}/>);
 expect(within(screen.getByLabelText('Papel')).getAllByRole('option').map(option=>option.textContent)).toEqual(['Área técnica','CAM']);
 fireEvent.change(screen.getByLabelText('Papel'),{target:{value:'cam'}});
 expect(onSelectGroup).toHaveBeenLastCalledWith('cam:09');
 view.unmount();
 const octoberOnly=headerGroups(camMonth('10'));
 render(<AcademicWorkspace client={dashboardClient()} group={octoberOnly.find(g=>g.role==='area_tecnica'&&g.competenciaId==='09')!} groups={octoberOnly} onSelectGroup={onSelectGroup} onSignOut={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('Papel'),{target:{value:'cam'}});
 expect(onSelectGroup).toHaveBeenLastCalledWith('cam:10');
});
it('renders the page heading',()=>{
 const groups=headerGroups();
 render(<AcademicWorkspace client={dashboardClient()} group={groups[0]} groups={groups} onSignOut={()=>{}}/>);
 const head=within(document.querySelector('.academic-page-head') as HTMLElement);
 expect(head.getByRole('heading',{level:2,name:'Painel'})).toBeTruthy();
 expect(head.getByText('Outubro/2026 · você informa os indicadores de Unidade Alfa e Unidade Beta.')).toBeTruthy();
});
it('moves focus into the opened menu and closes it when focus leaves for the content',()=>{
 const groups=headerGroups();
 render(<AcademicWorkspace client={dashboardClient()} group={groups[0]} groups={groups} onSignOut={()=>{}}/>);
 const toggle=screen.getByRole('button',{name:'Menu'});
 const menu=document.getElementById('academic-menu') as HTMLElement;
 fireEvent.click(toggle);
 expect(document.activeElement).toBe(within(menu).getAllByRole('button')[0]);
 fireEvent.focusOut(document.activeElement!,{relatedTarget:within(menu).getByRole('button',{name:'Histórico'})});
 expect(menu.dataset.open).toBe('true');
 // Safari and macOS Firefox do not focus a clicked button: the blur has no target and must not close the menu.
 fireEvent.focusOut(within(menu).getAllByRole('button')[0],{relatedTarget:null});
 expect(menu.dataset.open).toBe('true');
 fireEvent.focusOut(within(menu).getByRole('button',{name:'Histórico'}),{relatedTarget:screen.getByRole('main')});
 expect(menu.dataset.open).toBe('false');
 expect(toggle.getAttribute('aria-expanded')).toBe('false');
});
it('menu toggle opens, Escape closes and returns focus',()=>{
 const groups=headerGroups();
 render(<AcademicWorkspace client={dashboardClient()} group={groups[0]} groups={groups} onSignOut={()=>{}}/>);
 const toggle=screen.getByRole('button',{name:'Menu'});
 const menu=document.getElementById('academic-menu') as HTMLElement;
 expect(toggle.getAttribute('aria-controls')).toBe('academic-menu');
 expect(toggle.getAttribute('aria-expanded')).toBe('false');
 expect(menu.dataset.open).toBe('false');
 fireEvent.click(toggle);
 expect(toggle.getAttribute('aria-expanded')).toBe('true');
 expect(menu.dataset.open).toBe('true');
 const item=within(menu).getByRole('button',{name:'Histórico'});
 item.focus();
 fireEvent.keyDown(item,{key:'Escape'});
 expect(toggle.getAttribute('aria-expanded')).toBe('false');
 expect(menu.dataset.open).toBe('false');
 expect(document.activeElement).toBe(toggle);
 fireEvent.click(toggle);
 fireEvent.click(item);
 expect(menu.dataset.open).toBe('false');
 expect(document.activeElement).toBe(screen.getByRole('main'));
});
