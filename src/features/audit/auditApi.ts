import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, AuditItem,Page,PositionFilter } from '../pilot/types';
import { readRpc,readPage,readObject,readText,readInteger,readNullableText } from '../workspace/academicDashboardApi';
export async function loadAudit(client:SupabaseClient,context:CommandContext,filters:PositionFilter):Promise<Page<AuditItem>>{
 return readPage(await readRpc(client,'get_scoped_audit',context,{p_filters:filters}),value=>{const r=readObject(value);return{id:readText(r.id),occurredAt:readText(r.occurredAt),action:readText(r.action),resourceId:readText(r.resourceId),version:r.version===null?null:readInteger(r.version,1),reason:readNullableText(r.reason)};});
}
