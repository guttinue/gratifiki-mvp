import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { submitPosition } from './submitApi';
const context={vinculoId:'link',competenciaId:'month',indicadorId:'indicator'};
describe('submit transport',()=>{
 it('uses the current version and preserves the exact tiny result',async()=>{
  const client=createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(url,init)=>{
   expect(String(url)).toContain('/rpc/submit_position');
   expect(JSON.parse(String(init?.body))).toEqual({p_contexto:context,p_position_id:'position',p_expected_version:8,p_operation_id:'operation'});
   return new Response(JSON.stringify({resourceId:'position',version:9,revisionId:'revision',status:'enviada',resultValue:'0.00008'}),{headers:{'content-type':'application/json'}});
  }}});
  const receipt=await submitPosition(client,{...context,actorId:'spoof'} as typeof context,'position',8,'operation');
  expect(receipt.resultValue).toBe('0.00008');
 });
 it.each([{resourceId:'other',version:2,revisionId:'r',status:'enviada',resultValue:'8'}, {resourceId:'position',version:2,revisionId:null,status:'enviada',resultValue:'8'}, {resourceId:'position',version:2,revisionId:'r',status:'rascunho',resultValue:'8'}])('rejects incompatible submission receipt',async(receipt)=>{
  const client=createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>new Response(JSON.stringify(receipt),{headers:{'content-type':'application/json'}})}});
  await expect(submitPosition(client,context,'position',1,'op')).rejects.toMatchObject({code:'invalid_input'});
 });
});
