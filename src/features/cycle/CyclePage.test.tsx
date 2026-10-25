import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AcademicWorkspace } from '../workspace/AcademicWorkspace';
import { CyclePage } from './CyclePage';
import { loadCycleChecklist } from './cycleApi';
import type { AuthorizedContext, CycleChecklist } from '../pilot/types';
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
const context:AuthorizedContext={key:'cam-cycle',actorId:'cam',role:'cam',vinculoId:'link',competenciaId:'month',indicadorId:'indicator',escopoId:'scope',escopoCodigo:'NORTE',competenciaCodigo:'2026-10',mode:'academic'};
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
 render(<AcademicWorkspace client={api} context={context} onSignOut={()=>{}}/>);
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
 render(<AcademicWorkspace client={api} context={context} onSignOut={()=>{}}/>);
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
 const view=render(<AcademicWorkspace client={api} context={context} onSignOut={()=>{}} />);
 await screen.findByText('Esperadas: 6 · Recebidas: 6 · Conferidas: 6');
 fireEvent.change(screen.getByLabelText('Referência do ciclo'),{target:{value:'DEMO-DECISAO- A'}});
 fireEvent.click(screen.getByRole('button',{name:'Fechar ciclo'}));expect(calls).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Confirmar fechamento'}));
 await screen.findByText('Snapshot fechado: snapshot');
 expect(document.activeElement).toBe(screen.getByRole('heading',{name:'Ciclo da demonstração acadêmica'}));
 expect(calls[0].body).toMatchObject({p_expected_version:20,p_action:'close',p_reference:'DEMO-DECISAO- A'});
 view.unmount();
 render(<AcademicWorkspace client={api} context={context} onSignOut={()=>{}} />);
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
 render(<AcademicWorkspace client={api} context={context} onSignOut={()=>{}} />);
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
