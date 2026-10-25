import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { academicCredential } from './e2eSupport';
import { loadAuthorizedContexts, toCommandContext } from '../../src/features/context/contextApi';
import { listPositions, loadPositionDetail, saveDraft } from '../../src/features/submission/positionApi';
import { submitPosition } from '../../src/features/submission/submitApi';
import { reviewPosition, startReview } from '../../src/features/review/reviewApi';
test.use({trace:'off'});
test.skip(!process.env.ACADEMIC_CAM_EMAIL,'Requires isolated academic fixture');
// T07 owns NORTE-1 October (return) and NORTE-1 September (unavailability/race).
// Preparation is real save+submit, independent of academic-draft.spec ordering.
function newClient(){return createClient(process.env.VITE_SUPABASE_URL!,process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});}
async function signedIn(role:'area_tecnica'|'revisor_tecnico'|'cam'){
 const client=newClient();expect((await client.auth.signInWithPassword(academicCredential(role))).error).toBeNull();return client;
}
async function contextFor(client:SupabaseClient,role:string,month:string){
 const context=(await loadAuthorizedContexts(client)).find(c=>c.role===role&&c.escopoCodigo==='ACADEMIC-NORTE-1'&&c.competenciaCodigo===month);expect(context).toBeDefined();return context!;
}
async function prepare(month:string,unavailable=false){
 const client=await signedIn('area_tecnica');const context=await contextFor(client,'area_tecnica',month);const command=toCommandContext(context);
 const position=(await listPositions(client,command,{page:1,pageSize:25})).items[0];
 expect(['ausente','rascunho']).toContain(position.status);
 const saved=await saveDraft(client,command,position.id,position.version,{estadoDado:unavailable?'indisponivel':'valor',valor:unavailable?null:'10',fonte:'Synthetic T07 evidence',periodoFonte:'2026-10-01',motivo:unavailable?'Synthetic unavailable source':''},crypto.randomUUID());
 const sent=await submitPosition(client,command,position.id,saved.version,crypto.randomUUID());await client.auth.signOut();return sent;
}
async function login(page:Page,role:'area_tecnica'|'revisor_tecnico',month:string){
 await page.goto('/');await page.getByLabel('E-mail').fill(academicCredential(role).email);await page.getByLabel('Senha').fill(academicCredential(role).password);await page.getByRole('button',{name:'Entrar',exact:true}).click();
 const picker=page.getByLabel('Contexto autorizado');const option=picker.locator('option').filter({hasText:`${role} · ACADEMIC-NORTE-1 · ${month}`});await expect(option).toHaveCount(1);const key=(await option.getAttribute('value'))!;await picker.selectOption(key);return key;
}
test('real host claims, retries an ambiguous claim, returns with reason and technical author reads after reload',async({page})=>{
 const sent=await prepare('ACADEMIC-2026-10');
 for(const role of ['area_tecnica','cam'] as const){const client=await signedIn(role);const context=await contextFor(client,role,'ACADEMIC-2026-10');
  await expect(startReview(client,toCommandContext(context),sent.resourceId,sent.version,crypto.randomUUID())).rejects.toMatchObject({code:'access_denied'});
  await expect(reviewPosition(client,toCommandContext(context),sent.resourceId,sent.version,'accept','',crypto.randomUUID())).rejects.toMatchObject({code:'access_denied'});await client.auth.signOut();}
 await login(page,'revisor_tecnico','ACADEMIC-2026-10');await page.getByRole('button',{name:/ACADEMIC-NORTE-1 · enviada/}).click();
 const payloads:unknown[]=[];let lost=true;
 await page.route('**/rest/v1/rpc/start_position_review',async route=>{payloads.push(route.request().postDataJSON());const response=await route.fetch();expect(response.status()).toBe(200);if(lost){lost=false;await route.abort('failed');}else await route.fulfill({response});});
 await page.getByRole('button',{name:'Iniciar revisão'}).click();await expect(page.getByRole('alert')).toBeVisible();
 await page.getByRole('button',{name:'Repetir operação pendente'}).click();await expect(page.getByRole('button',{name:'Aceitar evidência'})).toBeVisible();
 expect(payloads).toHaveLength(2);expect(payloads[1]).toEqual(payloads[0]);
 await page.getByRole('button',{name:'Devolver com motivo'}).click();await expect(page.getByRole('alert')).toContainText('Informe o motivo');
 await page.getByLabel('Motivo da conferência').fill('  Corrigir referência sintética T07  ');await page.getByRole('button',{name:'Devolver com motivo'}).click();
 await expect(page.getByText('Conferência confirmada: devolvida.')).toBeVisible();
 await page.getByRole('button',{name:'Sair',exact:true}).click();await expect(page.getByLabel('E-mail')).toBeVisible();
 const key=await login(page,'area_tecnica','ACADEMIC-2026-10');await page.reload();await page.getByLabel('Contexto autorizado').selectOption(key);
 await page.getByRole('button',{name:/ACADEMIC-NORTE-1 · devolvida/}).click();await expect(page.getByText('Motivo da devolução técnica: Corrigir referência sintética T07')).toBeVisible();
 const client=await signedIn('area_tecnica');const context=await contextFor(client,'area_tecnica','ACADEMIC-2026-10');const detail=await loadPositionDetail(client,toCommandContext(context),sent.resourceId);
 expect(detail.revisions).toHaveLength(1);expect(detail.revisions[0].source).toBe('Synthetic T07 evidence');expect(detail.memories[0].resultValue).toBe('8');expect(detail.decisions.map(d=>d.type)).toEqual(['iniciar_revisao','devolver']);await client.auth.signOut();
});
test('two real concurrent decisions cannot both win; unavailable acceptance has no numeric or CAM decision',async()=>{
 const sent=await prepare('ACADEMIC-2026-09',true);const client=await signedIn('revisor_tecnico');const context=await contextFor(client,'revisor_tecnico','ACADEMIC-2026-09');const command=toCommandContext(context);
 await expect(reviewPosition(client,command,sent.resourceId,sent.version,'accept','',crypto.randomUUID())).rejects.toMatchObject({code:'invalid_state'});
 const claimKey=crypto.randomUUID();const [claim,replayed]=await Promise.all([startReview(client,command,sent.resourceId,sent.version,claimKey),startReview(client,command,sent.resourceId,sent.version,claimKey)]);expect(replayed).toEqual(claim);
 const operation=crypto.randomUUID();const otherOperation=crypto.randomUUID();
 const outcomes=await Promise.allSettled([reviewPosition(client,command,sent.resourceId,claim.version,'accept','Checked synthetic evidence',operation),reviewPosition(client,command,sent.resourceId,claim.version,'accept','Independent competing decision',otherOperation)]);
 expect(outcomes.filter(outcome=>outcome.status==='fulfilled')).toHaveLength(1);
 expect((outcomes.find(outcome=>outcome.status==='rejected') as PromiseRejectedResult).reason).toMatchObject({code:'version_conflict'});
 const winner=outcomes.findIndex(outcome=>outcome.status==='fulfilled');const accepted=(outcomes[winner] as PromiseFulfilledResult<Awaited<ReturnType<typeof reviewPosition>>>).value;expect(accepted.status).toBe('validada');expect(accepted.resultValue).toBeNull();
 expect(await reviewPosition(client,command,sent.resourceId,claim.version,'accept',winner===0?'Checked synthetic evidence':'Independent competing decision',winner===0?operation:otherOperation)).toEqual(accepted);
 const detail=await loadPositionDetail(client,command,sent.resourceId);expect(detail.position.version).toBe(sent.version+2);expect(detail.position.estadoDado).toBe('indisponivel');expect(detail.memories).toEqual([]);expect(detail.decisions.map(d=>d.type)).toEqual(['iniciar_revisao','validar']);await client.auth.signOut();
});
