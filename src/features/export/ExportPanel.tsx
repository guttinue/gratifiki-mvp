import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import type { AuthorizedContext, CycleChecklist } from '../pilot/types';
import { toCommandContext } from '../context/contextApi';
import { DomainCommandError } from '../pilot/commandApi';
import { requestSnapshotExport } from './exportApi';
import { serializeExportCsv, serializeExportManifest } from './exportCsv';
import { useNavigationDraft } from '../workspace/NavigationSafety';
type Format='csv'|'json';
type Pending={id:string;snapshotId:string;format:Format};
export function ExportPanel({client,context,checklist}:{client:SupabaseClient;context:AuthorizedContext;checklist:CycleChecklist}){
 const [pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null);
 const active=useRef(true),inFlight=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useNavigationDraft(busy||!!pending);
 const available=context.role==='cam'&&checklist.state==='fechada'&&checklist.fullCoverage&&!!checklist.snapshotId;
 async function download(format:Format){
  if(inFlight.current||!available||!checklist.snapshotId)return;
  const operation=pending??{id:crypto.randomUUID(),snapshotId:checklist.snapshotId,format};
  inFlight.current=true;setPending(operation);setBusy(true);setError(null);setMessage(null);
  try{
   // Even a second file request goes to the server. No prepared bundle is an
   // authorization cache and no public URL/bucket is involved.
   const bundle=await requestSnapshotExport(client,toCommandContext(context),operation.snapshotId,operation.id);
   if(!active.current)return;
   const content=operation.format==='csv'?serializeExportCsv(bundle):serializeExportManifest(bundle);
   const blob=new Blob([content],{type:operation.format==='csv'?'text/csv;charset=utf-8':'application/json;charset=utf-8'});
   const url=URL.createObjectURL(blob);const anchor=document.createElement('a');
   anchor.href=url;anchor.download=`gratifiki-demo-${bundle.snapshotId}-p${bundle.manifest.publicationVersion}.${operation.format}`;
   document.body.append(anchor);anchor.click();anchor.remove();
   setTimeout(()=>URL.revokeObjectURL(url),0);
   setPending(null);setMessage(`Arquivo ${operation.format.toUpperCase()} solicitado: demonstração acadêmica, publicação versão ${bundle.manifest.publicationVersion}.`);
  }catch(cause){if(active.current){if(cause instanceof DomainCommandError&&cause.confirmedRejected&&cause.code!=='access_denied')setPending(null);setError(cause instanceof Error?cause.message:'Não foi possível confirmar a exportação.');}}
  finally{inFlight.current=false;if(active.current)setBusy(false);}
 }
 return <section aria-label="Exportação CAM"><h3>Exportação de demonstração</h3>
  <p>Dados sintéticos; somas são controles numéricos, não gratificação. Baixar não envia para SEI ou folha.</p>
  {!available&&<p>Requer snapshot fechado com cobertura CAM integral. Atualize o ciclo para conferir o estado persistido.</p>}
  <button type="button" disabled={!available||busy||!!pending} onClick={()=>void download('csv')}>Baixar CSV</button>
  <button type="button" disabled={!available||busy||!!pending} onClick={()=>void download('json')}>Baixar manifesto JSON</button>
  {pending&&!busy&&<button type="button" disabled={!available} onClick={()=>void download(pending.format)}>Repetir exportação pendente</button>}
  {busy&&<p role="status">Conferindo acesso e snapshot…</p>}{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
