import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthorizedContext } from '../pilot/types';
import type { AggregateRow, LeadershipOverview } from '../pilot/types';
import { useEffect,useState } from 'react';
import { toCommandContext } from '../context/contextApi';
import { formatDecimal } from '../pilot/decimal';
import { competenceStateLabels, scopeName } from '../workspace/displayNames';
import { absenceCopy } from '../results/CalculationExplainer';
import { loadLeadershipAggregates, loadLeadershipOverview } from './leadershipApi';
type Props={client:SupabaseClient;context:AuthorizedContext};
export function LeadershipPage(props:Props){return props.context.modelo===3?<ContextOverview key={props.context.key} {...props}/>:<ContextLeadership key={props.context.key} {...props}/>;}
// Model 3: situation of the cycle and district averages, never a person or an individual value.
// Whole percent rounded down: "100 %" only when every entry is accepted.
const floorPercent=(percent:string)=>`${percent.split('.')[0]} %`;
function ContextOverview({client,context}:Props){
 const [data,setData]=useState<LeadershipOverview|null>(null);const [error,setError]=useState(false);const [retry,setRetry]=useState(0);
 useEffect(()=>{let current=true;setData(null);setError(false);void loadLeadershipOverview(client,toCommandContext(context)).then(value=>{if(current)setData(value);}).catch(()=>{if(current)setError(true);});return()=>{current=false;};},[client,context,retry]);
 return <section aria-label="Visão agregada" className="v3-page">
 {error?<p role="alert">Não foi possível confirmar os agregados autorizados.</p>:!data?<p role="status">Carregando agregados…</p>:<>
  <div className="v3-metrics"><div className="v3-metric v3-metric-lead"><span className="v3-label" id="v3-accepted">Entradas aceitas</span><strong className="v3-score">{floorPercent(data.acceptedPercent)}</strong>
   <div role="progressbar" aria-labelledby="v3-accepted" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(data.acceptedPercent)} aria-valuetext={floorPercent(data.acceptedPercent)} className="v3-bar"><span style={{width:`${data.acceptedPercent}%`}}/></div></div>
   {context.competenciaEstado&&<p className="v3-metric">{`Etapa do ciclo: ${competenceStateLabels[context.competenciaEstado]}`}</p>}</div>
  <section aria-label="Onde agir" className="v3-panel">{data.attention.length===0?<p>Nenhuma pendência nas unidades.</p>:<><h3>Onde agir</h3><ul>{data.attention.map(unit=><li key={unit.unitCode}>{`${scopeName(unit.unitCode)}: ${unit.pending} ${unit.pending>1?'entradas pendentes':'entrada pendente'}.`}</li>)}</ul><p className="v3-note">Converse com a gestão distrital antes do fechamento.</p></>}</section>
  <div className="table-scroll"><table className="v3-table" aria-label="Médias por distrito"><thead><tr><th scope="col">Distrito</th><th scope="col" className="r">Unidades completas</th><th scope="col" className="r">Média das completas</th></tr></thead>
   <tbody>{data.districts.map(district=><tr key={district.districtCode}><td><strong>{scopeName(district.districtCode)}</strong></td><td className="r">{`${district.completeUnits} de ${district.totalUnits}`}</td>
    <td className="r">{district.average===null?<span className="v3-cell-sub">Aguardando unidades completas</span>:formatDecimal(district.average,2)}</td></tr>)}</tbody></table></div>
  <p className="v3-note">{`Média só de unidades com todos os indicadores aceitos. ${absenceCopy[data.mode]}`}</p></>}
 <button type="button" onClick={()=>setRetry(n=>n+1)}>Atualizar agregados</button></section>;
}
function ContextLeadership({client,context}:Props){
 const [rows,setRows]=useState<AggregateRow[]|null>(null);const [error,setError]=useState(false);const [retry,setRetry]=useState(0);
 useEffect(()=>{let current=true;setRows(null);setError(false);void loadLeadershipAggregates(client,toCommandContext(context)).then(value=>{if(current)setRows(value);}).catch(()=>{if(current)setError(true);});return()=>{current=false;};},[client,context,retry]);
 return <section aria-label="Agregados publicados"><h2>Agregados de unidades publicadas</h2><p>Soma de controle não financeira. Não representa gratificação nem avaliação própria distrital. Indisponíveis não entram como zero.</p>
 {error?<p role="alert">Não foi possível confirmar os agregados autorizados.</p>:rows===null?<p role="status">Carregando agregados…</p>:rows.length===0?<p>Nenhum resultado de unidade publicado neste território.</p>:<ul>{rows.map(row=><li key={`${row.competencia}:${row.distritoCodigo}`}><h3>{row.distritoCodigo} · {row.competencia}</h3><p>Calculáveis: {row.calculableUnits} de {row.publishedUnits} unidades publicadas</p><p>Soma de controle: {row.resultSum??'Sem resultado numérico'} · {row.unidadeMedida}</p></li>)}</ul>}
 <button type="button" onClick={()=>setRetry(n=>n+1)}>Atualizar agregados</button></section>;
}
