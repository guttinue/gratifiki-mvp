import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { AcademicWorkspace } from './AcademicWorkspace';
import type { AuthorizedContext } from '../pilot/types';
const openAcademicPage=(page:string)=>window.history.replaceState({},'',`/#academico/${page}`);
afterEach(()=>{cleanup();vi.restoreAllMocks();window.history.replaceState({},'', '/');});
const context:AuthorizedContext={key:'context',actorId:'actor',role:'area_tecnica',vinculoId:'link',competenciaId:'month',indicadorId:'indicator',escopoId:'scope',escopoCodigo:'NORTE',competenciaCodigo:'2026-10',mode:'academic'};
const position={id:'pos',escopoId:'scope',escopoCodigo:'NORTE-1',escopoTipo:'unidade',aplicavel:true,status:'ausente',estadoDado:null,version:1,revisionId:null,inputValue:null,resultValue:null};
it('follows authorized history hashes and canonicalizes forged admin navigation without an admin RPC',async()=>{
 const calls:string[]=[];
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>{
  calls.push(String(url));return new Response(JSON.stringify({items:[],total:0,page:1,pageSize:25}),{headers:{'content-type':'application/json'}});
 }}});
 window.history.replaceState({},'', '/#academico/historico');
 render(<AcademicWorkspace client={client} context={{...context,role:'gestor_unidade'}} onSignOut={()=>{}}/>);
 expect(await screen.findByRole('heading',{name:'Histórico autorizado'})).toBeTruthy();
 act(()=>{window.location.hash='#academico/cadastros';window.dispatchEvent(new HashChangeEvent('hashchange'));});
 await waitFor(()=>expect(window.location.hash).toBe('#academico/painel'));
 expect(screen.queryByRole('heading',{name:'Histórico autorizado'})).toBeNull();
 expect(calls.some(url=>url.includes('get_admin_catalog'))).toBe(false);
});
it('keeps an unsaved draft when navigation is cancelled and focuses the destination after leaving',async()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 openAcademicPage('preenchimento');
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>new Response(JSON.stringify(String(url).includes('get_position_detail')?{position,revisions:[],decisions:[],memories:[]}:{items:[position],total:1,page:1,pageSize:25}),{headers:{'content-type':'application/json'}})}});
 render(<AcademicWorkspace client={client} context={context} onSignOut={()=>{}}/>);
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
 render(<AcademicWorkspace client={client} context={context} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:/NORTE-1/}));
 expect(await screen.findByRole('button',{name:'Salvar rascunho'})).toBeTruthy();
 expect((screen.getByRole('button',{name:'Enviar'}) as HTMLButtonElement).disabled).toBe(true);
});
it('keeps non-area roles on context confirmation without operational reads',()=>{
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>{throw new Error('should not read');}}});
 render(<AcademicWorkspace client={client} context={{...context,role:'gestor_unidade'}} onSignOut={()=>{}} />);
 expect(screen.getByText(/Perfil gestor_unidade/)).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Salvar rascunho'})).toBeNull();
});
it('mounts real manager evaluations and sanitized history in authenticated workspace',async()=>{
 openAcademicPage('resultados');
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>new Response(JSON.stringify({items:[],total:0,page:1,pageSize:25,request:String(url)}),{headers:{'content-type':'application/json'}})}});
 render(<AcademicWorkspace client={client} context={{...context,role:'gestor_unidade'}} onSignOut={()=>{}}/>);
 expect(await screen.findByText('Nenhuma avaliação tecnicamente validada disponível neste filtro.')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Histórico'}));
 expect(await screen.findByText('Nenhum evento autorizado neste filtro.')).toBeTruthy();
});
it('integrates catalogue and business links without operational reads for admin',async()=>{
 openAcademicPage('vinculos');
 const calls:string[]=[];
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url)=>{
  calls.push(String(url));return new Response(JSON.stringify({scopes:[],accounts:[],links:[],indicators:[{id:'indicator',codigo:'DEMO-01'}]}),{headers:{'content-type':'application/json'}});
 }}});
 render(<AcademicWorkspace client={client} context={{...context,role:'administrador'}} onSignOut={()=>{}}/>);
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
 const view=render(<AcademicWorkspace client={client} context={context} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:/NORTE-1/}));
 view.rerender(<AcademicWorkspace client={client} context={{...context,key:'other',role:'gestor_unidade',escopoCodigo:'OUTRO'}} onSignOut={()=>{}} />);
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
 render(<AcademicWorkspace client={client} context={context} onSignOut={()=>{}}/>);
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
 render(<AcademicWorkspace client={client} context={{...context,role:'lideranca'}} onSignOut={()=>{}}/>);
 expect(await screen.findByRole('heading',{name:'Agregados de unidades publicadas'})).toBeTruthy();
 expect(window.location.hash).toBe('#academico/painel');
 expect(calls.some(url=>url.includes('get_dashboard'))).toBe(false);
});
