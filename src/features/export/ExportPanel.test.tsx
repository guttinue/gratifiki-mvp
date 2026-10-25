import { createClient } from '@supabase/supabase-js';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizedContext, CycleChecklist } from '../pilot/types';
import { ExportPanel } from './ExportPanel';
const context:AuthorizedContext={key:'cam',actorId:'actor',vinculoId:'link',competenciaId:'month',indicadorId:'indicator',role:'cam',escopoId:'district',escopoCodigo:'North',competenciaCodigo:'2026-10',mode:'academic'};
const checklist:CycleChecklist={version:1,state:'fechada',snapshotId:'snapshot',publication:'nao_publicada',publicationId:null,fullCoverage:true,expected:1,received:1,reviewed:1,unavailable:0,notApplicable:0,decidedUnavailable:0,canConsolidate:false,canClose:false,blockers:[]};
const bundle={contractVersion:1,snapshotId:'snapshot',rows:[{snapshotId:'snapshot',competencia:'2026-10',indicador:'DEMO-01',alvoTipo:'unidade',alvoCodigo:'A',regraVersao:1,revisao:1,estadoDado:'valor',entrada:'10',fator:'0.8',resultado:'8',publicacao:'nao_publicada'}],manifest:{competencia:'2026-10',ruleVersions:[1],publicationVersion:0,positionCount:1,calculableCount:1,unavailableCount:0,notApplicableCount:0,totals:[{tipo:'unidade',unidadeMedida:'pontos sintéticos',sum:'8'}]}};
function client(fetch:typeof globalThis.fetch){return createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch}});}
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('CAM export from durable checklist',()=>{
 it('explains why an open or incompletely authorized cycle cannot be downloaded',()=>{
  render(<ExportPanel client={client(async()=>{throw Error('must not call');})} context={context} checklist={{...checklist,state:'aberta',snapshotId:null}}/>);
  expect(screen.getByRole('button',{name:'Baixar CSV'}).hasAttribute('disabled')).toBe(true);
  expect(screen.getByText(/snapshot fechado com cobertura CAM integral/i)).toBeTruthy();
 });
 it('rechecks access on every download and retries exactly the ambiguous operation',async()=>{
  const payloads:unknown[]=[];let n=0;
  const c=client(async(_url,init)=>{payloads.push(JSON.parse(String(init?.body)));n++;if(n===1)throw Error('lost response');return new Response(JSON.stringify(bundle),{headers:{'content-type':'application/json'}});});
  const blobs:Blob[]=[];vi.stubGlobal('URL',class extends URL{static createObjectURL(blob:Blob){blobs.push(blob);return 'blob:local';}static revokeObjectURL(){}});
  const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  render(<ExportPanel client={c} context={context} checklist={checklist}/>);
  fireEvent.click(screen.getByRole('button',{name:'Baixar CSV'}));
  await screen.findByRole('button',{name:'Repetir exportação pendente'});
  expect(screen.getByRole('button',{name:'Baixar manifesto JSON'}).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Repetir exportação pendente'}));
  await waitFor(()=>expect(click).toHaveBeenCalledTimes(1));expect(payloads[1]).toEqual(payloads[0]);
  expect(blobs[0].type).toBe('text/csv;charset=utf-8');
  fireEvent.click(screen.getByRole('button',{name:'Baixar manifesto JSON'}));
  await waitFor(()=>expect(click).toHaveBeenCalledTimes(2));expect(payloads[2]).not.toEqual(payloads[1]);
  expect(blobs[1].type).toBe('application/json;charset=utf-8');
  vi.unstubAllGlobals();
 });
 it('does not download a late response after navigation',async()=>{
  let resolve!:(r:Response)=>void;const response=new Promise<Response>(r=>{resolve=r;});
  const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  const view=render(<ExportPanel client={client(async()=>response)} context={context} checklist={checklist}/>);
  fireEvent.click(screen.getByRole('button',{name:'Baixar CSV'}));view.unmount();resolve(new Response(JSON.stringify(bundle),{headers:{'content-type':'application/json'}}));
  await response;await new Promise(r=>setTimeout(r,0));expect(click).not.toHaveBeenCalled();
 });
});
