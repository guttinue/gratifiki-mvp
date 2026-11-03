import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, AggregateRow, LeadershipOverview } from '../pilot/types';
import { readRpc,readArray,readObject,readText,readInteger,readDecimal } from '../workspace/academicDashboardApi';
import { DomainCommandError } from '../pilot/commandApi';
import { readExact,readFixed2 } from '../results/resultsApi';
export async function loadLeadershipAggregates(client:SupabaseClient,context:CommandContext):Promise<AggregateRow[]>{
 return readArray(await readRpc(client,'get_leadership_aggregates',context),value=>{const r=readObject(value);const row={competencia:readText(r.competencia),distritoCodigo:readText(r.distritoCodigo),unidadeMedida:readText(r.unidadeMedida),publishedUnits:readInteger(r.publishedUnits),calculableUnits:readInteger(r.calculableUnits),resultSum:readDecimal(r.resultSum)};
 if(row.calculableUnits>row.publishedUnits||(row.calculableUnits===0)!==(row.resultSum===null))throw new DomainCommandError('invalid_input');return row;});
}
// Model 3 answers one object (model 2 answers the published-aggregate array).
export function decodeLeadershipOverview(value:unknown):LeadershipOverview{
 const r=readExact(value,['acceptedPercent','districts','attention']);const acceptedPercent=readFixed2(r.acceptedPercent);
 const districts=readArray(r.districts,v=>{const d=readExact(v,['districtCode','average','completeUnits','totalUnits']);
  const row={districtCode:readText(d.districtCode),average:d.average===null?null:readFixed2(d.average),completeUnits:readInteger(d.completeUnits),totalUnits:readInteger(d.totalUnits,1)};
  if(row.completeUnits>row.totalUnits||(row.completeUnits===0&&row.average!==null))throw new DomainCommandError('invalid_input');return row;});
 const attention=readArray(r.attention,v=>{const a=readExact(v,['unitCode','pending']);return{unitCode:readText(a.unitCode),pending:readInteger(a.pending,1)};});
 if(!districts.length||new Set(districts.map(d=>d.districtCode)).size!==districts.length||new Set(attention.map(a=>a.unitCode)).size!==attention.length||(attention.length===0&&acceptedPercent!=='100.00'))throw new DomainCommandError('invalid_input');
 return{acceptedPercent,districts,attention};
}
export async function loadLeadershipOverview(client:SupabaseClient,context:CommandContext):Promise<LeadershipOverview>{
 return decodeLeadershipOverview(await readRpc(client,'get_leadership_aggregates',context));
}
