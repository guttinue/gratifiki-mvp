import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it,vi } from 'vitest';
import { DraftForm } from './DraftForm';
import type { PositionDetail } from './positionApi';
const context={vinculoId:'link',competenciaId:'month',indicadorId:'indicator'};
const detail:PositionDetail={position:{id:'position',escopoId:'scope',escopoCodigo:'NORTE-1',escopoTipo:'unidade',aplicavel:true,status:'ausente',estadoDado:null,version:1,revisionId:null,inputValue:null,resultValue:null},revisions:[],decisions:[],memories:[]};
afterEach(()=>{cleanup();vi.restoreAllMocks();localStorage.clear();});
function client(fail=false) { return createClient('http://localhost:54321','public-test-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(_url,init)=>{
 const body=JSON.parse(String(init?.body));
 expect(body.p_input).toEqual({estadoDado:'indisponivel',valor:null,fonte:'',periodoFonte:'',motivo:''});
 return new Response(JSON.stringify(fail?{message:'version_conflict',code:'40001'}:{resourceId:'position',version:2,revisionId:'rev',status:'rascunho',resultValue:null}),{status:fail?409:200,headers:{'content-type':'application/json'}});
}}}); }
describe('draft form',()=>{
 it('requires a real own save before submitting an inherited draft',async()=>{
  const inherited:PositionDetail={...detail,position:{...detail.position,status:'rascunho',version:3,revisionId:'old-revision'},revisions:[{id:'old-revision',number:1,authorId:'previous-informant',estadoDado:'valor',value:'10',source:'Origem preservada',sourcePeriod:'2026-11-01',reason:'',submittedAt:null}]};
  const transport=createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>new Response(JSON.stringify({resourceId:'position',version:4,revisionId:'own-revision',status:'rascunho',resultValue:null}),{headers:{'content-type':'application/json'}})}});
  render(<DraftForm actorId="new-informant" client={transport} context={context} detail={inherited} onSaved={()=>{}}/>);
  expect((screen.getByRole('button',{name:'Enviar'}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText('Fonte') as HTMLInputElement).value).toBe('Origem preservada');
  fireEvent.click(screen.getByRole('button',{name:'Salvar rascunho'}));await screen.findByText('Rascunho salvo. Ainda não enviado.');
  expect((screen.getByRole('button',{name:'Enviar'}) as HTMLButtonElement).disabled).toBe(false);
 });
 it('saves incomplete unavailable draft without inventing origin or sending',async()=>{
  render(<DraftForm client={client()} context={context} detail={detail} onSaved={()=>{}} />);
  fireEvent.change(screen.getByLabelText('Estado do dado'),{target:{value:'indisponivel'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar rascunho'}));
  await screen.findByText('Rascunho salvo. Ainda não enviado.');
  expect((screen.getByRole('button',{name:'Enviar'}) as HTMLButtonElement).disabled).toBe(false);
 });
 it('retains invalid exact input and never saves it',async()=>{
  let requests=0;
  const transport=createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>{requests++;throw new Error('unexpected request');}}});
  render(<DraftForm client={transport} context={context} detail={detail} onSaved={()=>{}} />);
  fireEvent.change(screen.getByLabelText('Valor'),{target:{value:'1.234,56'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar rascunho'}));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('Valor') as HTMLInputElement).value).toBe('1.234,56');
  expect(requests).toBe(0);
 });
 it('preserves input when server rejects a stale version',async()=>{
  render(<DraftForm client={client(true)} context={context} detail={detail} onSaved={()=>{}} />);
  fireEvent.change(screen.getByLabelText('Estado do dado'),{target:{value:'indisponivel'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar rascunho'}));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('versão'));
  expect((screen.getByLabelText('Estado do dado') as HTMLSelectElement).value).toBe('indisponivel');
 });
});
it('submits using the saved version, preserves a lost-response retry across remount, and locks sent content',async()=>{
 const calls:Record<string,unknown>[]=[];
 let lost=true;
 const transport=createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url,init)=>{
  const body=JSON.parse(String(init?.body));
  if(String(url).includes('save_position_draft'))return new Response(JSON.stringify({resourceId:'position',version:2,revisionId:'rev',status:'rascunho',resultValue:null}),{headers:{'content-type':'application/json'}});
  calls.push(body);
  if(lost){lost=false;throw new Error('response lost');}
  return new Response(JSON.stringify({resourceId:'position',version:3,revisionId:'rev',status:'enviada',resultValue:'0.00008'}),{headers:{'content-type':'application/json'}});
 }}});
 let completed=0;
 const view=render(<DraftForm actorId="actor" client={transport} context={context} detail={detail} onSaved={()=>{}} onSubmitted={()=>{completed++;}} />);
 fireEvent.change(screen.getByLabelText('Valor'),{target:{value:'0.0001'}});
 fireEvent.change(screen.getByLabelText('Fonte'),{target:{value:'synthetic'}});
 fireEvent.change(screen.getByLabelText('Período da fonte'),{target:{value:'2026-10-01'}});
 fireEvent.click(screen.getByRole('button',{name:'Salvar rascunho'}));
 await screen.findByText('Rascunho salvo. Ainda não enviado.');
 fireEvent.click(screen.getByRole('button',{name:'Enviar'}));
 await screen.findByRole('alert');
 expect(calls[0].p_expected_version).toBe(2);
 view.unmount();
 render(<DraftForm actorId="actor" client={transport} context={context} detail={{...detail,position:{...detail.position,status:'enviada',version:3,revisionId:'rev'}}} onSaved={()=>{}} onSubmitted={()=>{completed++;}} />);
 fireEvent.click(screen.getByRole('button',{name:'Repetir envio pendente'}));
 await screen.findByText(/Envio confirmado/);
 expect(screen.getByText('Resultado sintético: 0.00008')).toBeTruthy();
 expect(calls).toHaveLength(2);expect(calls[1]).toEqual(calls[0]);expect(completed).toBe(1);
 expect((screen.getByLabelText('Valor') as HTMLInputElement).disabled).toBe(true);
});
it('never confirms submission after leaving the position',async()=>{
 let respond!:(response:Response)=>void;
 let calls=0;let completed=0;
 const savedDetail:PositionDetail={...detail,position:{...detail.position,status:'rascunho',version:2,revisionId:'rev'},revisions:[{id:'rev',number:1,authorId:'actor',estadoDado:'valor',value:'10',source:'synthetic',sourcePeriod:'2026-10-01',reason:'',submittedAt:null}]};
 const transport=createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>{calls++;return new Promise<Response>(resolve=>{respond=resolve;});}}});
 const view=render(<DraftForm actorId="actor" client={transport} context={context} detail={savedDetail} onSaved={()=>{}} onSubmitted={()=>{completed++;}} />);
 fireEvent.click(screen.getByRole('button',{name:'Enviar'}));
 await waitFor(()=>expect(calls).toBe(1));view.unmount();
 respond(new Response(JSON.stringify({resourceId:'position',version:3,revisionId:'rev',status:'enviada',resultValue:'8'}),{headers:{'content-type':'application/json'}}));
 await waitFor(()=>expect(completed).toBe(0));
});
it('fails closed before submission if the operation cannot be stored',async()=>{
 let calls=0;
 const savedDetail:PositionDetail={...detail,position:{...detail.position,status:'rascunho',version:2,revisionId:'rev'},revisions:[{id:'rev',number:1,authorId:'actor',estadoDado:'valor',value:'10',source:'synthetic',sourcePeriod:'2026-10-01',reason:'',submittedAt:null}]};
 const transport=createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>{calls++;throw new Error('unexpected');}}});
 render(<DraftForm actorId="actor" client={transport} context={context} detail={savedDetail} onSaved={()=>{}} />);
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('denied');});
 fireEvent.click(screen.getByRole('button',{name:'Enviar'}));
 expect((await screen.findByRole('alert')).textContent).toContain('armazenamento');expect(calls).toBe(0);
 expect((screen.getByRole('button',{name:'Enviar'}) as HTMLButtonElement).disabled).toBe(true);
});
it('releases an explicitly rejected version-conflict key so refreshed data can start a new operation',async()=>{
 const savedDetail:PositionDetail={...detail,position:{...detail.position,status:'rascunho',version:2,revisionId:'rev'},revisions:[{id:'rev',number:1,authorId:'actor',estadoDado:'valor',value:'10',source:'synthetic',sourcePeriod:'2026-10-01',reason:'',submittedAt:null}]};
 const transport=createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>new Response(JSON.stringify({code:'40001',message:'version_conflict'}),{status:409,headers:{'content-type':'application/json'}})}});
 render(<DraftForm actorId="actor" client={transport} context={context} detail={savedDetail} onSaved={()=>{}} />);
 fireEvent.click(screen.getByRole('button',{name:'Enviar'}));await screen.findByRole('alert');
 expect(screen.queryByRole('button',{name:'Repetir envio pendente'})).toBeNull();
 expect(localStorage.length).toBe(0);
});
it('keeps the original pending operation when current access is denied, since an earlier attempt may have committed',async()=>{
 const savedDetail:PositionDetail={...detail,position:{...detail.position,status:'rascunho',version:2,revisionId:'rev'},revisions:[{id:'rev',number:1,authorId:'actor',estadoDado:'valor',value:'10',source:'synthetic',sourcePeriod:'2026-10-01',reason:'',submittedAt:null}]};
 const transport=createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>new Response(JSON.stringify({code:'42501',message:'access_denied'}),{status:403,headers:{'content-type':'application/json'}})}});
 render(<DraftForm actorId="actor" client={transport} context={context} detail={savedDetail} onSaved={()=>{}} />);
 fireEvent.click(screen.getByRole('button',{name:'Enviar'}));await screen.findByRole('alert');
 expect(screen.getByRole('button',{name:'Repetir envio pendente'})).toBeTruthy();expect(localStorage.length).toBe(1);
});
it('offers "Não se aplica" only when the group allows it, and saves it without a value',async()=>{
 const bodies:Record<string,unknown>[]=[];
 const transport=createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({resourceId:'position',version:2,revisionId:'rev',status:'rascunho',resultValue:null}),{headers:{'content-type':'application/json'}});}}});
 const view=render(<DraftForm client={transport} context={context} detail={detail} onSaved={()=>{}} />);
 expect(within(screen.getByLabelText('Estado do dado')).getAllByRole('option').map(o=>o.textContent)).toEqual(['Valor','Indisponível']);
 view.unmount();
 render(<DraftForm allowNotApplicable client={transport} context={context} detail={detail} onSaved={()=>{}} />);
 expect(within(screen.getByLabelText('Estado do dado')).getAllByRole('option').map(o=>o.textContent)).toEqual(['Valor','Indisponível','Não se aplica']);
 fireEvent.change(screen.getByLabelText('Valor'),{target:{value:'12'}});
 fireEvent.change(screen.getByLabelText('Estado do dado'),{target:{value:'nao_aplicavel'}});
 expect((screen.getByLabelText('Valor') as HTMLInputElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('Motivo'),{target:{value:'Sem atendimento no mês'}});
 fireEvent.click(screen.getByRole('button',{name:'Salvar rascunho'}));
 await screen.findByText('Rascunho salvo. Ainda não enviado.');
 expect(bodies[0].p_input).toEqual({estadoDado:'nao_aplicavel',valor:null,fonte:'',periodoFonte:'',motivo:'Sem atendimento no mês'});
});
