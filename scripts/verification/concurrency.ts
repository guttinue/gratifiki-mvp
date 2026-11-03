import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { academicMonths, secondaryCredentials, type AcademicCredentials } from '../bootstrap/academicFixtures.ts';
import { validateOwnedTarget, type OwnedTarget } from './runtime.ts';

// Persistent real PostgreSQL connections. Barriers are observed lock ownership,
// not timing guesses or sleep-based promises that two requests overlapped.
export class Connection {
 private child;private output='';private waiting:((data:string)=>void)|undefined;
 constructor(target:OwnedTarget){
  validateOwnedTarget(target);
  this.child=spawn('docker',['exec','-i',`supabase_db_${target.projectId}`,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
  this.child.stdout.on('data',chunk=>{this.output+=String(chunk);this.waiting?.(this.output);});
  // SQL failures are fixed/sanitized at this boundary; never print SQL/session data.
  this.child.stderr.on('data',()=>{});
 }
 async query(sql:string):Promise<string>{
  const marker=`barrier_${randomUUID().replaceAll('-','')}`;this.output='';
  return new Promise((resolve,reject)=>{
   const fail=()=>{clearTimeout(timer);this.waiting=undefined;reject(Error('Owned concurrency connection failed'));};
   const timer=setTimeout(()=>{this.child.kill('SIGTERM');fail();},15000);
   this.child.once('error',fail);this.child.once('exit',fail);
   this.waiting=data=>{const end=data.indexOf(marker);if(end<0)return;clearTimeout(timer);this.child.removeListener('error',fail);this.child.removeListener('exit',fail);this.waiting=undefined;resolve(data.slice(0,end).trim());};
   this.child.stdin.write(`${sql}\n\\echo ${marker}\n`);
  });
 }
 async close(){this.child.stdin.end();await new Promise<void>(resolve=>{if(this.child.exitCode!==null){resolve();return;}this.child.once('exit',()=>resolve());});}
}
const literal=(value:unknown)=>`'${String(value).replaceAll("'","''")}'`;
type Context={vinculoId:string;competenciaId:string;indicadorId:string;role:string;actorId:string;escopoId:string;escopoCodigo:string;competenciaCodigo:string};
async function rpc(client:SupabaseClient,name:string,args:Record<string,unknown>={}){const {data,error}=await client.rpc(name,args);if(error)throw Error('Owned concurrency fixture RPC failed');return data;}
const commandContext=(c:Context)=>({vinculoId:c.vinculoId,competenciaId:c.competenciaId,indicadorId:c.indicadorId});
const command=(client:SupabaseClient,name:string,c:Context,args:Record<string,unknown>)=>rpc(client,name,{p_contexto:commandContext(c),...args,p_operation_id:randomUUID()});
function authenticate(c:Context){return `select set_config('request.jwt.claim.sub',${literal(c.actorId)},false);set role authenticated;`;}
function transition(c:Context,version:number,action:string){return `select public.transition_cycle(${literal(JSON.stringify(commandContext(c)))}::jsonb,${version},${literal(action)},'Synthetic race','DEMO-DECISAO-RACE',${literal(randomUUID())}::uuid)`;}
export async function blockedBy(owner:Connection,waiterPid:string,predecessorPid?:string){
 const deadline=Date.now()+5000;
 // With multiple row-lock waiters PostgreSQL can queue the third connection
 // behind the first waiter (a soft blocker), not directly behind the owner.
 // Accept ONLY that explicitly identified chain reaching our known owner.
 const condition=predecessorPid===undefined?`select pg_backend_pid()=any(pg_blocking_pids(${Number(waiterPid)}));`:
  `select exists(select 1 from pg_stat_activity w,pg_stat_activity p where w.pid=${Number(waiterPid)} and p.pid=${Number(predecessorPid)} and w.state='active' and p.state='active' and w.wait_event_type='Lock' and p.wait_event_type='Lock' and pg_backend_pid()=any(pg_blocking_pids(p.pid)) and (pg_backend_pid()=any(pg_blocking_pids(w.pid)) or p.pid=any(pg_blocking_pids(w.pid))));`;
 while(Date.now()<deadline){if(await owner.query(condition)==='t'){
  if(predecessorPid!==undefined)process.stdout.write(`Owned export lock chain verified (process IDs/states only): ${await owner.query(`select jsonb_agg(jsonb_build_object('owner',pg_backend_pid(),'pid',pid,'state',state,'waitType',wait_event_type,'blockers',pg_blocking_pids(pid)) order by pid) from pg_stat_activity where pid in (${Number(waiterPid)},${Number(predecessorPid)});`)}\n`);
  return;
 }await new Promise(resolve=>setTimeout(resolve,10));}
 process.stdout.write(`Owned concurrency barrier diagnostic (process IDs only): ${await owner.query(`select jsonb_build_object('owner',pg_backend_pid(),'waiter',${Number(waiterPid)},'blockers',pg_blocking_pids(${Number(waiterPid)}));`)}\n`);
 throw Error('Owned concurrency barrier did not observe a real lock wait');
}
export async function runClosureConcurrency(target:OwnedTarget,key:string,credentials:AcademicCredentials,afterClosed?:()=>Promise<void>){
 validateOwnedTarget(target);
 const identities={technical:credentials.area_tecnica,reviewer:credentials.revisor_tecnico,cam:credentials.cam,...secondaryCredentials(credentials)};
 const clients:Record<string,SupabaseClient>={};
 let a:Connection|undefined;let b:Connection|undefined;let exportConnection:Connection|undefined;
 try{
  for(const [name,credential] of Object.entries(identities)){
   const client=createClient(target.url,key,{auth:{persistSession:false,autoRefreshToken:false}});
   if((await client.auth.signInWithPassword(credential)).error)throw Error('Owned concurrency login failed');clients[name]=client;
  }
  async function contexts(client:SupabaseClient,role:string,month:string):Promise<Context[]>{return((await rpc(client,'get_authorized_contexts')).contexts as Context[]).filter(c=>c.role===role&&c.competenciaCodigo===month);}
  async function ready(month:string){
   let first: {tc:Context;rc:Context;position:string;version:number}|undefined;
   const cams=await contexts(clients.cam,'cam',month);
   for(const side of ['', 'south']){
    const technical=clients[side?'southTechnical':'technical'];const reviewer=clients[side?'southReviewer':'reviewer'];
    const reviewers=await contexts(reviewer,'revisor_tecnico',month);
    for(const tc of await contexts(technical,'area_tecnica',month)){
     const position=(await rpc(technical,'get_operational_positions',{p_contexto:commandContext(tc),p_filters:{page:1,pageSize:25}})).items[0];
     const saved=await command(technical,'save_position_draft',tc,{p_position_id:position.id,p_expected_version:position.version,p_input:{estadoDado:'valor',valor:'10',fonte:'Synthetic concurrency',periodoFonte:'2026-10-01',motivo:''}});
     const sent=await command(technical,'submit_position',tc,{p_position_id:position.id,p_expected_version:saved.version});
     const rc=reviewers.find(c=>c.escopoId===tc.escopoId)!;
     const claim=await command(reviewer,'start_position_review',rc,{p_position_id:position.id,p_expected_version:sent.version});
     const accepted=await command(reviewer,'review_position',rc,{p_position_id:position.id,p_expected_version:claim.version,p_decision:'accept',p_reason:'Independent race evidence'});
     if(!side&&!first)first={tc,rc,position:position.id,version:accepted.version};
    }
   }
   const cc=cams.find(c=>c.escopoId===first!.tc.escopoId)!;
   let checklist=await rpc(clients.cam,'get_cycle_checklist',{p_contexto:commandContext(cc)});
   await command(clients.cam,'transition_cycle',cc,{p_expected_version:checklist.version,p_action:'consolidate',p_reason:'',p_reference:''});
   checklist=await rpc(clients.cam,'get_cycle_checklist',{p_contexto:commandContext(cc)});
   return{...first!,cc,checklist};
  }
  a=new Connection(target);b=new Connection(target);
  const pid=(await b.query('select pg_backend_pid();')).trim();
  await b.query(`create function pg_temp.capture(q text) returns text language plpgsql as $$begin execute q;return 'ok';exception when others then return sqlstate;end;$$;`);
  const first=await ready(academicMonths[0].codigo);
  await a.query(`begin;select id from public.competencias where id=${literal(first.cc.competenciaId)}::uuid for update;`);
  await b.query(authenticate(first.tc));
  const correct=`select public.correct_position(${literal(JSON.stringify(commandContext(first.tc)))}::jsonb,${literal(first.position)}::uuid,${first.version},'{"estadoDado":"valor","valor":"12","fonte":"Concurrent correction","periodoFonte":"2026-10-01","motivo":"Race"}'::jsonb,${literal(randomUUID())}::uuid)`;
  const loser=b.query(`select pg_temp.capture(${literal(correct)});`);
  await blockedBy(a,pid);
  await a.query(`${authenticate(first.cc)}${transition(first.cc,first.checklist.version,'close')};commit;reset role;`);
  if(await loser!=='55000')throw Error('Owned concurrency close-first did not reject correction');
  if(await a.query(`select count(*)=6 and count(distinct i.posicao_id)=6 and bool_and(i.revisao_id=e.revisao_atual_id) from public.itens_fechamento i join public.fechamentos f on f.id=i.fechamento_id join public.entradas e on e.posicao_id=i.posicao_id where f.competencia_id=${literal(first.cc.competenciaId)}::uuid;`)!=='t')throw Error('Owned concurrency snapshot mixed revisions');
  process.stdout.write('Concurrency close-first: observed two-connection wait; correction rejected; six immutable exact revisions.\n');
  await b.query('reset role;');
  const second=await ready(academicMonths[1].codigo);
  await a.query(`begin;select id from public.competencias where id=${literal(second.cc.competenciaId)}::uuid for update;`);
  await b.query(authenticate(second.cc));
  const staleClose=b.query(`select pg_temp.capture(${literal(transition(second.cc,second.checklist.version,'close'))});`);
  await blockedBy(a,pid);
  await a.query(`${authenticate(second.cc)}${transition(second.cc,second.checklist.version,'reopen')};select public.authorize_position_correction(${literal(JSON.stringify(commandContext(second.cc)))}::jsonb,${literal(second.position)}::uuid,${second.version},'Race rectification',${literal(randomUUID())}::uuid);reset role;${authenticate(second.tc)}select public.correct_position(${literal(JSON.stringify(commandContext(second.tc)))}::jsonb,${literal(second.position)}::uuid,${second.version+1},'{"estadoDado":"valor","valor":"12","fonte":"Concurrent correction","periodoFonte":"2026-10-01","motivo":"Race"}'::jsonb,${literal(randomUUID())}::uuid);commit;reset role;`);
  if(await staleClose!=='40001')throw Error('Owned concurrency correction-first did not invalidate close version');
  if(await a.query(`select count(*) from public.fechamentos where competencia_id=${literal(second.cc.competenciaId)}::uuid;`)!=='0')throw Error('Owned concurrency stale close created snapshot');
  const claim=await command(clients.reviewer,'start_position_review',second.rc,{p_position_id:second.position,p_expected_version:second.version+2});
  await command(clients.reviewer,'review_position',second.rc,{p_position_id:second.position,p_expected_version:claim.version,p_decision:'accept',p_reason:'Independently reviewed corrected race revision'});
  let checklist=await rpc(clients.cam,'get_cycle_checklist',{p_contexto:commandContext(second.cc)});
  await command(clients.cam,'transition_cycle',second.cc,{p_expected_version:checklist.version,p_action:'consolidate',p_reason:'',p_reference:''});
  checklist=await rpc(clients.cam,'get_cycle_checklist',{p_contexto:commandContext(second.cc)});
  await command(clients.cam,'transition_cycle',second.cc,{p_expected_version:checklist.version,p_action:'close',p_reason:'Race completed',p_reference:'DEMO-DECISAO-RACE-2'});
  if(await a.query(`select trim_scale(valor_resultado)::text from public.itens_fechamento where posicao_id=${literal(second.position)}::uuid;`)!=='9.6')throw Error('Owned concurrency correction lost');
  process.stdout.write('Concurrency correction-first: CAM reopen/authorization + real correction under lock; stale close rejected; newly reviewed 9.6 frozen.\n');
  if(afterClosed){
   // Both months are closed and coverage is still complete: publish the first
   // through the real command, then let the caller repeat the bootstrap (I4).
   const firstClosed=await rpc(clients.cam,'get_cycle_checklist',{p_contexto:commandContext(first.cc)});
   await command(clients.cam,'publish_cycle_demo',first.cc,{p_snapshot_id:firstClosed.snapshotId,p_reference:'DEMO-PUBLICACAO-BOOTSTRAP'});
   await afterClosed();
  }
  const cached=JSON.parse(await a.query(`select jsonb_build_object('id',operation_id,'payload',payload) from public.operacoes_dominio where ator_id=${literal(second.cc.actorId)}::uuid and comando='transition_cycle' and payload->>'action'='close' and payload->'context'->>'competenciaId'=${literal(second.cc.competenciaId)};`)) as {id:string;payload:{context:unknown;expectedVersion:number;action:string;reason:string;reference:string}};
  // T11: a completed audited read is not a permission cache. A third real
  // connection waits alongside the original T09 close replay, under the same
  // observed lock barrier and one permanent revocation in this owned project.
  const closed=await rpc(clients.cam,'get_cycle_checklist',{p_contexto:commandContext(second.cc)});
  const exportId=randomUUID();
  await rpc(clients.cam,'get_snapshot_export',{p_contexto:commandContext(second.cc),p_snapshot_id:closed.snapshotId,p_operation_id:exportId});
  exportConnection=new Connection(target);
  const exportPid=await exportConnection.query('select pg_backend_pid();');
  await exportConnection.query(`create function pg_temp.capture(q text) returns text language plpgsql as $$begin execute q;return 'ok';exception when others then return sqlstate;end;$$;${authenticate(second.cc)}`);
  await a.query(`begin;select id from public.competencias where id=${literal(second.cc.competenciaId)}::uuid for update;`);
  const p=cached.payload;
  const replay=`select public.transition_cycle(${literal(JSON.stringify(p.context))}::jsonb,${p.expectedVersion},${literal(p.action)},${literal(p.reason)},${literal(p.reference)},${literal(cached.id)}::uuid)`;
  const revokedReplay=b.query(`select pg_temp.capture(${literal(replay)});`);
  const exportReplay=`select public.get_snapshot_export(${literal(JSON.stringify(commandContext(second.cc)))}::jsonb,${literal(closed.snapshotId)}::uuid,${literal(exportId)}::uuid)`;
  const revokedExport=exportConnection.query(`select pg_temp.capture(${literal(exportReplay)});`);
  await blockedBy(a,pid);
  await blockedBy(a,exportPid,pid);
  // Revoke a different explicit link of the same (model-2) indicator while the
  // selected context remains present; DEMO-v1 links do not cover this cycle.
  // No permission restoration/reset follows; this owned project is now disposed.
  await a.query(`update public.vinculos set ativo=false where id=(select id from public.vinculos where actor_id=${literal(second.cc.actorId)}::uuid and papel='cam' and indicador_id=${literal(second.cc.indicadorId)}::uuid and id<>${literal(second.cc.vinculoId)}::uuid order by id limit 1);commit;`);
  if(await revokedReplay!=='42501')throw Error('Owned concurrency replay ignored post-lock access revocation');
  if(await revokedExport!=='42501')throw Error('Owned concurrency export replay ignored post-lock access revocation');
  process.stdout.write('Concurrency revocation-before-replay: observed lock wait; lost explicit coverage rejected cached close without disclosing receipt.\n');
  process.stdout.write('Concurrency export-revocation-before-replay: third real connection observed waiting on lock; lost explicit coverage rejected cached export without disclosing bundle.\n');
 }finally{
  await Promise.all([a?.close(),b?.close(),exportConnection?.close()]);
  for(const client of Object.values(clients))await client.auth.signOut();
 }
}
