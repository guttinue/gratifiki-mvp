import { groupContexts } from '../context/contextGroups';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AcademicWorkspace } from '../workspace/AcademicWorkspace';
import { CyclePage } from './CyclePage';
import { NavigationSafety } from '../workspace/NavigationSafety';
import { loadCycleChecklist } from './cycleApi';
import type { AuthorizedContext, CycleChecklist } from '../pilot/types';
const openAcademicPage=(page:string)=>window.history.replaceState({},'',`/#academico/${page}`);
const originalShowModal=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,'showModal');
const originalClose=Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,'close');
// jsdom lacks these native methods. This narrowly scoped shim only enables
// lifecycle/cancel/focus-restoration assertions, NOT inertness or Tab trapping.
// The real browser test proves native keyboard containment/background isolation.
beforeEach(()=>{
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.open=true;this.querySelector<HTMLButtonElement>('button')?.focus();}});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.open=false;}});
});
afterEach(()=>{
 cleanup();
 vi.restoreAllMocks();
 if(originalShowModal)Object.defineProperty(HTMLDialogElement.prototype,'showModal',originalShowModal);else Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');
 if(originalClose)Object.defineProperty(HTMLDialogElement.prototype,'close',originalClose);else Reflect.deleteProperty(HTMLDialogElement.prototype,'close');
});
const context:AuthorizedContext={key:'cam-cycle',actorId:'cam',role:'cam',vinculoId:'link',competenciaId:'month',indicadorId:'indicator',escopoId:'scope',escopoCodigo:'NORTE',competenciaCodigo:'2026-10',mode:'academic',modelo:2};
const checklist:CycleChecklist={version:20,state:'em_consolidacao',expected:6,received:6,reviewed:6,unavailable:1,decidedUnavailable:1,notApplicable:0,fullCoverage:true,canConsolidate:false,canClose:true,snapshotId:null,publication:'nao_publicada',publicationId:null,blockers:[]};
it.each(['cancel-repeat','A-B-A'])('executes each checklist intent for the same authorized target: %s',async scenario=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 const a={id:'a',escopoId:'scope',escopoCodigo:'NORTE-A',escopoTipo:'unidade',aplicavel:true,status:'ausente',estadoDado:null,version:1,revisionId:null,inputValue:null,resultValue:null};
 const b={...a,id:'b',escopoCodigo:'NORTE-B'};
 const reads:string[]=[];
 const api=client(async(url,options)=>{
  if(String(url).includes('get_cycle_checklist'))return response({...checklist,state:'aberta',expected:2,received:0,reviewed:0,unavailable:0,decidedUnavailable:0,canClose:false,blockers:[{positionId:'a',code:'missing_submission',message:'Envio ausente.'}]});
  if(String(url).includes('get_position_detail')){
   const id=JSON.parse(String(options?.body)).p_position_id;reads.push(id);
   return response({position:id==='a'?a:b,revisions:[],decisions:[],memories:[]});
  }
  return response({items:[a,b],total:2,page:1,pageSize:25});
 });
 openAcademicPage('ciclo');
 render(<AcademicWorkspace client={api} group={groupContexts([context])[0]} onSignOut={()=>{}}/>);
 const open=await screen.findByRole('button',{name:'Ver pendência de NORTE-A'});
 if(scenario==='cancel-repeat'){
  fireEvent.change(screen.getByLabelText('Motivo do ciclo'),{target:{value:'PRESERVE THIS'}});
  fireEvent.click(open);
  expect(confirm).toHaveBeenCalledTimes(1);expect(reads).toEqual([]);
  expect(screen.getByLabelText('Motivo do ciclo')).toHaveProperty('value','PRESERVE THIS');
  confirm.mockReturnValue(true);fireEvent.click(open);
  expect(await screen.findByRole('heading',{name:'NORTE-A'})).toBeTruthy();
  expect(reads).toEqual(['a']);
 }else{
  fireEvent.click(open);await screen.findByRole('heading',{name:'NORTE-A'});
  fireEvent.click(screen.getByRole('button',{name:'NORTE-B · ausente'}));
  await screen.findByRole('heading',{name:'NORTE-B'});
  fireEvent.click(open);await screen.findByRole('heading',{name:'NORTE-A'});
  expect(reads).toEqual(['a','b','a']);
 }
});
it('identifies an authorized blocker and opens its real detail without inventing hidden targets',async()=>{
 const position={id:'visible',escopoId:'scope',escopoCodigo:'NORTE-1',escopoTipo:'unidade',aplicavel:true,status:'ausente',estadoDado:null,version:1,revisionId:null,inputValue:null,resultValue:null};
 const calls:string[]=[];
 const api=client(async(url,options)=>{
  const name=String(url);calls.push(name);
  if(name.includes('get_cycle_checklist'))return response({...checklist,state:'aberta',canClose:false,blockers:[{positionId:'visible',code:'missing_submission',message:'Envio ausente.'},{positionId:null,code:'coverage',message:'Cobertura incompleta.'}]});
  if(name.includes('get_position_detail')){expect(JSON.parse(String(options?.body)).p_position_id).toBe('visible');return response({position,revisions:[],decisions:[],memories:[]});}
  return response({items:[position],total:1,page:1,pageSize:25});
 });
 openAcademicPage('ciclo');
 render(<AcademicWorkspace client={api} group={groupContexts([context])[0]} onSignOut={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Ver pendência de NORTE-1'}));
 expect(await screen.findByRole('heading',{name:'NORTE-1'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:/Cobertura incompleta/})).toBeNull();
 expect(calls.filter(name=>name.includes('get_position_detail'))).toHaveLength(1);
});
function response(data:unknown){return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});}
function client(fetch:typeof globalThis.fetch){return createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch}});}
it.each([
 ['close','DEMO-DECISAO-'],['close','DEMO-DECISAO-   '],['close','X-DEMO-DECISAO-A'],
 ['publish','DEMO-PUBLICACAO-'],['publish','DEMO-PUBLICACAO-   '],['publish','X-DEMO-PUBLICACAO-A'],
] as const)('still rejects %s with an empty suffix or wrong prefix: %s',async(action,reference)=>{
 const calls:string[]=[];
 const api=client(async url=>{
  if(String(url).includes('get_cycle_checklist'))return response(action==='close'?checklist:{...checklist,state:'fechada',canClose:false,snapshotId:'snapshot'});
  calls.push(String(url));return response(null);
 });
 render(<CyclePage client={api} context={context}/>);
 fireEvent.change(await screen.findByLabelText('Referência do ciclo'),{target:{value:reference}});
 fireEvent.click(screen.getByRole('button',{name:action==='close'?'Fechar ciclo':'Publicar demonstração'}));
 fireEvent.click(screen.getByRole('button',{name:action==='close'?'Confirmar fechamento':'Confirmar publicação'}));
 expect(screen.getByRole('alert').textContent).toContain('sufixo não vazio');
 expect(calls).toEqual([]);
});
it('uses persisted checklist metadata on reload and requires distinct confirmations for closing and publishing',async()=>{
 let current={...checklist};const calls:{url:string;body:Record<string,unknown>}[]=[];
 const api=client(async(url,options)=>{
  const path=String(url);
  if(path.includes('get_cycle_checklist'))return response(current);
  if(path.includes('get_operational_positions'))return response({items:[],total:0,page:1,pageSize:25});
  calls.push({url:path,body:JSON.parse(String(options?.body))});
  if(path.includes('transition_cycle')){current={...current,version:21,state:'fechada',canClose:false,snapshotId:'snapshot'} as typeof current;return response({resourceId:'snapshot',version:21,revisionId:null,status:'fechada',resultValue:null});}
  current={...current,version:22,publication:'publicada_demo',publicationId:'publication'} as typeof current;return response({resourceId:'snapshot',version:22,revisionId:null,status:'publicada_demo',resultValue:null});
 });
 openAcademicPage('ciclo');
 const view=render(<AcademicWorkspace client={api} group={groupContexts([context])[0]} onSignOut={()=>{}} />);
 await screen.findByText('Esperadas: 6 · Recebidas: 6 · Conferidas: 6');
 fireEvent.change(screen.getByLabelText('Referência do ciclo'),{target:{value:'DEMO-DECISAO- A'}});
 fireEvent.click(screen.getByRole('button',{name:'Fechar ciclo'}));expect(calls).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Confirmar fechamento'}));
 await screen.findByText('Snapshot fechado: snapshot');
 expect(document.activeElement).toBe(screen.getByRole('heading',{name:'Ciclo da demonstração acadêmica'}));
 expect(calls[0].body).toMatchObject({p_expected_version:20,p_action:'close',p_reference:'DEMO-DECISAO- A'});
 view.unmount();
 openAcademicPage('ciclo');
 render(<AcademicWorkspace client={api} group={groupContexts([context])[0]} onSignOut={()=>{}} />);
 await screen.findByText('Snapshot fechado: snapshot');
 expect(screen.queryByRole('button',{name:'Fechar ciclo'})).toBeNull();
 fireEvent.change(screen.getByLabelText('Referência do ciclo'),{target:{value:'DEMO-PUBLICACAO- A'}});
 fireEvent.click(screen.getByRole('button',{name:'Publicar demonstração'}));expect(calls).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'Confirmar publicação'}));await screen.findByText('Publicação: publicada_demo');expect(calls[1].body.p_snapshot_id).toBe('snapshot');
 expect(document.activeElement).toBe(screen.getByRole('heading',{name:'Ciclo da demonstração acadêmica'}));
 expect(calls[1].body.p_reference).toBe('DEMO-PUBLICACAO- A');
});
it('decodes six expected positions with a missing sixth, fails closed on malformed counters and never invents readiness',async()=>{
 const data={...checklist,state:'aberta',expected:6,received:5,reviewed:0,unavailable:0,decidedUnavailable:0,canClose:false,blockers:[{positionId:'six',code:'missing_submission',message:'Envio ausente.'}]};
 const api=client(async()=>response(data));
 const loaded=await loadCycleChecklist(api,context);expect(loaded.expected).toBe(6);expect(loaded.canClose).toBe(false);
 await expect(loadCycleChecklist(client(async()=>response({...data,received:7})),context)).rejects.toThrow();
});
it.each(['close','publish'] as const)('returns %s confirmation focus on native cancel and explicit Cancel without issuing a command',async action=>{
 const current=action==='close'?checklist:{...checklist,state:'fechada',canClose:false,snapshotId:'snapshot'};
 const calls:string[]=[];
 const api=client(async url=>{
  if(String(url).includes('get_cycle_checklist'))return response(current);
  if(String(url).includes('get_operational_positions'))return response({items:[],total:0,page:1,pageSize:25});
  calls.push(String(url));return response(null);
 });
 openAcademicPage('ciclo');
 render(<AcademicWorkspace client={api} group={groupContexts([context])[0]} onSignOut={()=>{}} />);
 const trigger=await screen.findByRole('button',{name:action==='close'?'Fechar ciclo':'Publicar demonstração'});
 trigger.focus();fireEvent.click(trigger);
 const dialog=screen.getByRole('dialog');const confirm=screen.getByRole('button',{name:action==='close'?'Confirmar fechamento':'Confirmar publicação'});const cancel=screen.getByRole('button',{name:'Cancelar'});
 fireEvent.keyDown(dialog,{key:'Tab',shiftKey:true});expect(document.activeElement).toBe(cancel);
 fireEvent.keyDown(dialog,{key:'Tab'});expect(document.activeElement).toBe(confirm);
 fireEvent(dialog,new Event('cancel',{cancelable:true}));
 expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(trigger);
 fireEvent.click(trigger);fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));
 expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(trigger);expect(calls).toEqual([]);
});

// ---- Task 11: model-3 cycle — "N de 16 prontas", pending CAM decisions and blockers with a link ----
const camV3=(n:number):AuthorizedContext=>({...context,key:`cam-${n}`,vinculoId:`link-${n}`,indicadorId:`indicator-${n}`,modelo:3,competenciaCodigo:'ACADEMIC-V3-2026-10'});
const v3Group=()=>groupContexts([1,2].map(camV3))[0];
const unit=(id:string,code:string,state:'indisponivel'|'nao_aplicavel'|'valor',extra:object={})=>({id,escopoId:`unit-${id}`,escopoCodigo:code,escopoTipo:'unidade',aplicavel:true,status:'validada',estadoDado:state,version:7,revisionId:`rev-${id}`,inputValue:null,resultValue:null,...extra});
const v3Rows:Record<string,ReturnType<typeof unit>[]>={'indicator-1':[unit('na','ACADEMIC-NORTE-3','nao_aplicavel'),unit('late','ACADEMIC-NORTE-1','valor',{status:'enviada'})],'indicator-2':[unit('un','ACADEMIC-NORTE-2','indisponivel')]};
const v3Checklist=(blockers:object[],extra:object={})=>({...checklist,state:'aberta',expected:16,received:12,reviewed:9,unavailable:1,decidedUnavailable:0,notApplicable:0,canClose:false,canConsolidate:false,ready:9,blockers,...extra});
const pendingBlocker=(id:string)=>({positionId:id,code:'unavailability_pending',message:'Indisponibilidade sem decisão CAM ou com número indevido.'});
type CycleBody={p_contexto:{vinculoId:string;indicadorId:string};p_position_id:string};
function v3Cycle(blockers:object[],onCommand?:(body:Record<string,unknown>)=>Response|undefined){
 const calls:{name:string;body:CycleBody}[]=[];const decidedIds=new Set<string>();
 const api=client(async(url,options)=>{
  const name=String(url).split('/rpc/')[1];const body=JSON.parse(String(options?.body??'{}'));calls.push({name,body});
  // A re-read is not instantaneous in a browser; the delay lets the loading state render in the test too.
  if(name==='get_cycle_checklist'&&calls.filter(c=>c.name==='get_cycle_checklist').length>1)await new Promise(resolve=>setTimeout(resolve,40));
  if(name==='get_cycle_checklist')return response(v3Checklist(blockers.filter(b=>!decidedIds.has((b as {positionId:string}).positionId))));
  if(name==='get_operational_positions')return response({items:v3Rows[body.p_contexto.indicadorId],total:v3Rows[body.p_contexto.indicadorId].length,page:1,pageSize:100});
  if(name==='decide_unavailability'){const custom=onCommand?.(body);if(custom)return custom;decidedIds.add(body.p_position_id);return response({resourceId:body.p_position_id,version:8,revisionId:`rev-${body.p_position_id}`,status:'validada',resultValue:null});}
  return response(null);
 });
 return {api,calls};
}
it('V3 cycle: shows "N de 16 prontas" and lists a pending CAM decision for an accepted "não se aplica"',async()=>{
 const {api}=v3Cycle([pendingBlocker('na')]);
 render(<CyclePage client={api} context={camV3(1)} group={v3Group()} />);
 expect(await screen.findByText('9 de 16 prontas')).toBeTruthy();
 const list=screen.getByRole('list',{name:'Decisões pendentes da CAM'});
 expect(within(list).getAllByRole('listitem')).toHaveLength(1);
 expect(within(list).getByText('ACADEMIC-NORTE-3 · Não se aplica')).toBeTruthy();
 expect(screen.getByRole('heading',{name:'Decisões pendentes da CAM'})).toBeTruthy();
});
it('V3 cycle: lists unavailable and not-applicable decisions apart from the other blockers, each with a link to the entry',async()=>{
 const opened:string[]=[];
 const {api}=v3Cycle([pendingBlocker('na'),pendingBlocker('un'),{positionId:'late',code:'review_pending',message:'Conferência técnica pendente.'},{positionId:null,code:'coverage_incomplete',message:'Cobertura incompleta.'}]);
 render(<CyclePage client={api} context={camV3(1)} group={v3Group()} onOpenPosition={id=>opened.push(id)} />);
 const decisions=await screen.findByRole('list',{name:'Decisões pendentes da CAM'});
 expect(within(decisions).getAllByRole('listitem')).toHaveLength(2);
 expect(within(decisions).getByText('ACADEMIC-NORTE-2 · Indisponível')).toBeTruthy();
 const blockers=screen.getByRole('list',{name:'Bloqueios'});
 expect(within(blockers).getAllByRole('listitem')).toHaveLength(2);
 expect(within(blockers).queryByText(/Indisponibilidade sem decisão/)).toBeNull();
 fireEvent.click(within(decisions).getByRole('button',{name:'Ver entrada de ACADEMIC-NORTE-3'}));
 fireEvent.click(within(blockers).getByRole('button',{name:'Ver pendência de ACADEMIC-NORTE-1'}));
 expect(opened).toEqual(['na','late']);
});
it('V3 cycle: decides with reference and reason through decide_unavailability and reads the cycle again',async()=>{
 const {api,calls}=v3Cycle([pendingBlocker('na')]);
 render(<CyclePage client={api} context={camV3(1)} group={v3Group()} />);
 const item=(await screen.findByRole('list',{name:'Decisões pendentes da CAM'})).querySelector('li')!;
 expect((within(item).getByRole('button',{name:'Decidir ACADEMIC-NORTE-3'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(within(item).getByLabelText('Referência da decisão'),{target:{value:'  OF-123/2026  '}});
 fireEvent.change(within(item).getByLabelText('Motivo da decisão'),{target:{value:'  Unidade sem este serviço.  '}});
 fireEvent.click(within(item).getByRole('button',{name:'Decidir ACADEMIC-NORTE-3'}));
 expect(await screen.findByText('Decisão registrada para ACADEMIC-NORTE-3.')).toBeTruthy();
 const decision=calls.find(c=>c.name==='decide_unavailability')!;
 expect(decision.body).toMatchObject({p_position_id:'na',p_expected_version:7,p_reference:'OF-123/2026',p_reason:'Unidade sem este serviço.',p_contexto:{vinculoId:'link-1',indicadorId:'indicator-1'}});
 await waitFor(()=>expect(screen.queryByRole('list',{name:'Decisões pendentes da CAM'})).toBeNull());
 expect(calls.filter(c=>c.name==='get_cycle_checklist').length).toBe(2);
});
it('V3 cycle: uses the context of the indicator that holds the position and keeps typed text after a refusal',async()=>{
 const {api,calls}=v3Cycle([pendingBlocker('un')],()=>new Response(JSON.stringify({code:'55000',message:'invalid_state',details:null,hint:null}),{status:400,headers:{'content-type':'application/json'}}));
 render(<CyclePage client={api} context={camV3(1)} group={v3Group()} />);
 const item=(await screen.findByRole('list',{name:'Decisões pendentes da CAM'})).querySelector('li')!;
 fireEvent.change(within(item).getByLabelText('Referência da decisão'),{target:{value:'OF-9'}});
 fireEvent.change(within(item).getByLabelText('Motivo da decisão'),{target:{value:'Sem dado na fonte.'}});
 fireEvent.click(within(item).getByRole('button',{name:'Decidir ACADEMIC-NORTE-2'}));
 expect((await within(item).findByRole('alert')).textContent).toContain('não permite a operação');
 expect(calls.find(c=>c.name==='decide_unavailability')!.body.p_contexto.indicadorId).toBe('indicator-2');
 expect((within(item).getByLabelText('Referência da decisão') as HTMLInputElement).value).toBe('OF-9');
});
it('V3 cycle: keeps the model-2 checklist text and shows no V3 sections without a model-3 group',async()=>{
 const api=client(async url=>String(url).includes('get_cycle_checklist')?response({...checklist,state:'aberta',canClose:false}):response({items:[],total:0,page:1,pageSize:25}));
 render(<CyclePage client={api} context={context} />);
 expect(await screen.findByText(/Esperadas: 6/)).toBeTruthy();
 expect(screen.queryByText(/prontas/)).toBeNull();expect(screen.queryByRole('heading',{name:'Decisões pendentes da CAM'})).toBeNull();
});

it('V3 cycle: deciding one item keeps what was typed for the other pending items',async()=>{
 const {api}=v3Cycle([pendingBlocker('na'),pendingBlocker('un')]);
 render(<CyclePage client={api} context={camV3(1)} group={v3Group()} />);
 const list=await screen.findByRole('list',{name:'Decisões pendentes da CAM'});
 const [first,second]=Array.from(list.querySelectorAll('li'));
 fireEvent.change(within(first).getByLabelText('Referência da decisão'),{target:{value:'OF-1'}});fireEvent.change(within(first).getByLabelText('Motivo da decisão'),{target:{value:'Motivo do primeiro.'}});
 fireEvent.change(within(second).getByLabelText('Referência da decisão'),{target:{value:'OF-2'}});fireEvent.change(within(second).getByLabelText('Motivo da decisão'),{target:{value:'Motivo do segundo.'}});
 fireEvent.click(within(first).getByRole('button',{name:/^Decidir/}));
 expect(await screen.findByText(/Decisão registrada para/)).toBeTruthy();
 await waitFor(()=>expect(within(screen.getByRole('list',{name:'Decisões pendentes da CAM'})).getAllByRole('listitem')).toHaveLength(1));
 const remaining=screen.getByRole('list',{name:'Decisões pendentes da CAM'});
 expect((within(remaining).getByLabelText('Referência da decisão') as HTMLInputElement).value).toBe('OF-2');
 expect((within(remaining).getByLabelText('Motivo da decisão') as HTMLTextAreaElement).value).toBe('Motivo do segundo.');
});
it('V3 cycle: "Atualizar ciclo" asks before discarding typed decisions and keeps them when cancelled',async()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 const {api,calls}=v3Cycle([pendingBlocker('na')]);
 render(<NavigationSafety><CyclePage client={api} context={camV3(1)} group={v3Group()} /></NavigationSafety>);
 const item=(await screen.findByRole('list',{name:'Decisões pendentes da CAM'})).querySelector('li')!;
 fireEvent.click(screen.getByRole('button',{name:'Atualizar ciclo'}));
 expect(confirm).not.toHaveBeenCalled();
 await waitFor(()=>expect(calls.filter(c=>c.name==='get_cycle_checklist').length).toBe(2));
 const again=(await screen.findByRole('list',{name:'Decisões pendentes da CAM'})).querySelector('li')!;
 fireEvent.change(within(again).getByLabelText('Motivo da decisão'),{target:{value:'Não perder.'}});
 expect(item).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Atualizar ciclo'}));
 expect(confirm).toHaveBeenCalledTimes(1);
 expect(calls.filter(c=>c.name==='get_cycle_checklist').length).toBe(2);
 expect((screen.getByLabelText('Motivo da decisão') as HTMLTextAreaElement).value).toBe('Não perder.');
 confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Atualizar ciclo'}));
 await waitFor(()=>expect(calls.filter(c=>c.name==='get_cycle_checklist').length).toBe(3));
 expect((await screen.findByLabelText('Motivo da decisão') as HTMLTextAreaElement).value).toBe('Não perder.');
});
