import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, AuditItem,Page,PositionFilter } from '../pilot/types';
import { readRpc,readPage,readObject,readText,readInteger,readNullableText } from '../workspace/academicDashboardApi';
export async function loadAudit(client:SupabaseClient,context:CommandContext,filters:PositionFilter):Promise<Page<AuditItem>>{
 // CAM-04: drafts are saved with an empty reason; that is "no reason", not a bad response.
 return readPage(await readRpc(client,'get_scoped_audit',context,{p_filters:filters}),value=>{const r=readObject(value);return{id:readText(r.id),occurredAt:readText(r.occurredAt),action:readText(r.action),resourceId:readText(r.resourceId),version:r.version===null?null:readInteger(r.version,1),reason:r.reason===''?null:readNullableText(r.reason)};});
}
// One page per context of a model-3 view: each event once, newest first.
export function mergeAuditPages(pages:readonly Page<AuditItem>[]):{items:AuditItem[];truncated:boolean}{
 const items=[...new Map(pages.flatMap(p=>p.items).map(item=>[item.id,item])).values()]
  .sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt)||(a.id<b.id?1:a.id>b.id?-1:0));
 return {items,truncated:pages.some(p=>p.total>p.items.length)};
}
