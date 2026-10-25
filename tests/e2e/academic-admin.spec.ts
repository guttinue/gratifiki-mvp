import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { academicCredential } from './e2eSupport';
import { loadAuthorizedContexts, toCommandContext } from '../../src/features/context/contextApi';
import { loadAdminCatalog, saveDemoScope, setDemoBusinessLink } from '../../src/features/admin/adminApi';
import { listPositions, saveDraft } from '../../src/features/submission/positionApi';
import { transitionCycle } from '../../src/features/cycle/cycleApi';
import { loadAudit } from '../../src/features/audit/auditApi';
test.use({trace:'off'});
test.skip(!process.env.ACADEMIC_ADMINISTRADOR_EMAIL,'Requires protected isolated academic fixture');
async function signedIn(role:Parameters<typeof academicCredential>[0]){
 const c=createClient(process.env.VITE_SUPABASE_URL!,process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 expect((await c.auth.signInWithPassword(academicCredential(role))).error).toBeNull();return c;
}
async function selected(client:SupabaseClient,scope:string){return(await loadAuthorizedContexts(client)).find(c=>c.competenciaCodigo==='ACADEMIC-2026-10'&&c.escopoCodigo===scope)!;}
test('administrator maintains only demo metadata; authenticated revoked technical command and replay fail immediately',async({page})=>{
 const admin=await signedIn('administrador'),technical=await signedIn('area_tecnica'),cam=await signedIn('cam'),manager=await signedIn('gestor_unidade');
 const ac=await selected(admin,'ACADEMIC-NORTE'),cc=toCommandContext(ac),tc=await selected(technical,'ACADEMIC-NORTE-1'),command=toCommandContext(tc);
 const before=await loadAdminCatalog(admin,cc);expect(JSON.stringify(before)).not.toMatch(/password|email|valor|resultValue/);
 const input={role:'cam' as const,escopoId:tc.escopoId,indicadorId:tc.indicadorId,ativo:true,vigenciaInicio:'2026-01-01',vigenciaFim:null};
 await expect(setDemoBusinessLink(admin,cc,ac.actorId,0,input,crypto.randomUUID())).rejects.toMatchObject({code:'access_denied'});
 const forbidden=await admin.rpc('set_demo_business_link',{p_contexto:cc,p_actor_id:tc.actorId,p_expected_version:0,p_input:{...input,role:'administrador'},p_operation_id:crypto.randomUUID()});expect(forbidden.error?.code).toBe('42501');
 await expect(setDemoBusinessLink(admin,cc,crypto.randomUUID(),0,input,crypto.randomUUID())).rejects.toMatchObject({code:'access_denied'});
 await expect(transitionCycle(admin,cc,1,'close','','DEMO-DECISAO-NO-ADMIN',crypto.randomUUID())).rejects.toMatchObject({code:'access_denied'});
 for(const c of [cam,manager])await expect(loadAdminCatalog(c,toCommandContext((await loadAuthorizedContexts(c)).find(x=>x.competenciaCodigo==='ACADEMIC-2026-10')!))).rejects.toMatchObject({code:'access_denied'});
 const pos=(await listPositions(technical,command,{page:1,pageSize:25})).items[0];const operationId=crypto.randomUUID();
 const draft={estadoDado:'valor' as const,valor:'10',fonte:'T12 synthetic source',periodoFonte:'2026-10-01',motivo:''};
 await saveDraft(technical,command,pos.id,pos.version,draft,operationId);
 await page.goto('/');await page.getByLabel('E-mail').fill(academicCredential('administrador').email);await page.getByLabel('Senha').fill(academicCredential('administrador').password);await page.getByRole('button',{name:'Entrar',exact:true}).click();
 const choose=async()=>{const picker=page.getByLabel('Contexto autorizado');await picker.selectOption((await picker.locator('option').filter({hasText:'administrador · ACADEMIC-NORTE · ACADEMIC-2026-10'}).getAttribute('value'))!);};
 await choose();await expect(page.getByRole('heading',{name:'Unidades e distritos de demonstração'})).toBeVisible();
 await page.getByLabel('Código do escopo').fill('DEMO-T12-DISTRICT');
 const payloads:unknown[]=[];let lost=true;
 await page.route('**/rest/v1/rpc/save_demo_scope',async route=>{payloads.push(route.request().postDataJSON());const response=await route.fetch();expect(response.status()).toBe(200);if(lost){lost=false;await route.abort('failed');}else await route.fulfill({response});});
 await page.getByRole('button',{name:'Salvar escopo'}).click();await page.getByRole('button',{name:'Repetir cadastro pendente'}).click();await expect(page.getByText('Cadastro salvo.',{exact:true})).toBeVisible();expect(payloads[1]).toEqual(payloads[0]);
 await page.unroute('**/rest/v1/rpc/save_demo_scope');await page.reload();await choose();await expect(page.getByRole('button',{name:'Editar DEMO-T12-DISTRICT'})).toBeVisible();
 await page.getByRole('button',{name:'Vínculos de negócio',exact:true}).click();
 await page.getByRole('button',{name:'Editar vínculo Conta acadêmica area_tecnica · area_tecnica · ACADEMIC-NORTE-1',exact:true}).click();
 await expect(page.getByLabel('Conta de demonstração').getByRole('option',{name:'Conta acadêmica administrador',exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Papel de negócio').getByRole('option',{name:'administrador',exact:true})).toHaveCount(0);
 await page.getByLabel('Vínculo ativo',{exact:true}).uncheck();await page.getByRole('button',{name:'Salvar vínculo',exact:true}).click();await expect(page.getByText('Vínculo salvo.',{exact:true})).toBeVisible();
 // Same authenticated technical session; not a logout/JWT refresh workaround.
 await expect(saveDraft(technical,command,pos.id,pos.version,draft,operationId)).rejects.toMatchObject({code:'access_denied'});
 await expect(saveDraft(technical,command,pos.id,pos.version+1,{...draft,valor:'12'},crypto.randomUUID())).rejects.toMatchObject({code:'access_denied'});
 expect((await loadAuthorizedContexts(technical)).some(c=>c.vinculoId===tc.vinculoId)).toBe(false);
 const after=await loadAdminCatalog(admin,cc);const district=after.scopes.find(s=>s.codigo==='DEMO-T12-DISTRICT')!;
 await saveDemoScope(admin,cc,tc.escopoId,1,{codigo:'ACADEMIC-NORTE-1',tipo:'unidade',distritoId:district.id,ativo:false},crypto.randomUUID());
 const audit=await loadAudit(admin,cc,{page:1,pageSize:100});expect(audit.items.some(a=>a.action==='vinculo_demo_alterado'&&a.version===2)).toBe(true);expect(audit.items.every(a=>a.reason===null)).toBe(true);
 await page.getByRole('button',{name:'Histórico',exact:true}).click();await expect(page.getByText(/vinculo_demo_alterado/)).toBeVisible();
 for(const client of [admin,technical,cam,manager])await client.auth.signOut();
});
