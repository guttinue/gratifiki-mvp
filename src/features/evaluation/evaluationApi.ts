import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, EvaluationItem,Page,PositionFilter } from '../pilot/types';
import { readRpc,readPage,readObject,readText,readDecimal,readInteger,readNullableText } from '../workspace/academicDashboardApi';
import { DomainCommandError } from '../pilot/commandApi';
export type EvaluationRecord=EvaluationItem & {factor:string|null;unidadeMedida:string};
export async function loadEvaluations(client:SupabaseClient,context:CommandContext,view:'own'|'territory',filters:PositionFilter):Promise<Page<EvaluationRecord>>{
 return readPage(await readRpc(client,'get_my_evaluations',context,{p_view:view,p_filters:filters}),value=>{
  const r=readObject(value);const kind=readText(r.escopoTipo),state=readText(r.estadoDado),publication=readText(r.publication);
  if(!['unidade','distrito'].includes(kind)||!['valor','indisponivel','nao_aplicavel'].includes(state)||!['preliminar','publicada_demo'].includes(publication))throw new DomainCommandError('invalid_input');
  const row:EvaluationRecord={id:readText(r.id),escopoId:readText(r.escopoId),escopoCodigo:readText(r.escopoCodigo),escopoTipo:kind as EvaluationRecord['escopoTipo'],estadoDado:state as EvaluationRecord['estadoDado'],inputValue:readDecimal(r.inputValue),resultValue:readDecimal(r.resultValue),ruleVersion:readInteger(r.ruleVersion,1),publication:publication as EvaluationRecord['publication'],snapshotId:readNullableText(r.snapshotId),factor:readDecimal(r.factor),unidadeMedida:readText(r.unidadeMedida)};
  if((row.publication==='publicada_demo')!==(row.snapshotId!==null)||(state==='valor'?(row.inputValue===null||row.resultValue===null||row.factor===null):(row.inputValue!==null||row.resultValue!==null||row.factor!==null)))throw new DomainCommandError('invalid_input');return row;
 });
}
