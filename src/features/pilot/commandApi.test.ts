import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { DomainCommandError, runCommand } from './commandApi';
const context={vinculoId:'link',competenciaId:'month',indicadorId:'indicator'};
describe('safe command errors',()=>{
 it('uses an explicit typed decoder for another protocol while protecting actor/context/operation transport',async()=>{
  let payload:unknown;
  const client=createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(_url,init)=>{payload=JSON.parse(String(init?.body));return new Response('{"answer":"validated"}',{headers:{'content-type':'application/json'}});}}});
  const decode=(value:unknown):{answer:string}=>{if(!value||typeof value!=='object'||!('answer' in value)||typeof value.answer!=='string')throw new DomainCommandError('invalid_input');return{answer:value.answer};};
  expect(await runCommand(client,'another_protocol',context,{p_contexto:{vinculoId:'forged'},p_operation_id:'forged'},'original',decode)).toEqual({answer:'validated'});
  expect(payload).toEqual({p_contexto:context,p_operation_id:'original'});
 });
 it('still validates a default receipt and never accepts another protocol without decoder',async()=>{
  const make=(data:unknown)=>createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}})}});
  const receipt={resourceId:'p',version:2,revisionId:'r',status:'enviada',resultValue:'0'};
  expect(await runCommand(make(receipt),'submit_position',context,{},'op')).toEqual(receipt);
  await expect(runCommand(make({answer:'wrong protocol'}),'submit_position',context,{},'op')).rejects.toMatchObject({code:'invalid_input',confirmedRejected:false});
 });
 it.each([null,[],
  ...['resourceId','version','revisionId','status','resultValue'].map(field=>Object.fromEntries(Object.entries({resourceId:'p',version:1,revisionId:null,status:'enviada',resultValue:null}).filter(([key])=>key!==field))),
  ...[1.5,Number.MAX_SAFE_INTEGER+1].map(version=>({resourceId:'p',version,revisionId:null,status:'enviada',resultValue:null})),
  ...[8,'1e-4','8.0','0.0000800000'].map(resultValue=>({resourceId:'p',version:1,revisionId:null,status:'enviada',resultValue}))
 ])('never treats malformed successful receipt %j as a confirmed rejection',async(data)=>{
  const client=createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}})}});
  await expect(runCommand(client,'submit_position',context,{},'op')).rejects.toMatchObject({code:'invalid_input',confirmedRejected:false});
 });
 it.each([['42501','private table secret','access_denied'],['40001','private sql','version_conflict'],['22023','operation_payload_mismatch','operation_payload_mismatch'],['55000','invalid_state','invalid_state'],['22023','invalid_input','invalid_input'],['22023','rule_unavailable','rule_unavailable']])('maps %s without leaking upstream diagnostics',async(sql,message,code)=>{
  const client=createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>new Response(JSON.stringify({code:sql,message,details:'secret'}),{status:400,headers:{'content-type':'application/json'}})}});
  await expect(runCommand(client,'submit_position',context,{},'op')).rejects.toMatchObject({code});
  try {await runCommand(client,'submit_position',context,{},'op');}catch(error){expect(JSON.stringify(error)).not.toContain('secret');expect(String(error)).not.toContain('private');}
 });
 it('maps response loss to safe network error',async()=>{
  const client=createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>{throw new Error('secret url');}}});
  await expect(runCommand(client,'submit_position',context,{},'op')).rejects.toMatchObject({code:'network_error'});
 });
});
