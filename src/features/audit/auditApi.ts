import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, AuditItem,ContextGroup,Page,PositionFilter } from '../pilot/types';
import { toCommandContext } from '../context/contextApi';
import { loadGroupPositions } from '../batch/groupPositions';
import { scopeName } from '../workspace/displayNames';
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
// Only these roles have operational_read; for the others a position read would be refused (42501).
const namesTargets = new Set(['area_tecnica', 'revisor_tecnico', 'cam']);
// §4.7: get_scoped_audit answers per context, so a model-3 view reads each one's newest 100 and merges them.
export async function loadGroupAudit(client:SupabaseClient,group:ContextGroup):Promise<{items:AuditItem[];truncated:boolean;targets:Map<string,string>}>{
 const [pages,positions]=await Promise.all([
  Promise.all(group.contexts.map(c=>loadNewestAudit(client,toCommandContext(c),{}))),
  namesTargets.has(group.role)?loadGroupPositions(client,group):[],
 ]);
 const targets=new Map(positions.map(({position:p})=>[p.id,[scopeName(p.escopoCodigo),p.indicatorCode].filter(Boolean).join(' · ')]));
 const merged=mergeAuditPages(pages);
 // A cut context lacks events before its oldest shown one; drop the others' older ones so no gap stays hidden.
 const cutoff=Math.max(...pages.filter(p=>p.items.length&&p.total>p.items.length).map(p=>Math.min(...p.items.map(i=>Date.parse(i.occurredAt)))));
 return {...merged,items:merged.items.filter(i=>Date.parse(i.occurredAt)>=cutoff),targets};
}
const recifeDay=new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'2-digit',timeZone:'America/Recife'});
// "Hoje · terça, 17/11" or "segunda, 16/11" (HI-01).
export function auditDay(occurredAt:string,now:Date):string{
 const date=new Date(occurredAt);
 if(!Number.isFinite(date.getTime()))return 'Data indisponível';
 const day=recifeDay.format(date).replace('-feira','');
 return day===recifeDay.format(now).replace('-feira','')?`Hoje · ${day}`:day;
}
const recifeHour=new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Recife'});
export function auditHour(occurredAt:string):string{
 const date=new Date(occurredAt);
 return Number.isFinite(date.getTime())?recifeHour.format(date):'--:--';
}
