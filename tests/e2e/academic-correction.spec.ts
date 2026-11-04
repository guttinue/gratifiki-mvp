import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { academicCredential } from './e2eSupport';
import { openAcademicPage, openContextPicker } from './academicFlowSupport';
import { loadAuthorizedContexts, toCommandContext } from '../../src/features/context/contextApi';
import { listPositions, loadPositionDetail, saveDraft } from '../../src/features/submission/positionApi';
import { submitPosition } from '../../src/features/submission/submitApi';
import { reviewPosition, startReview } from '../../src/features/review/reviewApi';
import { correctPosition, authorizeCorrection, decideUnavailability } from '../../src/features/review/correctionApi';
test.use({trace:'off'});
test.skip(!process.env.ACADEMIC_CAM_EMAIL,'Requires isolated academic fixture');
// T08 alone owns district ACADEMIC-SUL October. Never resets previous specs.
type Identity='southTechnical'|'southReviewer'|'cam';
async function signedIn(identity:Identity){const c=createClient(process.env.VITE_SUPABASE_URL!,process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});expect((await c.auth.signInWithPassword(academicCredential(identity))).error).toBeNull();return c;}
async function ctx(client:SupabaseClient,role:string){const found=(await loadAuthorizedContexts(client)).find(c=>c.role===role&&c.escopoCodigo==='ACADEMIC-SUL'&&c.competenciaCodigo==='ACADEMIC-2026-10');expect(found).toBeDefined();return found!;}
async function login(page:Page,identity:Identity,role:string){
 await page.goto('/');await page.getByLabel('E-mail').fill(academicCredential(identity).email);await page.getByLabel('Senha').fill(academicCredential(identity).password);await page.getByRole('button',{name:'Entrar',exact:true}).click();
 const picker=await openContextPicker(page);const option=picker.locator('option').filter({hasText:`${role} · ACADEMIC-SUL · ACADEMIC-2026-10`});await expect(option).toHaveCount(1);await picker.selectOption((await option.getAttribute('value'))!);
 await openAcademicPage(page,role==='cam'?'Ciclo e fechamento':'Preenchimento');
}
async function logout(page:Page){await page.getByRole('button',{name:'Sair',exact:true}).click();await expect(page.getByLabel('E-mail')).toBeVisible();}
test('persistent correction preserves old 8, creates 9.6 and requires independent review, CAM rectification and explicit unavailable decision',async({page})=>{
 const technical=await signedIn('southTechnical');const tc=toCommandContext(await ctx(technical,'area_tecnica'));
 const initial=(await listPositions(technical,tc,{page:1,pageSize:25})).items[0];expect(['ausente','rascunho']).toContain(initial.status);
 const saved=await saveDraft(technical,tc,initial.id,initial.version,{estadoDado:'valor',valor:'10',fonte:'T08 original synthetic source',periodoFonte:'2026-10-01',motivo:''},crypto.randomUUID());
 const sent=await submitPosition(technical,tc,initial.id,saved.version,crypto.randomUUID());expect(sent.resultValue).toBe('8');
 const reviewer=await signedIn('southReviewer');const rc=toCommandContext(await ctx(reviewer,'revisor_tecnico'));
 const claim=await startReview(reviewer,rc,initial.id,sent.version,crypto.randomUUID());const returned=await reviewPosition(reviewer,rc,initial.id,claim.version,'return','T08 correct synthetic input',crypto.randomUUID());
 const before=await loadPositionDetail(technical,tc,initial.id);const old=before.revisions.find(r=>r.id===sent.revisionId)!;const oldMemory=before.memories.find(r=>r.revisionId===sent.revisionId)!;const oldDecisions=before.decisions.filter(d=>d.revisionId===sent.revisionId);
 await login(page,'southTechnical','area_tecnica');await page.getByRole('button',{name:'ACADEMIC-SUL · devolvida',exact:true}).click();await page.getByLabel('Valor corrigido',{exact:true}).fill('12');await page.getByLabel('Fonte corrigida',{exact:true}).fill('T08 corrected synthetic source');
 let lost=true;const payloads:unknown[]=[];
 await page.route('**/rest/v1/rpc/correct_position',async route=>{
  payloads.push(route.request().postDataJSON());
  if(lost){
   lost=false;const [first,concurrentRetry]=await Promise.all([route.fetch(),route.fetch()]);expect(first.status()).toBe(200);expect(concurrentRetry.status()).toBe(200);expect(await concurrentRetry.json()).toEqual(await first.json());await route.abort('failed');
  }else{const response=await route.fetch();expect(response.status()).toBe(200);await route.fulfill({response});}
 });
 await page.getByRole('button',{name:'Enviar nova revisão'}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'Repetir operação pendente'}).click();await expect(page.getByText(/Nova revisão enviada.*9.6/)).toBeVisible();expect(payloads[1]).toEqual(payloads[0]);await page.unroute('**/rest/v1/rpc/correct_position');
 const corrected=await loadPositionDetail(technical,tc,initial.id);expect(corrected.position.resultValue).toBe('9.6');expect(corrected.position.revisionId).not.toBe(sent.revisionId);expect(corrected.revisions).toHaveLength(2);expect(corrected.revisions.find(r=>r.id===old.id)).toEqual(old);expect(corrected.memories.find(r=>r.revisionId===old.id)).toEqual(oldMemory);expect(corrected.decisions.filter(d=>d.revisionId===old.id)).toEqual(oldDecisions);
 await expect(correctPosition(technical,tc,initial.id,returned.version,{estadoDado:'valor',valor:'12',fonte:'T08 corrected synthetic source',periodoFonte:'2026-10-01',motivo:''},crypto.randomUUID())).rejects.toMatchObject({code:'version_conflict'});
 await expect(reviewPosition(reviewer,rc,initial.id,corrected.position.version,'accept','',crypto.randomUUID())).rejects.toMatchObject({code:'invalid_state'});
 const claim2=await startReview(reviewer,rc,initial.id,corrected.position.version,crypto.randomUUID());const accepted=await reviewPosition(reviewer,rc,initial.id,claim2.version,'accept','T08 independently accepted',crypto.randomUUID());
 const acceptedDetail=await loadPositionDetail(reviewer,rc,initial.id);const priorAcceptance=acceptedDetail.decisions.find(d=>d.revisionId===accepted.revisionId&&d.type==='validar')!;
 await logout(page);await login(page,'cam','cam');await page.getByRole('button',{name:'ACADEMIC-SUL · validada',exact:true}).click();await page.getByLabel('Motivo CAM').fill('T08 synthetic rectification');await page.getByRole('button',{name:'Autorizar retificação'}).click();await expect(page.getByText('Decisão CAM confirmada: devolvida.')).toBeVisible();
 const rectified=await loadPositionDetail(technical,tc,initial.id);expect(rectified.decisions.find(d=>d.id===priorAcceptance.id)).toEqual(priorAcceptance);expect(rectified.position.status).toBe('devolvida');
 await logout(page);
 await login(page,'southTechnical','area_tecnica');
 await page.getByRole('button',{name:'ACADEMIC-SUL · devolvida',exact:true}).click();
 await expect(page.getByText('Motivo da retificação CAM: T08 synthetic rectification')).toBeVisible();
 await page.reload();
 const technicalPicker=await openContextPicker(page);
 const technicalOption=technicalPicker.locator('option').filter({hasText:'area_tecnica · ACADEMIC-SUL · ACADEMIC-2026-10'});
 await technicalPicker.selectOption((await technicalOption.getAttribute('value'))!);
 await page.getByRole('button',{name:'ACADEMIC-SUL · devolvida',exact:true}).click();
 await expect(page.getByText('Motivo da retificação CAM: T08 synthetic rectification')).toBeVisible();
 await page.getByLabel('Estado do dado corrigido').selectOption('indisponivel');
 await page.getByLabel('Justificativa da correção').fill('T08 unavailable synthetic source');
 await page.getByRole('button',{name:'Enviar nova revisão'}).click();
 await expect(page.getByText(/Nova revisão enviada.*Sem número/)).toBeVisible();
 await page.getByRole('button',{name:'Atualizar consulta'}).click();
 await page.getByRole('button',{name:'ACADEMIC-SUL · enviada',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Motivo',exact:true})).toHaveValue('T08 unavailable synthetic source');
 await expect(page.getByText('Motivo da retificação CAM: T08 synthetic rectification')).toHaveCount(0);
 const unavailable=await loadPositionDetail(technical,tc,initial.id);const cam=await signedIn('cam');const cc=toCommandContext(await ctx(cam,'cam'));
 await expect(decideUnavailability(cam,cc,initial.id,unavailable.position.version,'DEMO-T08','Not yet reviewed',crypto.randomUUID())).rejects.toMatchObject({code:'invalid_state'});
 const claim3=await startReview(reviewer,rc,initial.id,unavailable.position.version,crypto.randomUUID());await reviewPosition(reviewer,rc,initial.id,claim3.version,'accept','T08 unavailable evidence independently checked',crypto.randomUUID());
 await logout(page);await login(page,'cam','cam');await page.getByRole('button',{name:'ACADEMIC-SUL · validada',exact:true}).click();await page.getByLabel('Motivo CAM').fill('T08 synthetic decision');await page.getByLabel('Referência de demonstração').fill('DEMO-T08');await page.getByRole('button',{name:'Decidir indisponibilidade'}).click();await expect(page.getByText('Decisão CAM confirmada: validada.')).toBeVisible();
 const final=await loadPositionDetail(technical,tc,initial.id);expect(final.revisions).toHaveLength(3);expect(final.position.resultValue).toBeNull();expect(final.memories.some(m=>m.revisionId===final.position.revisionId)).toBe(false);expect(final.decisions.filter(d=>d.revisionId===final.position.revisionId).map(d=>d.type)).toEqual(['iniciar_revisao','validar','decidir_indisponibilidade']);expect(final.revisions.find(r=>r.id===old.id)).toEqual(old);expect(final.decisions.find(d=>d.id===priorAcceptance.id)).toEqual(priorAcceptance);
 await page.reload();const picker=await openContextPicker(page);await picker.selectOption((await picker.locator('option').filter({hasText:'cam · ACADEMIC-SUL · ACADEMIC-2026-10'}).getAttribute('value'))!);await page.getByRole('button',{name:'ACADEMIC-SUL · validada',exact:true}).click();await expect(page.getByText('decidir_indisponibilidade: T08 synthetic decision')).toBeVisible();
 await expect(authorizeCorrection(technical,tc,initial.id,final.position.version,'No CAM authority',crypto.randomUUID())).rejects.toMatchObject({code:'access_denied'});
 for(const client of [technical,reviewer,cam])await client.auth.signOut();
});
