import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { academicCredential } from './e2eSupport';
import { loadAuthorizedContexts, toCommandContext } from '../../src/features/context/contextApi';
import { loadAdminCatalog, setDemoBusinessLink } from '../../src/features/admin/adminApi';
import { loadDemoConfiguration, openDemoCompetence, reassignDemoPosition } from '../../src/features/admin/configurationApi';
import { listPositions, loadPositionDetail, saveDraft } from '../../src/features/submission/positionApi';
import { submitPosition } from '../../src/features/submission/submitApi';
import { reviewPosition, startReview } from '../../src/features/review/reviewApi';
import { loadCycleChecklist, transitionCycle } from '../../src/features/cycle/cycleApi';
import { requestSnapshotExport } from '../../src/features/export/exportApi';
import { loadAudit } from '../../src/features/audit/auditApi';
import { openAcademicPage, openContextPicker } from './academicFlowSupport';

test.use({trace:'off'});
test.skip(!process.env.ACADEMIC_ADMINISTRADOR_EMAIL,'Requires protected isolated academic fixture');
async function signedIn(role:Parameters<typeof academicCredential>[0]){
 const client=createClient(process.env.VITE_SUPABASE_URL!,process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 expect((await client.auth.signInWithPassword(academicCredential(role))).error).toBeNull();return client;
}
async function selected(client:SupabaseClient,scope:string,month='2026-10'){
 const context=(await loadAuthorizedContexts(client)).find(c=>c.competenciaCodigo===`ACADEMIC-${month}`&&c.escopoCodigo===scope&&c.role!=='cam');
 expect(context).toBeTruthy();return context!;
}
async function choose(page:Page,label:string){const picker=await openContextPicker(page);await picker.selectOption((await picker.locator('option').filter({hasText:label}).getAttribute('value'))!);}
async function browserLogin(page:Page,role:Parameters<typeof academicCredential>[0],label:string){
 await page.goto('/');await page.getByLabel('E-mail').fill(academicCredential(role).email);await page.getByLabel('Senha').fill(academicCredential(role).password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await choose(page,label);
}
test('future rule and complete universe preserve snapshot; reassigned draft and review require new explicit authorship and claim',async({page,browser})=>{
 test.setTimeout(120_000);
 const admin=await signedIn('administrador'),north=await signedIn('area_tecnica'),south=await signedIn('southTechnical'),northReviewer=await signedIn('revisor_tecnico'),southReviewer=await signedIn('southReviewer'),cam=await signedIn('cam');
 const all=[admin,north,south,northReviewer,southReviewer,cam];
 const ac=await selected(admin,'ACADEMIC-NORTE'),cc=toCommandContext(ac);
 const octoberCam=(await loadAuthorizedContexts(cam)).find(c=>c.competenciaCodigo==='ACADEMIC-2026-10')!,camContext=toCommandContext(octoberCam);
 // Prepare and close ALL six October positions using real independent commands.
 for(const position of (await listPositions(cam,camContext,{page:1,pageSize:100})).items){
  const scope=position.escopoCodigo,technical=scope.includes('NORTE')?north:south,reviewer=scope.includes('NORTE')?northReviewer:southReviewer;
  const tc=toCommandContext(await selected(technical,scope)),rc=toCommandContext(await selected(reviewer,scope));
  const draft=await saveDraft(technical,tc,position.id,position.version,{estadoDado:'valor',valor:'10',fonte:'T13 sintética outubro',periodoFonte:'2026-10-01',motivo:''},crypto.randomUUID());
  const sent=await submitPosition(technical,tc,position.id,draft.version,crypto.randomUUID());expect(sent.resultValue).toBe('8');
  const claim=await startReview(reviewer,rc,position.id,sent.version,crypto.randomUUID());await reviewPosition(reviewer,rc,position.id,claim.version,'accept','',crypto.randomUUID());
 }
 await transitionCycle(cam,camContext,(await loadCycleChecklist(cam,camContext)).version,'consolidate','','',crypto.randomUUID());
 const closure=await transitionCycle(cam,camContext,(await loadCycleChecklist(cam,camContext)).version,'close','','DEMO-DECISAO-T13',crypto.randomUUID());
 await browserLogin(page,'administrador','administrador · ACADEMIC-NORTE · ACADEMIC-2026-10');
 await page.getByRole('button',{name:'Regras futuras',exact:true}).click();
 await page.getByLabel('Fator sintético futuro').fill('0,75');await page.getByLabel('Primeiro mês da versão').fill('2026-11-01');await page.getByLabel('Referência de aprovação de demonstração').fill('DEMO-APROVACAO-T13');
 await page.getByRole('button',{name:'Agendar regra futura'}).click();await expect(page.getByText('Versão futura agendada. Competências anteriores preservadas.')).toBeVisible();
 await page.getByRole('button',{name:'Competências e atribuições',exact:true}).click();
 await page.getByLabel('Mês da nova competência').fill('2026-11-01');
 const payloads:unknown[]=[];let lost=true;
 await page.route('**/rest/v1/rpc/open_demo_competence',async route=>{payloads.push(route.request().postDataJSON());const response=await route.fetch();expect(response.status()).toBe(200);if(lost){lost=false;await route.abort('failed');}else await route.fulfill({response});});
 await page.getByRole('button',{name:'Abrir competência de demonstração'}).click();await page.getByRole('button',{name:'Repetir configuração pendente'}).click();await expect(page.getByText('Configuração confirmada.',{exact:true})).toBeVisible();expect(payloads[1]).toEqual(payloads[0]);await page.unroute('**/rest/v1/rpc/open_demo_competence');
 const config=await loadDemoConfiguration(admin,cc),november=config.competences.find(c=>c.reference==='2026-11-01')!;
 expect(config.positions.filter(p=>p.competenceId===november.id)).toHaveLength(6);
 const originalContext=await selected(north,'ACADEMIC-NORTE-1','2026-11'),originalCommand=toCommandContext(originalContext);
 const position=(await listPositions(north,originalCommand,{page:1,pageSize:25})).items[0],saveId=crypto.randomUUID();
 const originalInput={estadoDado:'valor' as const,valor:'10',fonte:'Rascunho original T13',periodoFonte:'2026-11-01',motivo:''};
 const oldDraft=await saveDraft(north,originalCommand,position.id,position.version,originalInput,saveId);
 // Links are granted explicitly through T12, never auto-created by assignment.
 const targetTechnical=(await selected(south,'ACADEMIC-SUL-1')).actorId,targetReviewer=(await selected(southReviewer,'ACADEMIC-SUL-1')).actorId;
 for(const [actorId,role] of [[targetTechnical,'area_tecnica'],[targetReviewer,'revisor_tecnico']] as const)await setDemoBusinessLink(admin,cc,actorId,0,{role,escopoId:originalContext.escopoId,indicadorId:ac.indicadorId,ativo:true,vigenciaInicio:'2026-01-01',vigenciaFim:null},crypto.randomUUID());
 const catalog=await loadAdminCatalog(admin,cc);expect(catalog.accounts.find(a=>a.actorId===targetTechnical)?.ativo).toBe(true);
 await page.reload();await choose(page,'administrador · ACADEMIC-NORTE · ACADEMIC-2026-11');await page.getByRole('button',{name:'Competências e atribuições',exact:true}).click();
 await page.getByLabel('Posição para reatribuição').selectOption(position.id);await page.getByLabel('Novo informante').selectOption(targetTechnical);await page.getByLabel('Motivo da reatribuição').fill('Continuidade sintética do rascunho');await page.getByRole('button',{name:'Salvar reatribuição'}).click();await expect(page.getByText('Configuração confirmada.',{exact:true})).toBeVisible();
 await expect(saveDraft(north,originalCommand,position.id,position.version,originalInput,saveId)).rejects.toMatchObject({code:'access_denied'});
 const techBrowser=await browser.newContext(),techPage=await techBrowser.newPage();
 await browserLogin(techPage,'southTechnical','area_tecnica · ACADEMIC-NORTE-1 · ACADEMIC-2026-11');await openAcademicPage(techPage,'Preenchimento');await techPage.getByRole('button',{name:'ACADEMIC-NORTE-1 · rascunho',exact:true}).click();
 await expect(techPage.getByRole('button',{name:'Enviar',exact:true})).toBeDisabled();await expect(techPage.getByLabel('Fonte',{exact:true})).toHaveValue('Rascunho original T13');
 await techPage.getByRole('button',{name:'Salvar rascunho'}).click();await expect(techPage.getByText('Rascunho salvo. Ainda não enviado.')).toBeVisible();await techPage.getByRole('button',{name:'Enviar',exact:true}).click();await expect(techPage.getByText('Resultado sintético: 7.5',{exact:true})).toBeVisible();
 const newContext=await selected(south,'ACADEMIC-NORTE-1','2026-11'),detail=await loadPositionDetail(south,toCommandContext(newContext),position.id);
 expect(detail.revisions).toHaveLength(2);expect(detail.revisions.find(r=>r.id===oldDraft.revisionId)).toMatchObject({authorId:originalContext.actorId,value:'10',source:'Rascunho original T13',submittedAt:null});expect(detail.revisions.find(r=>r.id===detail.position.revisionId)?.authorId).toBe(targetTechnical);
 const oldReviewContext=toCommandContext(await selected(northReviewer,'ACADEMIC-NORTE-1','2026-11')),claimId=crypto.randomUUID();
 const oldClaim=await startReview(northReviewer,oldReviewContext,position.id,detail.position.version,claimId);
 await page.getByRole('button',{name:'Atualizar configuração'}).click();await page.getByLabel('Posição para reatribuição').selectOption(position.id);await page.getByLabel('Novo revisor').selectOption(targetReviewer);await page.getByLabel('Motivo da reatribuição').fill('Conferência independente com novo responsável');await page.getByRole('button',{name:'Salvar reatribuição'}).click();await expect(page.getByText('Configuração confirmada.',{exact:true})).toBeVisible();
 await expect(startReview(northReviewer,oldReviewContext,position.id,detail.position.version,claimId)).rejects.toMatchObject({code:'access_denied'});
 const newReviewContext=toCommandContext(await selected(southReviewer,'ACADEMIC-NORTE-1','2026-11'));
 await expect(reviewPosition(southReviewer,newReviewContext,position.id,oldClaim.version+1,'accept','',crypto.randomUUID())).rejects.toMatchObject({code:'invalid_state'});
 const reviewBrowser=await browser.newContext(),reviewPage=await reviewBrowser.newPage();await browserLogin(reviewPage,'southReviewer','revisor_tecnico · ACADEMIC-NORTE-1 · ACADEMIC-2026-11');await openAcademicPage(reviewPage,'Conferência');await reviewPage.getByRole('button',{name:'ACADEMIC-NORTE-1 · enviada',exact:true}).click();await reviewPage.getByRole('button',{name:'Iniciar revisão',exact:true}).click();await expect(reviewPage.getByText('Conferência confirmada: em_revisao.',{exact:true})).toBeVisible();await reviewPage.getByRole('button',{name:'Aceitar evidência',exact:true}).click();await expect(reviewPage.getByText('Conferência confirmada: validada.',{exact:true})).toBeVisible();
 const currentDetail=await loadPositionDetail(south,toCommandContext(newContext),position.id);expect(currentDetail.decisions.filter(d=>d.type==='iniciar_revisao')).toHaveLength(2);
 const frozen=await requestSnapshotExport(cam,camContext,closure.resourceId,crypto.randomUUID());expect(frozen.rows).toHaveLength(6);expect(frozen.rows.every(r=>r.resultado==='8'&&r.fator==='0.8')).toBe(true);
 const novemberAdmin=toCommandContext(await selected(admin,'ACADEMIC-NORTE','2026-11'));
 await expect(openDemoCompetence(admin,novemberAdmin,'2026-11-01',config.positions.filter(p=>p.competenceId===november.id),crypto.randomUUID())).rejects.toMatchObject({code:'invalid_input'});
 await expect(reassignDemoPosition(admin,cc,position.id,9,{informanteId:targetTechnical,revisorId:targetReviewer},'Contexto errado',crypto.randomUUID())).rejects.toMatchObject({code:'access_denied'});
 const audit=await loadAudit(admin,novemberAdmin,{page:1,pageSize:100});expect(audit.items.some(a=>a.action==='regra_demo_agendada'&&a.version===2)).toBe(true);expect(audit.items.every(a=>a.reason===null)).toBe(true);
 await techBrowser.close();await reviewBrowser.close();for(const client of all)await client.auth.signOut();
});
