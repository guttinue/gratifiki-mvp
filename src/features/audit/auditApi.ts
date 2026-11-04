import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, AuditItem,Page,PositionFilter } from '../pilot/types';
import { readRpc,readPage,readObject,readText,readInteger,readNullableText } from '../workspace/academicDashboardApi';
export async function loadAudit(client:SupabaseClient,context:CommandContext,filters:PositionFilter):Promise<Page<AuditItem>>{
 // CAM-04: review and rectification commands btrim the reason, so an acceptance without one is ''; that is "no reason".
 return readPage(await readRpc(client,'get_scoped_audit',context,{p_filters:filters}),value=>{const r=readObject(value);return{id:readText(r.id),occurredAt:readText(r.occurredAt),action:readText(r.action),resourceId:readText(r.resourceId),version:r.version===null?null:readInteger(r.version,1),reason:r.reason===''?null:readNullableText(r.reason)};});
}
// get_scoped_audit pages oldest first (order by ocorrido_em,id), so a context's newest
// 100 events sit on its last one or two pages; total keeps the server count.
export async function loadNewestAudit(client:SupabaseClient,context:CommandContext,filters:Omit<PositionFilter,'page'|'pageSize'>):Promise<Page<AuditItem>>{
 const first=await loadAudit(client,context,{...filters,page:1,pageSize:100});
 const last=Math.ceil(first.total/100);
 if(last<=1)return first;
 const tail=await Promise.all([last-1,last].filter(page=>page>1).map(page=>loadAudit(client,context,{...filters,page,pageSize:100})));
 return {...first,items:mergeAuditPages([first,...tail]).items.slice(0,100)};
}
// One page per context of a model-3 view: each event once, newest first.
export function mergeAuditPages(pages:readonly Page<AuditItem>[]):{items:AuditItem[];truncated:boolean}{
 const items=[...new Map(pages.flatMap(p=>p.items).map(item=>[item.id,item])).values()]
  .sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt)||(a.id<b.id?1:a.id>b.id?-1:0));
 return {items,truncated:pages.some(p=>p.total>p.items.length)};
}
