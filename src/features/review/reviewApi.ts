import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, CommandReceipt } from '../pilot/types';
import { DomainCommandError, runCommand } from '../pilot/commandApi';
function checked(receipt:CommandReceipt,positionId:string,status:string):CommandReceipt {
 if(receipt.resourceId!==positionId||!receipt.revisionId||receipt.status!==status)throw new DomainCommandError('invalid_input');
 return receipt;
}
export async function startReview(client:SupabaseClient,context:CommandContext,positionId:string,expectedVersion:number,operationId:string):Promise<CommandReceipt> {
 return checked(await runCommand<CommandReceipt>(client,'start_position_review',context,{p_position_id:positionId,p_expected_version:expectedVersion},operationId),positionId,'em_revisao');
}
export async function reviewPosition(client:SupabaseClient,context:CommandContext,positionId:string,expectedVersion:number,decision:'accept'|'return',reason:string,operationId:string):Promise<CommandReceipt> {
 return checked(await runCommand<CommandReceipt>(client,'review_position',context,{p_position_id:positionId,p_expected_version:expectedVersion,p_decision:decision,p_reason:reason.trim()},operationId),positionId,decision==='accept'?'validada':'devolvida');
}
