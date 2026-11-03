import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { loadCycleChecklist } from './cycleApi';
const context={vinculoId:'link',competenciaId:'month',indicadorId:'indicator'};
const checklist={version:1,state:'aberta',expected:16,received:10,reviewed:9,unavailable:1,decidedUnavailable:0,notApplicable:0,fullCoverage:true,canConsolidate:false,canClose:false,snapshotId:null,publication:'nao_publicada',publicationId:null,blockers:[]};
const client=(data:unknown)=>createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}})}});
describe('model-3 ready count in the cycle checklist',()=>{
 it('keeps the model-2 checklist without a ready count and reads it for model 3',async()=>{
  expect((await loadCycleChecklist(client(checklist),context)).ready).toBeUndefined();
  expect((await loadCycleChecklist(client({...checklist,ready:9}),context)).ready).toBe(9);
 });
 it.each([-1,17,'9',1.5,null])('rejects ready=%j',async ready=>{
  await expect(loadCycleChecklist(client({...checklist,ready}),context)).rejects.toMatchObject({code:'invalid_input'});
 });
});
