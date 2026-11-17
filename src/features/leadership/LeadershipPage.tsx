import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthorizedContext } from '../pilot/types';
import type { AggregateRow, LeadershipOverview } from '../pilot/types';
import { useEffect,useState } from 'react';
import { toCommandContext } from '../context/contextApi';
import { formatDecimal } from '../pilot/decimal';
import { competenceStateLabels, plural, scopeName, stateTones } from '../workspace/displayNames';
import { StageTiles, TodoList, UnitCard } from '../workspace/v4Parts';
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
 const state=context.competenciaEstado;
 return <section aria-label="Visão agregada" className="v3-page">
 {error?<p role="alert">Não foi possível confirmar os agregados autorizados.</p>:!data?<p role="status">Carregando agregados…</p>:<>
  {/* LI-01: no "Distritos com pendência" (attention has no district, spec §5.2); the completes are the server's per-district counts summed. */}
  <StageTiles label="Resumo agregado" tiles={[
   {label:'Entradas aceitas',value:floorPercent(data.acceptedPercent),sub:'das entradas da competência',tone:'ok'},
   ...(state?[{label:'Etapa do ciclo',value:competenceStateLabels[state],sub:'competência atual',tone:stateTones[state],text:true}]:[]),
   {label:'Unidades com pendência',value:data.attention.length,sub:data.attention.length?'veja onde agir':'nenhuma',tone:'warn' as const},
   {label:'Unidades completas',value:`${data.districts.reduce((n,d)=>n+d.completeUnits,0)} de ${data.districts.reduce((n,d)=>n+d.totalUnits,0)}`,sub:'com todos os indicadores aceitos',tone:'info' as const}]}/>
  <div className="stack">
   <TodoList title="Onde agir" empty={<strong>Nenhuma pendência.</strong>} items={data.attention.map(unit=>({tone:'warn',title:`${scopeName(unit.unitCode)}: ${plural(unit.pending,'entrada pendente','entradas pendentes')}.`,sub:'Converse com a gestão distrital antes do fechamento.'}))}/>
   {/* LI-03: cards without "vs. setembro" (the overview has no previous month, spec §5.2). */}
   <section className="block" aria-label="Médias por distrito"><div className="block-head"><h3>Média por distrito</h3></div><div className="cards">
    {data.districts.map(district=><UnitCard key={district.districtCode} title={scopeName(district.districtCode)} sub={`${district.completeUnits} de ${district.totalUnits} unidades completas`}
     badge={state&&<span className={`v3-badge t-${stateTones[state]}`}>{competenceStateLabels[state]}</span>}
     big={<>{district.average===null?'–':formatDecimal(district.average,2)} <small>/ 100</small></>} foot={district.average===null?'Aguardando unidades completas':undefined}/>)}
   </div>
   <p className="v3-note">{`Média só de unidades com todos os indicadores aceitos. ${absenceCopy[data.mode]}`}</p></section>
  </div></>}
 <button type="button" onClick={()=>setRetry(n=>n+1)}>Atualizar agregados</button></section>;
}
function ContextLeadership({client,context}:Props){
 const [rows,setRows]=useState<AggregateRow[]|null>(null);const [error,setError]=useState(false);const [retry,setRetry]=useState(0);
 useEffect(()=>{let current=true;setRows(null);setError(false);void loadLeadershipAggregates(client,toCommandContext(context)).then(value=>{if(current)setRows(value);}).catch(()=>{if(current)setError(true);});return()=>{current=false;};},[client,context,retry]);
 return <section aria-label="Agregados publicados"><h2>Agregados de unidades publicadas</h2><p>Soma de controle não financeira. Não representa gratificação nem avaliação própria distrital. Indisponíveis não entram como zero.</p>
 {error?<p role="alert">Não foi possível confirmar os agregados autorizados.</p>:rows===null?<p role="status">Carregando agregados…</p>:rows.length===0?<p>Nenhum resultado de unidade publicado neste território.</p>:<ul>{rows.map(row=><li key={`${row.competencia}:${row.distritoCodigo}`}><h3>{row.distritoCodigo} · {row.competencia}</h3><p>Calculáveis: {row.calculableUnits} de {row.publishedUnits} unidades publicadas</p><p>Soma de controle: {row.resultSum??'Sem resultado numérico'} · {row.unidadeMedida}</p></li>)}</ul>}
 <button type="button" onClick={()=>setRetry(n=>n+1)}>Atualizar agregados</button></section>;
}
