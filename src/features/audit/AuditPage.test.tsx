import { createClient } from '@supabase/supabase-js';
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,it,expect } from 'vitest';
import { AuditPage } from './AuditPage';
import type { AuthorizedContext } from '../pilot/types';
afterEach(cleanup);
const context:AuthorizedContext={key:'k',actorId:'a',role:'administrador',vinculoId:'v',competenciaId:'c',indicadorId:'i',escopoId:'s',escopoCodigo:'NORTE',competenciaCodigo:'2026-10',mode:'academic'};
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
