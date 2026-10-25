import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it } from 'vitest';
import { AcademicWorkspace } from '../workspace/AcademicWorkspace';
import type { AuthorizedContext } from '../pilot/types';
import { authorizeCorrection, correctPosition, decideUnavailability } from './correctionApi';
afterEach(cleanup);
const context:AuthorizedContext={key:'technical',actorId:'actor',role:'area_tecnica',vinculoId:'link',competenciaId:'month',indicadorId:'indicator',escopoId:'scope',escopoCodigo:'SUL',competenciaCodigo:'2026-10',mode:'academic'};
const position={id:'pos',escopoId:'scope',escopoCodigo:'SUL',escopoTipo:'distrito',aplicavel:true,status:'devolvida',estadoDado:'valor',version:5,revisionId:'old',inputValue:'10',resultValue:'8'};
const detail={position,revisions:[{id:'old',number:1,authorId:'previous-author',estadoDado:'valor',value:'10',source:'Old source',sourcePeriod:'2026-10-01',reason:'',submittedAt:'2026-10-20T12:00:00Z'}],decisions:[{id:'return',revisionId:'old',actorId:'reviewer',type:'devolver',reason:'Correct source',reference:null,occurredAt:'2026-10-20T12:10:00Z'}],memories:[{revisionId:'old',ruleVersion:1,factor:'0.8',inputValue:'10',resultValue:'8'}]};
function response(data:unknown){return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});}
function api(fetch:typeof globalThis.fetch){return createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:(url,options)=>String(url).includes('get_cycle_checklist')?Promise.resolve(response({version:1,state:'aberta',expected:1,received:1,reviewed:1,unavailable:0,decidedUnavailable:0,notApplicable:0,fullCoverage:false,canConsolidate:false,canClose:false,snapshotId:null,publication:'nao_publicada',publicationId:null,blockers:[{positionId:null,code:'coverage_incomplete',message:'Cobertura parcial.'}]})):fetch(url,options)}});}
it('returned evidence creates a new sent revision using the receipt without replacing previous history',async()=>{
 const bodies:Record<string,unknown>[]=[];
 const client=api(async(url,options)=>{
  if(String(url).includes('get_operational_positions'))return response({items:[position],total:1,page:1,pageSize:25});
  if(String(url).includes('get_position_detail'))return response(detail);
  bodies.push(JSON.parse(String(options?.body)));return response({resourceId:'pos',version:6,revisionId:'new',status:'enviada',resultValue:'9.6'});
 });
 render(<AcademicWorkspace client={client} context={context} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:'SUL · devolvida'}));
 fireEvent.change(await screen.findByLabelText('Valor corrigido'),{target:{value:'12'}});
 fireEvent.click(screen.getByRole('button',{name:'Enviar nova revisão'}));
 expect(await screen.findByText(/Nova revisão enviada.*9.6/)).toBeTruthy();
 expect(screen.getByText(/Revisão anterior.*8/)).toBeTruthy();
 expect(bodies[0]).toMatchObject({p_contexto:{vinculoId:'link',competenciaId:'month',indicadorId:'indicator'},p_position_id:'pos',p_expected_version:5,p_input:{valor:'12',fonte:'Old source'}});
 expect((bodies[0].p_contexto as Record<string,unknown>).role).toBeUndefined();
});
it('CAM reading another target cannot authorize mutations until matching context is selected',async()=>{
 const client=api(async url=>String(url).includes('get_operational_positions')?response({items:[{...position,status:'validada'}],total:1,page:1,pageSize:25}):response({...detail,position:{...position,status:'validada'}}));
 render(<AcademicWorkspace client={client} context={{...context,key:'cam',role:'cam',escopoId:'different'}} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:'SUL · validada'}));
 expect(await screen.findByText(/Selecione o contexto CAM correspondente/)).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Autorizar retificação'})).toBeNull();
});
it('shows the current CAM rectification reason to the technical author before editing and after remount',async()=>{
 let serverDetail={
  ...detail,
  position:{...position,status:'validada'},
  revisions:[{...detail.revisions[0],reason:'Author justification is not the CAM reason'}],
  decisions:[{...detail.decisions[0],type:'validar',reason:'Independent evidence acceptance'}],
 };
 const client=api(async(url)=>{
  if(String(url).includes('get_operational_positions'))return response({items:[serverDetail.position],total:1,page:1,pageSize:25});
  if(String(url).includes('get_position_detail'))return response(serverDetail);
  serverDetail={
   ...serverDetail,
   position:{...serverDetail.position,status:'devolvida',version:6},
   decisions:[...serverDetail.decisions,{...detail.decisions[0],id:'cam-rectification',type:'autorizar_retificacao',reason:'CAM requests corrected synthetic reference'}],
  };
  return response({resourceId:'pos',version:6,revisionId:'old',status:'devolvida',resultValue:'8'});
 });
 const view=render(<AcademicWorkspace client={client} context={{...context,key:'cam',role:'cam'}} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:'SUL · validada'}));
 fireEvent.change(await screen.findByLabelText('Motivo CAM'),{target:{value:'CAM requests corrected synthetic reference'}});
 fireEvent.click(screen.getByRole('button',{name:'Autorizar retificação'}));
 await screen.findByText('Decisão CAM confirmada: devolvida.');
 view.rerender(<AcademicWorkspace client={client} context={context} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:'SUL · devolvida'}));
 expect(await screen.findByText('Motivo da retificação CAM: CAM requests corrected synthetic reference')).toBeTruthy();
 expect((screen.getByLabelText('Justificativa da correção') as HTMLTextAreaElement).value).toBe('Author justification is not the CAM reason');
 view.unmount();
 render(<AcademicWorkspace client={client} context={context} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:'SUL · devolvida'}));
 expect(await screen.findByText('Motivo da retificação CAM: CAM requests corrected synthetic reference')).toBeTruthy();
 expect((screen.getByLabelText('Valor corrigido') as HTMLInputElement).value).toBe('10');
});
it('distinguishes current technical return from CAM rectification of a prior revision',async()=>{
 const currentDetail={
  ...detail,
  position:{...position,revisionId:'current'},
  revisions:[...detail.revisions,{...detail.revisions[0],id:'current',number:2,reason:'Current author justification'}],
  decisions:[
   {...detail.decisions[0],id:'past-cam',type:'autorizar_retificacao',reason:'Old CAM reason must not guide the current revision'},
   {...detail.decisions[0],id:'current-return',revisionId:'current',reason:'Current technical return'},
  ],
 };
 const client=api(async url=>String(url).includes('get_operational_positions')?response({items:[currentDetail.position],total:1,page:1,pageSize:25}):response(currentDetail));
 render(<AcademicWorkspace client={client} context={context} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:'SUL · devolvida'}));
 expect(await screen.findByText('Motivo da devolução técnica: Current technical return')).toBeTruthy();
 expect(screen.queryByText(/Motivo da retificação CAM:/)).toBeNull();
 expect(screen.queryByText(/Old CAM reason/)).toBeNull();
 expect((screen.getByLabelText('Justificativa da correção') as HTMLTextAreaElement).value).toBe('Current author justification');
});
it('CAM requires reason/reference and retries ambiguous decisions with the exact original operation',async()=>{
 const bodies:Record<string,unknown>[]=[];const unavailable={...detail,position:{...position,status:'validada',estadoDado:'indisponivel',inputValue:null,resultValue:null},revisions:[{...detail.revisions[0],estadoDado:'indisponivel',value:null}],decisions:[{...detail.decisions[0],type:'validar'}],memories:[]};
 const client=api(async(url,options)=>{
  if(String(url).includes('get_operational_positions'))return response({items:[unavailable.position],total:1,page:1,pageSize:25});
  if(String(url).includes('get_position_detail'))return response(unavailable);
  bodies.push(JSON.parse(String(options?.body)));return response(bodies.length===1?null:{resourceId:'pos',version:6,revisionId:'old',status:'validada',resultValue:null});
 });
 render(<AcademicWorkspace client={client} context={{...context,key:'cam',role:'cam'}} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:'SUL · validada'}));
 fireEvent.click(await screen.findByRole('button',{name:'Decidir indisponibilidade'}));
 expect(await screen.findByRole('alert')).toBeTruthy();expect(bodies).toHaveLength(0);
 fireEvent.change(screen.getByLabelText('Motivo CAM'),{target:{value:'  Synthetic reason  '}});
 fireEvent.change(screen.getByLabelText('Referência de demonstração'),{target:{value:' DEMO-REF '}});
 fireEvent.click(screen.getByRole('button',{name:'Decidir indisponibilidade'}));
 fireEvent.click(await screen.findByRole('button',{name:'Repetir operação pendente'}));
 expect(await screen.findByText('Decisão CAM confirmada: validada.')).toBeTruthy();expect(bodies[0]).toEqual(bodies[1]);
 expect(bodies[0]).toMatchObject({p_reason:'Synthetic reason',p_reference:'DEMO-REF'});
});
it('does not apply a late correction receipt to a new context',async()=>{
 let finish!:(r:Response)=>void;const pending=new Promise<Response>(resolve=>{finish=resolve;});
 const client=api(async url=>String(url).includes('get_operational_positions')?response({items:[position],total:1,page:1,pageSize:25}):String(url).includes('get_position_detail')?response(detail):pending);
 const view=render(<AcademicWorkspace client={client} context={context} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:'SUL · devolvida'}));fireEvent.click(await screen.findByRole('button',{name:'Enviar nova revisão'}));
 view.rerender(<AcademicWorkspace client={client} context={{...context,key:'other',role:'gestor_unidade'}} onSignOut={()=>{}} />);
 await act(async()=>{finish(response({resourceId:'pos',version:6,revisionId:'new',status:'enviada',resultValue:'9.6'}));});
 expect(screen.queryByText(/Nova revisão enviada/)).toBeNull();
});
it('keeps the exact local correction input/version/key after an ambiguous response',async()=>{
 const bodies:Record<string,unknown>[]=[];
 const client=api(async(url,options)=>{
  if(String(url).includes('get_operational_positions'))return response({items:[position],total:1,page:1,pageSize:25});
  if(String(url).includes('get_position_detail'))return response(detail);
  bodies.push(JSON.parse(String(options?.body)));return response(bodies.length===1?null:{resourceId:'pos',version:6,revisionId:'new',status:'enviada',resultValue:'9.6'});
 });
 render(<AcademicWorkspace client={client} context={context} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:'SUL · devolvida'}));
 fireEvent.change(await screen.findByLabelText('Valor corrigido'),{target:{value:'12'}});fireEvent.click(screen.getByRole('button',{name:'Enviar nova revisão'}));
 const retry=await screen.findByRole('button',{name:'Repetir operação pendente'});
 expect((screen.getByLabelText('Valor corrigido') as HTMLInputElement).disabled).toBe(true);
 fireEvent.click(retry);expect(await screen.findByText(/Nova revisão enviada.*9.6/)).toBeTruthy();expect(bodies[1]).toEqual(bodies[0]);
});
it.each([
 {resourceId:'other',version:6,revisionId:'new',status:'enviada',resultValue:'9.6'},
 {resourceId:'pos',version:6,revisionId:null,status:'enviada',resultValue:'9.6'},
 {resourceId:'pos',version:6,revisionId:'new',status:'validada',resultValue:'9.6'},
])('treats incompatible correction receipts as ambiguous, not confirmed server rejections',async receipt=>{
 await expect(correctPosition(api(async()=>response(receipt)),context,'pos',5,{estadoDado:'valor',valor:'12',fonte:'Synthetic',periodoFonte:'2026-10-01',motivo:''},'op')).rejects.toMatchObject({confirmedRejected:false});
});
it('requires command-specific CAM status and null unavailable result',async()=>{
 await expect(authorizeCorrection(api(async()=>response({resourceId:'pos',version:6,revisionId:'old',status:'validada',resultValue:'8'})),context,'pos',5,'reason','op')).rejects.toMatchObject({confirmedRejected:false});
 await expect(decideUnavailability(api(async()=>response({resourceId:'pos',version:6,revisionId:'old',status:'validada',resultValue:'0'})),context,'pos',5,'DEMO','reason','op')).rejects.toMatchObject({confirmedRejected:false});
});
