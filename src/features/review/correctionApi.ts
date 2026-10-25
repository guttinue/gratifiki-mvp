import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, CommandReceipt, DraftInput } from '../pilot/types';
import { DomainCommandError, runCommand } from '../pilot/commandApi';
import { normalizeDraftInput } from '../submission/positionApi';
function checked(receipt:CommandReceipt,positionId:string,status:string):CommandReceipt {
 if(receipt.resourceId!==positionId||!receipt.revisionId||receipt.status!==status)throw new DomainCommandError('invalid_input');
 return receipt;
}
export async function correctPosition(client:SupabaseClient,context:CommandContext,positionId:string,expectedVersion:number,input:DraftInput,operationId:string):Promise<CommandReceipt> {
 return checked(await runCommand<CommandReceipt>(client,'correct_position',context,{p_position_id:positionId,p_expected_version:expectedVersion,p_input:normalizeDraftInput(input)},operationId),positionId,'enviada');
}
export async function authorizeCorrection(client:SupabaseClient,context:CommandContext,positionId:string,expectedVersion:number,reason:string,operationId:string):Promise<CommandReceipt> {
 return checked(await runCommand<CommandReceipt>(client,'authorize_position_correction',context,{p_position_id:positionId,p_expected_version:expectedVersion,p_reason:reason.trim()},operationId),positionId,'devolvida');
}
export async function decideUnavailability(client:SupabaseClient,context:CommandContext,positionId:string,expectedVersion:number,reference:string,reason:string,operationId:string):Promise<CommandReceipt> {
 const receipt=checked(await runCommand<CommandReceipt>(client,'decide_unavailability',context,{p_position_id:positionId,p_expected_version:expectedVersion,p_reference:reference.trim(),p_reason:reason.trim()},operationId),positionId,'validada');
 if(receipt.resultValue!==null)throw new DomainCommandError('invalid_input');
 return receipt;
}
