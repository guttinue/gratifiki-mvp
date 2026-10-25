import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it } from 'vitest';
import { AcademicWorkspace } from '../workspace/AcademicWorkspace';
import { startReview, reviewPosition } from './reviewApi';
import type { AuthorizedContext } from '../pilot/types';
afterEach(cleanup);
const context:AuthorizedContext={key:'review',actorId:'reviewer',role:'revisor_tecnico',vinculoId:'link',competenciaId:'month',indicadorId:'indicator',escopoId:'scope',escopoCodigo:'NORTE',competenciaCodigo:'2026-10',mode:'academic'};
const position={id:'pos',escopoId:'scope',escopoCodigo:'NORTE-1',escopoTipo:'unidade',aplicavel:true,status:'enviada',estadoDado:'valor',version:3,revisionId:'revision',inputValue:'10',resultValue:'8'};
const detail={position,revisions:[{id:'revision',number:1,authorId:'author',estadoDado:'valor',value:'10',source:'Synthetic origin',sourcePeriod:'2026-10-01',reason:'',submittedAt:'2026-10-20T12:00:00Z'}],decisions:[],memories:[{revisionId:'revision',ruleVersion:1,factor:'0.8',inputValue:'10',resultValue:'8'}]};
function response(data:unknown){return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});}
function client(fetch:typeof globalThis.fetch){return createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch}});}
it('integrates the queue into the authenticated host; requires claim then a motivated return',async()=>{
 const calls:Record<string,unknown>[]=[];
 const api=client(async(url,options)=>{
  if(String(url).includes('get_operational_positions'))return response({items:[position],total:1,page:1,pageSize:25});
  if(String(url).includes('get_position_detail'))return response(detail);
  const args=JSON.parse(String(options?.body));calls.push(args);
  return response({resourceId:'pos',version:calls.length+3,revisionId:'revision',status:calls.length===1?'em_revisao':'devolvida',resultValue:'8'});
 });
 render(<AcademicWorkspace client={api} context={context} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:/NORTE-1 · enviada/}));
 expect(await screen.findByText('Synthetic origin')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Aceitar evidência'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Iniciar revisão'}));
 const accept=await screen.findByRole('button',{name:'Aceitar evidência'});expect((accept as HTMLButtonElement).disabled).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Devolver com motivo'}));
 expect(await screen.findByRole('alert')).toBeTruthy();expect(calls).toHaveLength(1);
 fireEvent.change(screen.getByLabelText('Motivo da conferência'),{target:{value:'  Corrigir a fonte sintética  '}});
 fireEvent.click(screen.getByRole('button',{name:'Devolver com motivo'}));
 expect(await screen.findByText('Conferência confirmada: devolvida.')).toBeTruthy();
 expect(calls[1]).toMatchObject({p_decision:'return',p_reason:'Corrigir a fonte sintética',p_expected_version:4});
});
it('retains the exact pending review operation after an ambiguous response and retries it',async()=>{
 const bodies:unknown[]=[];let lost=true;
 const api=client(async(url,options)=>{
  if(String(url).includes('get_operational_positions'))return response({items:[position],total:1,page:1,pageSize:25});
  if(String(url).includes('get_position_detail'))return response(detail);
  bodies.push(JSON.parse(String(options?.body)));
  if(lost){lost=false;return response(null);}
  return response({resourceId:'pos',version:4,revisionId:'revision',status:'em_revisao',resultValue:'8'});
 });
 render(<AcademicWorkspace client={api} context={context} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:/NORTE-1/}));fireEvent.click(await screen.findByRole('button',{name:'Iniciar revisão'}));
 fireEvent.click(await screen.findByRole('button',{name:'Repetir operação pendente'}));
 expect(await screen.findByRole('button',{name:'Aceitar evidência'})).toBeTruthy();expect(bodies).toHaveLength(2);expect(bodies[1]).toEqual(bodies[0]);
});
it('discards late review completions when another authorized context is selected',async()=>{
 let finish!:(value:Response)=>void;const pending=new Promise<Response>(resolve=>{finish=resolve;});
 const api=client(async url=>String(url).includes('get_operational_positions')?response({items:[position],total:1,page:1,pageSize:25}):String(url).includes('get_position_detail')?response(detail):pending);
 const view=render(<AcademicWorkspace client={api} context={context} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:/NORTE-1/}));fireEvent.click(await screen.findByRole('button',{name:'Iniciar revisão'}));
 view.rerender(<AcademicWorkspace client={api} context={{...context,key:'other',role:'gestor_unidade',escopoCodigo:'OUTRO'}} onSignOut={()=>{}} />);
 await act(async()=>{finish(response({resourceId:'pos',version:4,revisionId:'revision',status:'em_revisao',resultValue:'8'}));});
 expect(screen.getByText(/OUTRO/)).toBeTruthy();expect(screen.queryByText(/Conferência confirmada/)).toBeNull();expect(screen.queryByRole('button',{name:'Aceitar evidência'})).toBeNull();
});
it('checks command-specific receipts and does not trust role or actor fields from context',async()=>{
 const bodies:unknown[]=[];
 const api=client(async(_url,options)=>{bodies.push(JSON.parse(String(options?.body)));return response({resourceId:'pos',version:5,revisionId:'revision',status:'validada',resultValue:'8'});});
 const accepted=await reviewPosition(api,context,'pos',4,'accept','  ok  ','op');expect(accepted.status).toBe('validada');
 expect(bodies[0]).toEqual({p_contexto:{vinculoId:'link',competenciaId:'month',indicadorId:'indicator'},p_position_id:'pos',p_expected_version:4,p_decision:'accept',p_reason:'ok',p_operation_id:'op'});
 await expect(startReview(api,context,'pos',3,'start')).rejects.toMatchObject({confirmedRejected:false});
 await expect(reviewPosition(api,context,'other',4,'accept','','wrong')).rejects.toMatchObject({confirmedRejected:false});
});
it('does not describe absent evidence as a pending CAM unavailability decision',async()=>{
 const api=client(async url=>String(url).includes('get_operational_positions')?response({items:[{...position,status:'ausente',estadoDado:null,revisionId:null,inputValue:null,resultValue:null}],total:1,page:1,pageSize:25}):response({position:{...position,status:'ausente',estadoDado:null,revisionId:null,inputValue:null,resultValue:null},revisions:[],decisions:[],memories:[]}));
 render(<AcademicWorkspace client={api} context={context} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:/NORTE-1 · ausente/}));
 await screen.findByRole('heading',{name:'NORTE-1'});
 expect(screen.queryByText(/decisão CAM pendente/)).toBeNull();
 expect(screen.queryByRole('button',{name:'Iniciar revisão'})).toBeNull();
});
