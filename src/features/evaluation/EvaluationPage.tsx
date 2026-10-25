import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthorizedContext } from '../pilot/types';
import { useEffect,useState } from 'react';
import { toCommandContext } from '../context/contextApi';
import { loadEvaluations,type EvaluationRecord } from './evaluationApi';
type Props={client:SupabaseClient;context:AuthorizedContext};
export function EvaluationPage(props:Props){return <ContextEvaluations key={props.context.key} {...props}/>;}
function ContextEvaluations({client,context}:Props){
 const [view,setView]=useState<'own'|'territory'>('own');const [page,setPage]=useState(1);const [search,setSearch]=useState('');const [query,setQuery]=useState('');const [status,setStatus]=useState('');
 const [data,setData]=useState<{items:EvaluationRecord[];total:number}|null>(null);const [error,setError]=useState(false);const [retry,setRetry]=useState(0);
 useEffect(()=>{let current=true;setData(null);setError(false);
  void loadEvaluations(client,toCommandContext(context),view,{page,pageSize:25,...(query?{search:query}:{}),...(status?{status}:{})}).then(value=>{if(current)setData(value);}).catch(()=>{if(current)setError(true);});return()=>{current=false;};
 },[client,context,view,page,query,status,retry]);
 return <section aria-label="Avaliações autorizadas"><h2>Avaliações autorizadas</h2><p>Competência: {context.competenciaCodigo}</p>
  <nav aria-label="Visões de avaliação"><button type="button" aria-pressed={view==='own'} onClick={()=>{setView('own');setPage(1);}}>Avaliação própria</button>
  {context.role==='gestor_distrital'&&<button type="button" aria-pressed={view==='territory'} onClick={()=>{setView('territory');setPage(1);}}>Unidades do território</button>}</nav>
  {view==='territory'&&<p>Resultados das unidades são separados da avaliação própria do distrito. Não representam sua soma ou gratificação.</p>}
  <form onSubmit={e=>{e.preventDefault();setQuery(search);setPage(1);}}><label>Buscar alvo<input value={search} onChange={e=>setSearch(e.target.value)}/></label><button type="submit">Buscar avaliações</button></form>
  <label>Publicação<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">Todas</option><option value="preliminar">Preliminar</option><option value="publicada_demo">Publicada na demonstração</option></select></label>
  <p>Comparação histórica somente para o mesmo indicador, alvo, unidade e versão de regra. Versões de regra diferentes: resultados não comparáveis.</p>
  {error?<p role="alert">Não foi possível confirmar as avaliações autorizadas.</p>:!data?<p role="status">Carregando avaliações…</p>:<>
   <p>Total autorizado no filtro: {data.total}</p>{!data.items.length&&<p>Nenhuma avaliação tecnicamente validada disponível neste filtro.</p>}
   <ul>{data.items.map(row=><li key={row.id}><h3>{row.escopoCodigo}</h3><p>{row.publication==='preliminar'?'Preliminar · não publicada':'Publicada na demonstração'} · Regra v{row.ruleVersion} · {row.unidadeMedida}</p>
    <p>{row.estadoDado==='valor'?`${row.inputValue} × ${row.factor} = ${row.resultValue}`:row.estadoDado==='indisponivel'?'Indisponível · sem resultado numérico':'Não aplicável · sem resultado numérico'}</p>
    {row.snapshotId&&<p>Snapshot: {row.snapshotId}</p>}</li>)}</ul>
   <button type="button" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Avaliações anteriores</button><span> Página {page} </span><button type="button" disabled={page*25>=data.total} onClick={()=>setPage(p=>p+1)}>Próximas avaliações</button>
  </>}
  <button type="button" onClick={()=>setRetry(n=>n+1)}>Atualizar avaliações</button>
 </section>;
}
