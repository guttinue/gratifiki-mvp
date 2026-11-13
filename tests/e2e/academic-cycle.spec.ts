import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { academicCredential } from './e2eSupport';
import { openAcademicPage, openContextPicker } from './academicFlowSupport';
import { loadAuthorizedContexts, toCommandContext } from '../../src/features/context/contextApi';
import { saveDraft, listPositions } from '../../src/features/submission/positionApi';
import { submitPosition } from '../../src/features/submission/submitApi';
import { startReview, reviewPosition } from '../../src/features/review/reviewApi';
import { decideUnavailability, authorizeCorrection } from '../../src/features/review/correctionApi';
import { loadCycleChecklist, transitionCycle, publishCycleDemo } from '../../src/features/cycle/cycleApi';
test.use({trace:'off'});
test.skip(!process.env.ACADEMIC_CAM_EMAIL,'Requires isolated academic fixture');
async function signedIn(identity:Parameters<typeof academicCredential>[0]){
 const c=createClient(process.env.VITE_SUPABASE_URL!,process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 expect((await c.auth.signInWithPassword(academicCredential(identity))).error).toBeNull();return c;
}
async function contexts(client:SupabaseClient,role:string){return(await loadAuthorizedContexts(client)).filter(c=>c.role===role&&c.competenciaCodigo==='ACADEMIC-2026-10');}
async function checkModalKeyboard(page:Page,triggerName:string,confirmName:string){
 const trigger=page.getByRole('button',{name:triggerName,exact:true});
 const dialog=page.getByRole('dialog',{name:confirmName,exact:true});
 await trigger.focus();await page.keyboard.press('Enter');
 const confirm=dialog.getByRole('button',{name:confirmName,exact:true});const cancel=dialog.getByRole('button',{name:'Cancelar',exact:true});
 await expect(confirm).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(cancel).toBeFocused();
 await page.keyboard.press('Tab');await expect(confirm).toBeFocused();await page.keyboard.press('Tab');await expect(cancel).toBeFocused();
 // Native modality also rejects programmatic focus of an otherwise active
 // background control; aria-modal alone does not make the background inert.
 await page.getByRole('button',{name:'Sair',exact:true}).evaluate(button=>button.focus());await expect(cancel).toBeFocused();
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
 await page.keyboard.press('Enter');await expect(confirm).toBeFocused();await page.keyboard.press('Tab');await page.keyboard.press('Enter');
 await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
 await page.keyboard.press('Enter');await expect(confirm).toBeFocused();
}
test('six expected positions close atomically, recover snapshot after reload and publish only by separate CAM confirmation',async({page})=>{
 const clients:SupabaseClient[]=[];const cam=await signedIn('cam');clients.push(cam);const cc=toCommandContext((await contexts(cam,'cam'))[0]);
 const before=await loadCycleChecklist(cam,cc);expect(before.expected).toBe(6);expect(before.canConsolidate).toBe(false);expect(before.canClose).toBe(false);
 await expect(transitionCycle(cam,cc,before.version,'consolidate','','',crypto.randomUUID())).rejects.toMatchObject({code:'invalid_state'});
 for(const side of [0,1]){
  const technical=await signedIn(side?'southTechnical':'area_tecnica');const reviewer=await signedIn(side?'southReviewer':'revisor_tecnico');clients.push(technical,reviewer);
  for(const tc of await contexts(technical,'area_tecnica')){
   const command=toCommandContext(tc);const pos=(await listPositions(technical,command,{page:1,pageSize:25})).items[0];
   const unavailable=tc.escopoCodigo==='ACADEMIC-SUL-2';
   const draft=await saveDraft(technical,command,pos.id,pos.version,{estadoDado:unavailable?'indisponivel':'valor',valor:unavailable?null:'10',fonte:'T09 synthetic origin',periodoFonte:'2026-10-01',motivo:unavailable?'T09 unavailable':''},crypto.randomUUID());
   const sent=await submitPosition(technical,command,pos.id,draft.version,crypto.randomUUID());
   const rc=toCommandContext((await contexts(reviewer,'revisor_tecnico')).find(c=>c.escopoId===tc.escopoId)!);
   const claim=await startReview(reviewer,rc,pos.id,sent.version,crypto.randomUUID());const accepted=await reviewPosition(reviewer,rc,pos.id,claim.version,'accept','T09 independent review',crypto.randomUUID());
   if(unavailable){const target=toCommandContext((await contexts(cam,'cam')).find(c=>c.escopoId===tc.escopoId)!);await decideUnavailability(cam,target,pos.id,accepted.version,'DEMO-T09-UNAVAILABLE','T09 evidence accepted',crypto.randomUUID());}
  }
 }
 const complete=await loadCycleChecklist(cam,cc);expect(complete).toMatchObject({expected:6,received:6,reviewed:6,decidedUnavailable:1});
 await transitionCycle(cam,cc,complete.version,'consolidate','','',crypto.randomUUID());
 await page.goto('/');await page.getByLabel('E-mail').fill(academicCredential('cam').email);await page.getByLabel('Senha').fill(academicCredential('cam').password);await page.getByRole('button',{name:'Entrar',exact:true}).click();
 const choose=async()=>{const picker=await openContextPicker(page);await picker.selectOption((await picker.locator('option').filter({hasText:'cam · ACADEMIC-NORTE · ACADEMIC-2026-10'}).getAttribute('value'))!);await openAcademicPage(page,'Ciclo e fechamento');};
 await choose();await expect(page.getByText('Esperadas: 6 · Recebidas: 6 · Conferidas: 6')).toBeVisible();
 await page.getByLabel('Referência do ciclo').fill('DEMO-DECISAO-T09');await checkModalKeyboard(page,'Fechar ciclo','Confirmar fechamento');
 expect((await loadCycleChecklist(cam,cc)).state).toBe('em_consolidacao');
 let lost=true;const payloads:unknown[]=[];
 await page.route('**/rest/v1/rpc/transition_cycle',async route=>{payloads.push(route.request().postDataJSON());const response=await route.fetch();expect(response.status()).toBe(200);if(lost){lost=false;await route.abort('failed');}else await route.fulfill({response});});
 await page.getByRole('button',{name:'Confirmar fechamento',exact:true}).click();await expect(page.getByRole('button',{name:'Repetir operação do ciclo'})).toBeVisible();await page.getByRole('button',{name:'Repetir operação do ciclo'}).click();await expect(page.getByText(/Snapshot fechado:/)).toBeVisible();expect(payloads[1]).toEqual(payloads[0]);await page.unroute('**/rest/v1/rpc/transition_cycle');
 const closed=await loadCycleChecklist(cam,cc);expect(closed.snapshotId).toBeTruthy();expect(closed.publication).toBe('nao_publicada');
 await expect(page.getByRole('heading',{name:'Ciclo da demonstração acadêmica',exact:true})).toBeFocused();
 await page.reload();await choose();await expect(page.getByText(`Snapshot fechado: ${closed.snapshotId}`)).toBeVisible();
 await page.getByLabel('Referência do ciclo').fill('DEMO-PUBLICACAO-T09');await checkModalKeyboard(page,'Publicar demonstração','Confirmar publicação');expect((await loadCycleChecklist(cam,cc)).publication).toBe('nao_publicada');await page.getByRole('button',{name:'Confirmar publicação',exact:true}).click();await expect(page.getByText('Publicação: publicada_demo')).toBeVisible();
 await expect(page.getByRole('heading',{name:'Ciclo da demonstração acadêmica',exact:true})).toBeFocused();
 const partial=await signedIn('partialCam');clients.push(partial);const pc=toCommandContext((await contexts(partial,'cam'))[0]);const limited=await loadCycleChecklist(partial,pc);expect(limited.expected).toBe(1);expect(limited.snapshotId).toBeNull();expect(limited.publicationId).toBeNull();
 await expect(publishCycleDemo(partial,pc,closed.snapshotId!,'DEMO-PUBLICACAO-NO',crypto.randomUUID())).rejects.toMatchObject({code:'access_denied'});
 const target=(await listPositions(cam,cc,{page:1,pageSize:25})).items[0];const exact=toCommandContext((await contexts(cam,'cam')).find(c=>c.escopoId===target.escopoId)!);
 await expect(authorizeCorrection(cam,exact,target.id,target.version,'Cannot reopen closed data',crypto.randomUUID())).rejects.toMatchObject({code:'invalid_state'});
 for(const c of clients)await c.auth.signOut();
});
