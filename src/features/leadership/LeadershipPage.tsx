import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthorizedContext } from '../pilot/types';
import type { AggregateRow } from '../pilot/types';
import { useEffect,useState } from 'react';
import { toCommandContext } from '../context/contextApi';
import { loadLeadershipAggregates } from './leadershipApi';
type Props={client:SupabaseClient;context:AuthorizedContext};
export function LeadershipPage(props:Props){return <ContextLeadership key={props.context.key} {...props}/>;}
function ContextLeadership({client,context}:Props){
 const [rows,setRows]=useState<AggregateRow[]|null>(null);const [error,setError]=useState(false);const [retry,setRetry]=useState(0);
 useEffect(()=>{let current=true;setRows(null);setError(false);void loadLeadershipAggregates(client,toCommandContext(context)).then(value=>{if(current)setRows(value);}).catch(()=>{if(current)setError(true);});return()=>{current=false;};},[client,context,retry]);
 return <section aria-label="Agregados publicados"><h2>Agregados de unidades publicadas</h2><p>Soma de controle não financeira. Não representa gratificação nem avaliação própria distrital. Indisponíveis não entram como zero.</p>
 {error?<p role="alert">Não foi possível confirmar os agregados autorizados.</p>:rows===null?<p role="status">Carregando agregados…</p>:rows.length===0?<p>Nenhum resultado de unidade publicado neste território.</p>:<ul>{rows.map(row=><li key={`${row.competencia}:${row.distritoCodigo}`}><h3>{row.distritoCodigo} · {row.competencia}</h3><p>Calculáveis: {row.calculableUnits} de {row.publishedUnits} unidades publicadas</p><p>Soma de controle: {row.resultSum??'Sem resultado numérico'} · {row.unidadeMedida}</p></li>)}</ul>}
 <button type="button" onClick={()=>setRetry(n=>n+1)}>Atualizar agregados</button></section>;
}
