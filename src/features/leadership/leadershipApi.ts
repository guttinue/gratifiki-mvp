import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, AggregateRow } from '../pilot/types';
import { readRpc,readArray,readObject,readText,readInteger,readDecimal } from '../workspace/academicDashboardApi';
import { DomainCommandError } from '../pilot/commandApi';
export async function loadLeadershipAggregates(client:SupabaseClient,context:CommandContext):Promise<AggregateRow[]>{
 return readArray(await readRpc(client,'get_leadership_aggregates',context),value=>{const r=readObject(value);const row={competencia:readText(r.competencia),distritoCodigo:readText(r.distritoCodigo),unidadeMedida:readText(r.unidadeMedida),publishedUnits:readInteger(r.publishedUnits),calculableUnits:readInteger(r.calculableUnits),resultSum:readDecimal(r.resultSum)};
 if(row.calculableUnits>row.publishedUnits||(row.calculableUnits===0)!==(row.resultSum===null))throw new DomainCommandError('invalid_input');return row;});
}
