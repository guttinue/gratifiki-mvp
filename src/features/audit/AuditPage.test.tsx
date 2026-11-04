import { createClient } from '@supabase/supabase-js';
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,it,expect } from 'vitest';
import { AuditPage } from './AuditPage';
import { groupContexts } from '../context/contextGroups';
import type { AuthorizedContext } from '../pilot/types';
afterEach(cleanup);
const context:AuthorizedContext={key:'k',actorId:'a',role:'administrador',vinculoId:'v',competenciaId:'c',indicadorId:'i',escopoId:'s',escopoCodigo:'NORTE',competenciaCodigo:'2026-10',mode:'academic',modelo:2};
it('renders administrative metadata without exposing values outside its contract',async()=>{
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>new Response(JSON.stringify({items:[{id:'e',occurredAt:'2026-10-20T12:00:00Z',action:'vinculo_demo_alterado',resourceId:'v',version:2,reason:null,inputValue:'SECRET-VALUE'}],total:1,page:1,pageSize:25}),{headers:{'content-type':'application/json'}})}});
 render(<AuditPage client={client} context={context}/>);
 expect(await screen.findByText('vinculo_demo_alterado')).toBeTruthy();expect(screen.queryByText('SECRET-VALUE')).toBeNull();
 expect(screen.getByText('20/10/2026, 09:00').getAttribute('dateTime')).toBe('2026-10-20T12:00:00Z');
});
it('offers authorized target search alongside the exact operational action filter',async()=>{
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(_url,init)=>{
  const request=JSON.parse(String(init?.body));const matches=request.p_filters.search==='ALFA'&&request.p_filters.status==='posicao_validada';
  const items=matches?[{id:'event',occurredAt:'2026-10-21T12:00:00Z',action:'posicao_validada',resourceId:'pos',version:5,reason:'Independent evidence'}]:[];
  return new Response(JSON.stringify({items,total:items.length,page:1,pageSize:25}),{headers:{'content-type':'application/json'}});
 }}});
 render(<AuditPage client={client} context={{...context,role:'revisor_tecnico'}}/>);
 fireEvent.change(screen.getByLabelText('Buscar ação ou alvo'),{target:{value:'ALFA'}});
 fireEvent.change(screen.getByLabelText('Ação exata'),{target:{value:'posicao_validada'}});
 fireEvent.click(screen.getByRole('button',{name:'Filtrar histórico'}));
 expect(await screen.findByText('posicao_validada')).toBeTruthy();expect(screen.getByText('Eventos no filtro: 1')).toBeTruthy();
});
// T7 (HI-01): the model-3 view reads every context and writes readable lines.
const v3=(n:number,role:AuthorizedContext['role']):AuthorizedContext=>({...context,key:`v3-${n}`,role,vinculoId:`link-${n}`,indicadorId:`indicator-${n}`,escopoCodigo:'ACADEMIC-NORTE-1',competenciaCodigo:'ACADEMIC-V3-2026-10',modelo:3});
function v3Client(){
 const calls:{name:string;indicadorId:string}[]=[];
 const event={id:'returned',occurredAt:'2026-10-21T12:00:00Z',action:'posicao_devolvida',resourceId:'pos-alfa-03',version:2,reason:'fonte de setembro'};
 const position={id:'pos-alfa-03',escopoId:'alfa',escopoCodigo:'ACADEMIC-NORTE-1',escopoTipo:'unidade',aplicavel:true,status:'devolvida',estadoDado:'valor',version:2,revisionId:'rev',inputValue:'10',resultValue:null,indicatorCode:'DEMO-V1-03',indicatorName:'Rotinas concluídas'};
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url,init)=>{
  const name=String(url).split('/rpc/')[1];const body=JSON.parse(String(init?.body));calls.push({name,indicadorId:body.p_contexto.indicadorId});
  const items=name==='get_scoped_audit'?[event]:body.p_contexto.indicadorId==='indicator-2'?[position]:[];
  return new Response(JSON.stringify({items,total:items.length,page:1,pageSize:100}),{headers:{'content-type':'application/json'}});
 }}});
 return {client,calls};
}
it('reads every context of a model-3 view and writes readable lines',async()=>{
 const {client,calls}=v3Client();
 const group=groupContexts([v3(1,'revisor_tecnico'),v3(2,'revisor_tecnico')])[0];
 render(<AuditPage client={client} context={group.contexts[0]} group={group}/>);
 const line=await screen.findByText('Devolveu Unidade Alfa · DEMO-V1-03: fonte de setembro');
 expect(screen.getAllByText(/^Devolveu /)).toHaveLength(1);
 expect(line.closest('li')?.textContent).toContain('Revisor técnico');
 expect(screen.queryByText(/posicao_devolvida/)).toBeNull();expect(screen.queryByText(/pos-alfa-03/)).toBeNull();
 expect(calls.filter(c=>c.name==='get_scoped_audit').map(c=>c.indicadorId).sort()).toEqual(['indicator-1','indicator-2']);
});
it('does not read positions for a model-3 manager history',async()=>{
 const {client,calls}=v3Client();
 const group=groupContexts([v3(1,'gestor_unidade'),v3(2,'gestor_unidade')])[0];
 render(<AuditPage client={client} context={group.contexts[0]} group={group}/>);
 expect(await screen.findByText('Devolveu: fonte de setembro')).toBeTruthy();
 expect(calls.some(c=>c.name==='get_operational_positions')).toBe(false);
});
