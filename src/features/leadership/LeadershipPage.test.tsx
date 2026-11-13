import { createClient } from '@supabase/supabase-js';
import { cleanup,render,screen } from '@testing-library/react';
import { afterEach,it,expect } from 'vitest';
import { LeadershipPage } from './LeadershipPage';
import type { AuthorizedContext } from '../pilot/types';
afterEach(cleanup);
const context:AuthorizedContext={key:'k',actorId:'a',role:'lideranca',vinculoId:'v',competenciaId:'c',indicadorId:'i',escopoId:'s',escopoCodigo:'NORTE',competenciaCodigo:'2026-10',mode:'academic',modelo:2};
it('shows nonfinancial published aggregates with calculable denominator and no individual drilldown',async()=>{
 const client=createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>new Response(JSON.stringify([{competencia:'2026-10',distritoCodigo:'NORTE',unidadeMedida:'pontos sintéticos',publishedUnits:3,calculableUnits:2,resultSum:'17.6'}]),{headers:{'content-type':'application/json'}})}});
 render(<LeadershipPage client={client} context={context}/>);
 expect(await screen.findByText(/17.6/)).toBeTruthy();expect(screen.getByText(/Calculáveis: 2 de 3 unidades publicadas/)).toBeTruthy();
 expect(screen.queryByRole('button',{name:/Detalhe|Entrada|Avaliação própria/})).toBeNull();
});
