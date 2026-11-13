import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { requestSnapshotExport } from './exportApi';
const context={vinculoId:'link',competenciaId:'month',indicadorId:'indicator'};
const valid={contractVersion:1,snapshotId:'snapshot',rows:[{snapshotId:'snapshot',competencia:'2026-10',indicador:'DEMO-01',alvoTipo:'unidade',alvoCodigo:'A',regraVersao:1,revisao:1,estadoDado:'valor',entrada:'0',fator:'0.8',resultado:'0',publicacao:'nao_publicada'}],manifest:{competencia:'2026-10',ruleVersions:[1],publicationVersion:0,positionCount:1,calculableCount:1,unavailableCount:0,notApplicableCount:0,totals:[{tipo:'unidade',unidadeMedida:'pontos sintéticos',sum:'0'}]}};
function client(data:unknown){return createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async()=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}})}});}
describe('export untrusted command boundary',()=>{
 it('decodes ExportBundle instead of CommandReceipt and uses protected transport parameters',async()=>{
  let payload:unknown;
  const c=createClient('http://localhost:54321','public-key',{auth:{persistSession:false},global:{fetch:async(_url,init)=>{payload=JSON.parse(String(init?.body));return new Response(JSON.stringify(valid),{headers:{'content-type':'application/json'}});}}});
  expect(await requestSnapshotExport(c,context,'snapshot','operation')).toEqual(valid);
  expect(payload).toEqual({p_contexto:context,p_snapshot_id:'snapshot',p_operation_id:'operation'});
 });
 it.each([null,{}, {...valid,contractVersion:2},{...valid,snapshotId:'other'}, {...valid,rows:[{...valid.rows[0],resultado:0}]},{...valid,rows:[{...valid.rows[0],entrada:'0.0'}]},{...valid,rows:[{...valid.rows[0],estadoDado:'missing'}]},{...valid,manifest:{...valid.manifest,positionCount:2}},{...valid,manifest:{...valid.manifest,totals:[{tipo:'unidade',unidadeMedida:'pontos sintéticos',sum:'0.0'}]}}])('keeps malformed successful bundle ambiguous: %j',async data=>{
  await expect(requestSnapshotExport(client(data),context,'snapshot','operation')).rejects.toMatchObject({code:'invalid_input',confirmedRejected:false});
 });
});
const m3Row={snapshotId:'snapshot',competencia:'ACADEMIC-V3-2026-09',indicador:'DEMO-V1-01',alvoTipo:'unidade',alvoCodigo:'ACADEMIC-NORTE-1',regraVersao:1,revisao:1,situacaoDado:'valor',valor:'88',meta:'95',peso:'30',pesoEfetivo:'30',pontos:'27.79',conjunto:'DEMO',conjuntoVersao:1,sintetico:true,publicacao:'publicada_demo'};
const m3Unavailable={...m3Row,indicador:'DEMO-V1-03',situacaoDado:'indisponivel',valor:null,meta:'48',peso:'25',pesoEfetivo:'25',pontos:'0'};
const model3={contractVersion:2,snapshotId:'snapshot',rows:[m3Row,m3Unavailable],manifest:{competencia:'ACADEMIC-V3-2026-09',ruleVersions:[1],publicationVersion:1,positionCount:2,calculableCount:1,unavailableCount:1,notApplicableCount:0,totals:[{tipo:'unidade',unidadeMedida:'pontos sintéticos',sum:'27.79'}]}};
describe('model-3 export boundary',()=>{
 it('decodes the meta/weight bundle with points, weights and the synthetic set',async()=>{
  expect(await requestSnapshotExport(client(model3),context,'snapshot','operation')).toEqual(model3);
 });
 it.each([{...model3,rows:[{...m3Row,pontos:27.79},m3Unavailable]},{...model3,rows:[{...m3Row,sintetico:'true'},m3Unavailable]},{...model3,rows:[{...m3Row,pontos:null},m3Unavailable]},
  {...model3,rows:[m3Row,{...m3Unavailable,valor:'1'}]},{...model3,rows:[m3Row,{...m3Unavailable,conjuntoVersao:2}]},{...model3,rows:[{...m3Row,fator:'0.8'},m3Unavailable]},
  {...model3,contractVersion:1},{...model3,manifest:{...model3.manifest,calculableCount:2}}])('keeps malformed model-3 bundle ambiguous: %j',async data=>{
  await expect(requestSnapshotExport(client(data),context,'snapshot','operation')).rejects.toMatchObject({code:'invalid_input',confirmedRejected:false});
 });
});
