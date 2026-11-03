import { describe, expect, it } from 'vitest';
import type { ExportBundle } from '../pilot/types';
import { sanitizeCsvText, serializeExportCsv, serializeExportManifest } from './exportCsv';
export const bundle:ExportBundle={contractVersion:1,snapshotId:'snapshot',rows:[
 {snapshotId:'snapshot',competencia:'2026-10',indicador:'DEMO-01',alvoTipo:'unidade',alvoCodigo:'Zulu',regraVersao:1,revisao:1,estadoDado:'indisponivel',entrada:null,fator:null,resultado:null,publicacao:'nao_publicada'},
 {snapshotId:'snapshot',competencia:'2026-10',indicador:'DEMO-01',alvoTipo:'distrito',alvoCodigo:'Água,"Norte"\n=2',regraVersao:1,revisao:1,estadoDado:'valor',entrada:'0',fator:'0.8',resultado:'0',publicacao:'nao_publicada'},
],manifest:{competencia:'2026-10',ruleVersions:[1],publicationVersion:0,positionCount:2,calculableCount:1,unavailableCount:1,notApplicableCount:0,totals:[{tipo:'distrito',unidadeMedida:'pontos sintéticos',sum:'0'}]}};
describe('canonical export contract',()=>{
 it.each(['\t =1+1','\u001f=2',' +2','-2','@SUM(A1)','\u00a0\r=2'])('neutralizes text formulas after whitespace/control: %j',text=>expect(sanitizeCsvText(text)).toBe("'"+text));
 it('does not change safe Unicode text',()=>expect(sanitizeCsvText('Água')).toBe('Água'));
 it('matches independently hand-written CSV, with null distinct from numeric zero',()=>{
  expect(serializeExportCsv(bundle)).toBe('snapshot,competencia,indicador,alvo_tipo,alvo_codigo,regra_versao,revisao,estado_dado,valor_entrada,fator,resultado,publicacao\r\nsnapshot,2026-10,DEMO-01,distrito,"Água,""Norte""\n=2",1,1,valor,0,0.8,0,nao_publicada\r\nsnapshot,2026-10,DEMO-01,unidade,Zulu,1,1,indisponivel,,,,nao_publicada\r\n');
 });
 it('matches independently hand-written canonical manifest without download timestamps',()=>{
  expect(serializeExportManifest(bundle)).toBe('{"contractVersion":1,"snapshotId":"snapshot","competencia":"2026-10","ruleVersions":[1],"publicationVersion":0,"positionCount":2,"calculableCount":1,"unavailableCount":1,"notApplicableCount":0,"totals":[{"tipo":"distrito","unidadeMedida":"pontos sintéticos","sum":"0"}]}\n');
 });
 it('is order independent but responds to changed data instead of constant output',()=>{
  const changed=structuredClone(bundle);changed.rows.reverse();
  expect(serializeExportCsv(changed)).toBe(serializeExportCsv(bundle));
  expect(serializeExportCsv(structuredClone(bundle))).toBe(serializeExportCsv(bundle));
  changed.rows[0].entrada='10';changed.rows[0].resultado='8';changed.manifest.totals[0].sum='8';
  expect(serializeExportCsv(changed)).toContain('valor,10,0.8,8,nao_publicada\r\n');
  expect(serializeExportManifest(changed)).toContain('"sum":"8"');
 });
 it('quotes only after formula neutralization and never prefixes typed numeric fields',()=>{
  const changed=structuredClone(bundle);changed.rows[1].alvoCodigo='\t =1,"x"';
  expect(serializeExportCsv(changed)).toContain('"\'\t =1,""x""",1,1,valor,0,0.8,0');
 });
});
const model3:ExportBundle={contractVersion:2,snapshotId:'snapshot',rows:[
 {snapshotId:'snapshot',competencia:'2026-09',indicador:'DEMO-V1-03',alvoTipo:'unidade',alvoCodigo:'@Alfa',regraVersao:1,revisao:1,situacaoDado:'indisponivel',valor:null,meta:'48',peso:'25',pesoEfetivo:'25',pontos:'0',conjunto:'=DEMO',conjuntoVersao:1,sintetico:true,publicacao:'publicada_demo'},
 {snapshotId:'snapshot',competencia:'2026-09',indicador:'DEMO-V1-01',alvoTipo:'unidade',alvoCodigo:'@Alfa',regraVersao:1,revisao:1,situacaoDado:'valor',valor:'88',meta:'95',peso:'30',pesoEfetivo:'30',pontos:'27.79',conjunto:'=DEMO',conjuntoVersao:1,sintetico:true,publicacao:'publicada_demo'},
],manifest:{competencia:'2026-09',ruleVersions:[1],publicationVersion:1,positionCount:2,calculableCount:1,unavailableCount:1,notApplicableCount:0,totals:[{tipo:'unidade',unidadeMedida:'pontos sintéticos',sum:'27.79'}]}};
describe('model-3 export contract',()=>{
 it('adds the meta/weight columns and keeps formula neutralization',()=>{
  expect(serializeExportCsv(model3)).toBe('snapshot,competencia,indicador,alvo_tipo,alvo_codigo,regra_versao,revisao,situacao_dado,valor,meta,peso,peso_efetivo,pontos,conjunto,conjunto_versao,sintetico,publicacao\r\n'
   +"snapshot,2026-09,DEMO-V1-01,unidade,'@Alfa,1,1,valor,88,95,30,30,27.79,'=DEMO,1,true,publicada_demo\r\n"
   +"snapshot,2026-09,DEMO-V1-03,unidade,'@Alfa,1,1,indisponivel,,48,25,25,0,'=DEMO,1,true,publicada_demo\r\n");
 });
 it('serializes the model-3 manifest under contract version 2',()=>{
  expect(serializeExportManifest(model3)).toBe('{"contractVersion":2,"snapshotId":"snapshot","competencia":"2026-09","ruleVersions":[1],"publicationVersion":1,"positionCount":2,"calculableCount":1,"unavailableCount":1,"notApplicableCount":0,"totals":[{"tipo":"unidade","unidadeMedida":"pontos sintéticos","sum":"27.79"}]}\n');
 });
});
