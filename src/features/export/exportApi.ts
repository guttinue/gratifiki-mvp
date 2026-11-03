import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, ExportBundle, ExportManifest, ExportRow, Model3ExportRow } from '../pilot/types';
import { DomainCommandError, runCommand } from '../pilot/commandApi';
function invalid():never{throw new DomainCommandError('invalid_input');}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))return invalid();return value as Record<string,unknown>;}
function string(value:unknown):string{if(typeof value!=='string'||!value.trim())return invalid();return value;}
function integer(value:unknown,min=0):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min)return invalid();return value;}
function decimal(value:unknown):string{if(typeof value!=='string'||!/^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/.test(value))return invalid();return value;}
function array(value:unknown):unknown[]{return Array.isArray(value)?value:invalid();}
const m3Keys=['snapshotId','competencia','indicador','alvoTipo','alvoCodigo','regraVersao','revisao','situacaoDado','valor','meta','peso','pesoEfetivo','pontos','conjunto','conjuntoVersao','sintetico','publicacao'];
function nullableDecimal(value:unknown):string|null{return value===null?null:decimal(value);}
// Model 3 (contract 2): exact keys; a value only when stated, points always on
// valued rows, and one synthetic rule set version for the whole snapshot.
function decodeModel3Row(value:unknown,snapshotId:string,competencia:string,publicacao:Model3ExportRow['publicacao']):Model3ExportRow{
 const r=object(value);if(Object.keys(r).length!==m3Keys.length||m3Keys.some(k=>!(k in r)))return invalid();
 const alvoTipo=string(r.alvoTipo),situacaoDado=string(r.situacaoDado);
 if(!['unidade','distrito'].includes(alvoTipo)||(situacaoDado!=='valor'&&situacaoDado!=='indisponivel'&&situacaoDado!=='nao_aplicavel')||r.snapshotId!==snapshotId||r.competencia!==competencia||r.publicacao!==publicacao||typeof r.sintetico!=='boolean')return invalid();
 const revisao=r.revisao===null?null:integer(r.revisao,1),valor=nullableDecimal(r.valor),pesoEfetivo=nullableDecimal(r.pesoEfetivo),pontos=nullableDecimal(r.pontos);
 if(situacaoDado==='valor'?(revisao===null||valor===null||pesoEfetivo===null||pontos===null):(valor!==null||(situacaoDado==='indisponivel'&&revisao===null)))return invalid();
 return {snapshotId,competencia,indicador:string(r.indicador),alvoTipo,alvoCodigo:string(r.alvoCodigo),regraVersao:integer(r.regraVersao,1),revisao,situacaoDado,valor,meta:decimal(r.meta),peso:decimal(r.peso),pesoEfetivo,pontos,conjunto:string(r.conjunto),conjuntoVersao:integer(r.conjuntoVersao,1),sintetico:r.sintetico,publicacao};
}
function decodeModel2Row(value:unknown,snapshotId:string,competencia:string,publicacao:ExportRow['publicacao']):ExportRow{
 const r=object(value);const alvoTipo=string(r.alvoTipo),estadoDado=string(r.estadoDado);
 if(!['unidade','distrito'].includes(alvoTipo)||!['valor','indisponivel','nao_aplicavel'].includes(estadoDado)||r.snapshotId!==snapshotId||r.competencia!==competencia||r.publicacao!==publicacao)return invalid();
 const revisao=r.revisao===null?null:integer(r.revisao,1);
 const entrada=r.entrada===null?null:decimal(r.entrada),fator=r.fator===null?null:decimal(r.fator),resultado=r.resultado===null?null:decimal(r.resultado);
 if(estadoDado==='valor'?(revisao===null||entrada===null||fator===null||resultado===null):(entrada!==null||fator!==null||resultado!==null||(estadoDado==='indisponivel'?revisao===null:revisao!==null)))return invalid();
 return {snapshotId,competencia,indicador:string(r.indicador),alvoTipo,alvoCodigo:string(r.alvoCodigo),regraVersao:integer(r.regraVersao,1),revisao,estadoDado,entrada,fator,resultado,publicacao};
}
// Counts and rule versions must describe exactly the decoded rows.
function decodeManifest(m:Record<string,unknown>,competencia:string,publicationVersion:0|1,rows:{regraVersao:number;state:string}[]):ExportManifest{
 const positionCount=integer(m.positionCount,1),calculableCount=integer(m.calculableCount),unavailableCount=integer(m.unavailableCount),notApplicableCount=integer(m.notApplicableCount);
 const ruleVersions=array(m.ruleVersions).map(v=>integer(v,1));
 if(positionCount!==rows.length||calculableCount!==rows.filter(r=>r.state==='valor').length||unavailableCount!==rows.filter(r=>r.state==='indisponivel').length||notApplicableCount!==rows.filter(r=>r.state==='nao_aplicavel').length||new Set(ruleVersions).size!==ruleVersions.length||rows.some(r=>!ruleVersions.includes(r.regraVersao))||ruleVersions.some(v=>!rows.some(r=>r.regraVersao===v)))return invalid();
 const totals=array(m.totals).map(value=>{const t=object(value);const tipo=string(t.tipo);if(!['unidade','distrito'].includes(tipo))return invalid();return{tipo,unidadeMedida:string(t.unidadeMedida),sum:decimal(t.sum)};});
 if(new Set(totals.map(t=>t.tipo+'\0'+t.unidadeMedida)).size!==totals.length)return invalid();
 return {competencia,ruleVersions,publicationVersion,positionCount,calculableCount,unavailableCount,notApplicableCount,totals};
}
export function decodeExportBundle(value:unknown):ExportBundle{
 const b=object(value),m=object(b.manifest);if(b.contractVersion!==1&&b.contractVersion!==2)return invalid();
 const snapshotId=string(b.snapshotId),competencia=string(m.competencia);
 if(m.publicationVersion!==0&&m.publicationVersion!==1)return invalid();
 const publicationVersion=m.publicationVersion,publicacao=publicationVersion===1?'publicada_demo':'nao_publicada';
 if(b.contractVersion===2){
  const rows=array(b.rows).map(value=>decodeModel3Row(value,snapshotId,competencia,publicacao));
  if(new Set(rows.map(r=>r.conjunto+'\0'+r.conjuntoVersao+'\0'+r.sintetico)).size!==1)return invalid();
  return {contractVersion:2,snapshotId,rows,manifest:decodeManifest(m,competencia,publicationVersion,rows.map(r=>({regraVersao:r.regraVersao,state:r.situacaoDado})))};
 }
 const rows=array(b.rows).map(value=>decodeModel2Row(value,snapshotId,competencia,publicacao));
 return {contractVersion:1,snapshotId,rows,manifest:decodeManifest(m,competencia,publicationVersion,rows.map(r=>({regraVersao:r.regraVersao,state:r.estadoDado})))};
}
export async function requestSnapshotExport(client:SupabaseClient,context:CommandContext,snapshotId:string,operationId:string):Promise<ExportBundle>{
 const bundle=await runCommand(client,'get_snapshot_export',context,{p_snapshot_id:snapshotId},operationId,decodeExportBundle);
 if(bundle.snapshotId!==snapshotId)return invalid();return bundle;
}
