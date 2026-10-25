import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, CommandReceipt, CycleChecklist } from '../pilot/types';
import { DomainCommandError, runCommand } from '../pilot/commandApi';
export async function loadCycleChecklist(client:SupabaseClient,context:CommandContext):Promise<CycleChecklist> {
 const {data,error}=await client.rpc('get_cycle_checklist',{p_contexto:{vinculoId:context.vinculoId,competenciaId:context.competenciaId,indicadorId:context.indicadorId}});
 if(error)throw new DomainCommandError(error.code==='42501'?'access_denied':'network_error');
 if(!data||typeof data!=='object'||Array.isArray(data))throw new DomainCommandError('invalid_input');
 const row=data as Record<string,unknown>;
 for(const key of ['version','expected','received','reviewed','unavailable','decidedUnavailable','notApplicable'])if(!Number.isSafeInteger(row[key])||(row[key] as number)<(key==='version'?1:0))throw new DomainCommandError('invalid_input');
 const textOrNull=(value:unknown)=>value===null||(typeof value==='string'&&!!value.trim());
 if(!['aberta','em_consolidacao','fechada'].includes(String(row.state))||!['nao_publicada','publicada_demo'].includes(String(row.publication))||
  !textOrNull(row.snapshotId)||!textOrNull(row.publicationId)||['canConsolidate','canClose','fullCoverage'].some(k=>typeof row[k]!=='boolean')||
  !Array.isArray(row.blockers)||row.blockers.some(b=>!b||typeof b!=='object'||!textOrNull(b.positionId)||typeof b.code!=='string'||!b.code||typeof b.message!=='string'||!b.message))throw new DomainCommandError('invalid_input');
 const r=row as unknown as CycleChecklist;
 if(r.received+r.notApplicable>r.expected||r.reviewed>r.received||r.unavailable>r.received||r.decidedUnavailable>r.unavailable||
  (!r.fullCoverage&&(r.snapshotId!==null||r.publicationId!==null||r.canClose||r.canConsolidate))||
  (r.snapshotId!==null&&r.state!=='fechada')||(r.publication==='publicada_demo'&&(!r.snapshotId||!r.publicationId))||
  (r.canClose&&(r.state!=='em_consolidacao'||r.blockers.length>0))||(r.canConsolidate&&r.state!=='aberta'))throw new DomainCommandError('invalid_input');
 return r;
}
function checked(receipt:CommandReceipt,status:string,resourceId?:string):CommandReceipt {
 if(receipt.status!==status||receipt.revisionId!==null||receipt.resultValue!==null||(resourceId&&receipt.resourceId!==resourceId))throw new DomainCommandError('invalid_input');return receipt;
}
export async function transitionCycle(client:SupabaseClient,context:CommandContext,expectedVersion:number,action:'consolidate'|'reopen'|'close',reason:string,reference:string,operationId:string):Promise<CommandReceipt> {
 return checked(await runCommand<CommandReceipt>(client,'transition_cycle',context,{p_expected_version:expectedVersion,p_action:action,p_reason:reason.trim(),p_reference:reference.trim()},operationId),action==='close'?'fechada':action==='reopen'?'aberta':'em_consolidacao',action==='close'?undefined:context.competenciaId);
}
export async function publishCycleDemo(client:SupabaseClient,context:CommandContext,snapshotId:string,reference:string,operationId:string):Promise<CommandReceipt> {
 return checked(await runCommand<CommandReceipt>(client,'publish_cycle_demo',context,{p_snapshot_id:snapshotId,p_reference:reference.trim()},operationId),'publicada_demo',snapshotId);
}
