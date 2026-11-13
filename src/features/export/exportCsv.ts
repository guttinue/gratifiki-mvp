import type { ExportBundle } from '../pilot/types';
// Spreadsheet engines ignore leading whitespace/control characters before
// formula markers. Preserve text exactly, adding a literal apostrophe first.
// eslint-disable-next-line no-control-regex
export function sanitizeCsvText(value:string):string{return /^[\s\u0000-\u001f\u007f-\u009f]*[=+@-]/u.test(value)?"'"+value:value;}
function quote(value:string):string{return /[",\r\n]/.test(value)?'"'+value.replaceAll('"','""')+'"':value;}
function text(value:string):string{return quote(sanitizeCsvText(value));}
export function compareExportText(a:string,b:string):number{return a<b?-1:a>b?1:0;}
type SortableRow={alvoTipo:string;alvoCodigo:string;indicador:string};
function byTarget(a:SortableRow,b:SortableRow):number{return compareExportText(a.alvoTipo,b.alvoTipo)||compareExportText(a.alvoCodigo,b.alvoCodigo)||compareExportText(a.indicador,b.indicador);}
export function serializeExportCsv(bundle:ExportBundle):string{
 // Model 3 (contract 2) adds the frozen meta/weight columns in place of the
 // model-2 factor/result columns; decimals stay exact text, never prefixed.
 if(bundle.contractVersion===2){
  const header='snapshot,competencia,indicador,alvo_tipo,alvo_codigo,regra_versao,revisao,situacao_dado,valor,meta,peso,peso_efetivo,pontos,conjunto,conjunto_versao,sintetico,publicacao';
  return [header,...[...bundle.rows].sort(byTarget).map(r=>[text(r.snapshotId),text(r.competencia),text(r.indicador),text(r.alvoTipo),text(r.alvoCodigo),String(r.regraVersao),r.revisao===null?'':String(r.revisao),text(r.situacaoDado),r.valor??'',r.meta,r.peso,r.pesoEfetivo??'',r.pontos??'',text(r.conjunto),String(r.conjuntoVersao),String(r.sintetico),text(r.publicacao)].join(','))].join('\r\n')+'\r\n';
 }
 const header='snapshot,competencia,indicador,alvo_tipo,alvo_codigo,regra_versao,revisao,estado_dado,valor_entrada,fator,resultado,publicacao';
 const rows=[...bundle.rows].sort(byTarget);
 return [header,...rows.map(r=>[text(r.snapshotId),text(r.competencia),text(r.indicador),text(r.alvoTipo),text(r.alvoCodigo),String(r.regraVersao),r.revisao===null?'':String(r.revisao),text(r.estadoDado),r.entrada??'',r.fator??'',r.resultado??'',text(r.publicacao)].join(','))].join('\r\n')+'\r\n';
}
export function serializeExportManifest(bundle:ExportBundle):string{
 const m=bundle.manifest;
 return JSON.stringify({contractVersion:bundle.contractVersion,snapshotId:bundle.snapshotId,competencia:m.competencia,ruleVersions:[...m.ruleVersions].sort((a,b)=>a-b),publicationVersion:m.publicationVersion,positionCount:m.positionCount,calculableCount:m.calculableCount,unavailableCount:m.unavailableCount,notApplicableCount:m.notApplicableCount,totals:[...m.totals].sort((a,b)=>compareExportText(a.tipo,b.tipo)||compareExportText(a.unidadeMedida,b.unidadeMedida)).map(t=>({tipo:t.tipo,unidadeMedida:t.unidadeMedida,sum:t.sum}))})+'\n';
}
