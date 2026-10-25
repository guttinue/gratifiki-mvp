import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, CommandReceipt } from '../pilot/types';
import { DomainCommandError, runCommand } from '../pilot/commandApi';
export async function submitPosition(client:SupabaseClient,context:CommandContext,positionId:string,expectedVersion:number,operationId:string):Promise<CommandReceipt>{
 const receipt=await runCommand<CommandReceipt>(client,'submit_position',context,{p_position_id:positionId,p_expected_version:expectedVersion},operationId);
 if(receipt.resourceId!==positionId||!receipt.revisionId||receipt.status!=='enviada')throw new DomainCommandError('invalid_input');
 return receipt;
}
