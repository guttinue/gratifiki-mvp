import { createClient } from '@supabase/supabase-js';
import { act,cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,it,expect } from 'vitest';
import { EvaluationPage } from './EvaluationPage';
import type { AuthorizedContext } from '../pilot/types';
afterEach(cleanup);
const context:AuthorizedContext={key:'k',actorId:'a',role:'gestor_distrital',vinculoId:'v',competenciaId:'c',indicadorId:'i',escopoId:'s',escopoCodigo:'NORTE',competenciaCodigo:'2026-10',mode:'academic'};
const row={id:'p',escopoId:'s',escopoCodigo:'NORTE',escopoTipo:'distrito',estadoDado:'valor',inputValue:'100',resultValue:'80',ruleVersion:1,publication:'preliminar',snapshotId:null,factor:'0.8',unidadeMedida:'pontos sintéticos'};
it('separates district own from territorial units and keeps rule versions noncomparable',async()=>{
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(_url,init)=>{const request=JSON.parse(String(init?.body));const items=request.p_view==='own'?[row]:[{...row,id:'u1',escopoId:'u1',escopoCodigo:'ALFA',escopoTipo:'unidade',inputValue:'10',resultValue:'8'},{...row,id:'u2',escopoId:'u2',escopoCodigo:'BETA',escopoTipo:'unidade',ruleVersion:2,inputValue:'12',resultValue:'9.6'}];return new Response(JSON.stringify({items,total:items.length,page:1,pageSize:25}),{headers:{'content-type':'application/json'}});}}});
 render(<EvaluationPage client={client} context={context}/>);
 expect(await screen.findByText('100 × 0.8 = 80')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Unidades do território'}));
 expect(await screen.findByText('ALFA')).toBeTruthy();expect(screen.queryByText('100 × 0.8 = 80')).toBeNull();
 expect(screen.getByText(/Versões de regra diferentes: resultados não comparáveis/)).toBeTruthy();
});
it('changes competence without comparing different rule versions or retaining the prior result',async()=>{
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(_url,init)=>{
  const request=JSON.parse(String(init?.body));const later=request.p_contexto.competenciaId==='november';
  return new Response(JSON.stringify({items:[later?{...row,ruleVersion:2,factor:'0.9',inputValue:'10',resultValue:'9'}:row],total:1,page:1,pageSize:25}),{headers:{'content-type':'application/json'}});
 }}});
 const view=render(<EvaluationPage client={client} context={context}/>);
 expect(await screen.findByText('100 × 0.8 = 80')).toBeTruthy();
 view.rerender(<EvaluationPage client={client} context={{...context,key:'november',competenciaId:'november',competenciaCodigo:'2026-11'}}/>);
 expect(await screen.findByText('10 × 0.9 = 9')).toBeTruthy();
 expect(screen.getByText(/Regra v2/)).toBeTruthy();expect(screen.queryByText('100 × 0.8 = 80')).toBeNull();
 expect(screen.getByText(/Versões de regra diferentes: resultados não comparáveis/)).toBeTruthy();
});
it('does not reveal a late evaluation from a previous authorized context',async()=>{
 let finish!:(response:Response)=>void;let requested!:()=>void;
 const pending=new Promise<Response>(resolve=>{finish=resolve;});const started=new Promise<void>(resolve=>{requested=resolve;});
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(_url,init)=>{
  const request=JSON.parse(String(init?.body));if(request.p_contexto.vinculoId==='v'){requested();return pending;}
  return new Response(JSON.stringify({items:[],total:0,page:1,pageSize:25}),{headers:{'content-type':'application/json'}});
 }}});
 const view=render(<EvaluationPage client={client} context={context}/>);await started;
 view.rerender(<EvaluationPage client={client} context={{...context,key:'other',vinculoId:'other',competenciaCodigo:'2026-11'}}/>);
 expect(await screen.findByText('Nenhuma avaliação tecnicamente validada disponível neste filtro.')).toBeTruthy();
 await act(async()=>{finish(new Response(JSON.stringify({items:[row],total:1,page:1,pageSize:25}),{headers:{'content-type':'application/json'}}));});
 expect(screen.queryByText('100 × 0.8 = 80')).toBeNull();expect(screen.getByText('Competência: 2026-11')).toBeTruthy();
});
