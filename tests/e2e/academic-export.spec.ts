import { readFile } from 'node:fs/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { academicCredential } from './e2eSupport';
import { loadAuthorizedContexts, toCommandContext } from '../../src/features/context/contextApi';
import { saveDraft, listPositions } from '../../src/features/submission/positionApi';
import { submitPosition } from '../../src/features/submission/submitApi';
import { startReview, reviewPosition } from '../../src/features/review/reviewApi';
import { decideUnavailability } from '../../src/features/review/correctionApi';
import { loadCycleChecklist, transitionCycle, publishCycleDemo } from '../../src/features/cycle/cycleApi';
import { requestSnapshotExport } from '../../src/features/export/exportApi';
test.use({trace:'off'});
test.skip(!process.env.ACADEMIC_CAM_EMAIL,'Requires isolated academic fixture');
async function signedIn(identity:Parameters<typeof academicCredential>[0]){
 const c=createClient(process.env.VITE_SUPABASE_URL!,process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 expect((await c.auth.signInWithPassword(academicCredential(identity))).error).toBeNull();return c;
}
async function contexts(client:SupabaseClient,role:string){return(await loadAuthorizedContexts(client)).filter(c=>c.role===role&&c.competenciaCodigo==='ACADEMIC-2026-10');}
test('CAM downloads canonical synthetic CSV and manifest from durable closed snapshot, unpublished then published',async({page})=>{
 const clients:SupabaseClient[]=[];const cam=await signedIn('cam');clients.push(cam);const cc=toCommandContext((await contexts(cam,'cam'))[0]);
 await expect(requestSnapshotExport(cam,cc,crypto.randomUUID(),crypto.randomUUID())).rejects.toMatchObject({code:'invalid_state'});
 const inputs:Record<string,string|null>={'ACADEMIC-NORTE':'10','ACADEMIC-SUL':'20','ACADEMIC-NORTE-1':'0','ACADEMIC-NORTE-2':'0.0001','ACADEMIC-SUL-1':'12','ACADEMIC-SUL-2':null};
 for(const side of [0,1]){
  const technical=await signedIn(side?'southTechnical':'area_tecnica'),reviewer=await signedIn(side?'southReviewer':'revisor_tecnico');clients.push(technical,reviewer);
  for(const tc of await contexts(technical,'area_tecnica')){
   const command=toCommandContext(tc),pos=(await listPositions(technical,command,{page:1,pageSize:25})).items[0],value=inputs[tc.escopoCodigo];
   const saved=await saveDraft(technical,command,pos.id,pos.version,{estadoDado:value===null?'indisponivel':'valor',valor:value,fonte:'T11 synthetic source',periodoFonte:'2026-10-01',motivo:value===null?'Synthetic unavailable':''},crypto.randomUUID());
   const sent=await submitPosition(technical,command,pos.id,saved.version,crypto.randomUUID());
   const rc=toCommandContext((await contexts(reviewer,'revisor_tecnico')).find(c=>c.escopoId===tc.escopoId)!);
   const claim=await startReview(reviewer,rc,pos.id,sent.version,crypto.randomUUID()),accepted=await reviewPosition(reviewer,rc,pos.id,claim.version,'accept','T11 independent evidence',crypto.randomUUID());
   if(value===null)await decideUnavailability(cam,toCommandContext((await contexts(cam,'cam')).find(c=>c.escopoId===tc.escopoId)!),pos.id,accepted.version,'DEMO-T11-UNAVAILABLE','Synthetic CAM evidence',crypto.randomUUID());
  }
 }
 let checklist=await loadCycleChecklist(cam,cc);await transitionCycle(cam,cc,checklist.version,'consolidate','','',crypto.randomUUID());
 checklist=await loadCycleChecklist(cam,cc);await transitionCycle(cam,cc,checklist.version,'close','','DEMO-DECISAO-T11',crypto.randomUUID());
 checklist=await loadCycleChecklist(cam,cc);const sid=checklist.snapshotId!;expect(checklist.publication).toBe('nao_publicada');
 const partial=await signedIn('partialCam');clients.push(partial);await expect(requestSnapshotExport(partial,toCommandContext((await contexts(partial,'cam'))[0]),sid,crypto.randomUUID())).rejects.toMatchObject({code:'access_denied'});
 await page.goto('/');await page.getByLabel('E-mail').fill(academicCredential('cam').email);await page.getByLabel('Senha').fill(academicCredential('cam').password);await page.getByRole('button',{name:'Entrar',exact:true}).click();
 const choose=async()=>{const picker=page.getByLabel('Contexto autorizado');await picker.selectOption((await picker.locator('option').filter({hasText:'cam · ACADEMIC-NORTE · ACADEMIC-2026-10'}).getAttribute('value'))!);};
 await choose();await expect(page.getByText(`Snapshot fechado: ${sid}`)).toBeVisible();
 const download=async(name:string)=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();const file=await pending;const path=await file.path();expect(path).toBeTruthy();return{bytes:await readFile(path!),name:file.suggestedFilename()};};
 const csv=await download('Baixar CSV');expect(csv.name).toBe(`gratifiki-demo-${sid}-p0.csv`);expect(csv.bytes.subarray(0,3).toString('hex')).not.toBe('efbbbf');
 // Literal oracle, independently calculated from the six inputs above.
 const expectedCsv=`snapshot,competencia,indicador,alvo_tipo,alvo_codigo,regra_versao,revisao,estado_dado,valor_entrada,fator,resultado,publicacao\r\n${sid},ACADEMIC-2026-10,DEMO-01,distrito,ACADEMIC-NORTE,1,1,valor,10,0.8,8,nao_publicada\r\n${sid},ACADEMIC-2026-10,DEMO-01,distrito,ACADEMIC-SUL,1,1,valor,20,0.8,16,nao_publicada\r\n${sid},ACADEMIC-2026-10,DEMO-01,unidade,ACADEMIC-NORTE-1,1,1,valor,0,0.8,0,nao_publicada\r\n${sid},ACADEMIC-2026-10,DEMO-01,unidade,ACADEMIC-NORTE-2,1,1,valor,0.0001,0.8,0.00008,nao_publicada\r\n${sid},ACADEMIC-2026-10,DEMO-01,unidade,ACADEMIC-SUL-1,1,1,valor,12,0.8,9.6,nao_publicada\r\n${sid},ACADEMIC-2026-10,DEMO-01,unidade,ACADEMIC-SUL-2,1,1,indisponivel,,,,nao_publicada\r\n`;
 expect(csv.bytes.toString('utf8')).toBe(expectedCsv);
 const manifest=await download('Baixar manifesto JSON');expect(manifest.name).toBe(`gratifiki-demo-${sid}-p0.json`);
 expect(manifest.bytes.toString('utf8')).toBe(`{"contractVersion":1,"snapshotId":"${sid}","competencia":"ACADEMIC-2026-10","ruleVersions":[1],"publicationVersion":0,"positionCount":6,"calculableCount":5,"unavailableCount":1,"notApplicableCount":0,"totals":[{"tipo":"distrito","unidadeMedida":"pontos sintéticos","sum":"24"},{"tipo":"unidade","unidadeMedida":"pontos sintéticos","sum":"9.60008"}]}\n`);
 const repeated=await download('Baixar CSV');expect(repeated.bytes.equals(csv.bytes)).toBe(true);
 // Response loss after commit: retry must keep UUID and file format, not log a
 // second export operation. SQL test independently verifies event cardinality.
 const payloads:unknown[]=[];let lost=true;
 await page.route('**/rest/v1/rpc/get_snapshot_export',async route=>{payloads.push(route.request().postDataJSON());const response=await route.fetch();expect(response.status()).toBe(200);if(lost){lost=false;await route.abort('failed');}else await route.fulfill({response});});
 await page.getByRole('button',{name:'Baixar manifesto JSON'}).click();await page.getByRole('button',{name:'Repetir exportação pendente'}).waitFor();
 const retryFile=await download('Repetir exportação pendente');expect(retryFile.bytes.equals(manifest.bytes)).toBe(true);expect(payloads[1]).toEqual(payloads[0]);await page.unroute('**/rest/v1/rpc/get_snapshot_export');
 await publishCycleDemo(cam,cc,sid,'DEMO-PUBLICACAO-T11',crypto.randomUUID());await page.reload();await choose();await expect(page.getByText('Publicação: publicada_demo')).toBeVisible();
 const published=await download('Baixar manifesto JSON');expect(JSON.parse(published.bytes.toString('utf8'))).toMatchObject({snapshotId:sid,publicationVersion:1,positionCount:6});
 expect(published.name).toBe(`gratifiki-demo-${sid}-p1.json`);
 for(const c of clients)await c.auth.signOut();
});
