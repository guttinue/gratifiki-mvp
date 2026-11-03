import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { academicCredential } from './e2eSupport';
import { loginAcademic, openAcademicPage } from './academicFlowSupport';
import { loadAuthorizedContexts, toCommandContext } from '../../src/features/context/contextApi';
import { loadAdminCatalog, setDemoBusinessLink } from '../../src/features/admin/adminApi';
test.use({trace:'off'});
test.skip(!process.env.ACADEMIC_ADMINISTRADOR_EMAIL,'Requires protected isolated academic fixture');
async function signedIn(role:Parameters<typeof academicCredential>[0]){
 const c=createClient(process.env.VITE_SUPABASE_URL!,process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 expect((await c.auth.signInWithPassword(academicCredential(role))).error).toBeNull();return c;
}
async function selected(client:SupabaseClient,scope:string){return(await loadAuthorizedContexts(client)).find(c=>c.competenciaCodigo==='ACADEMIC-2026-10'&&c.escopoCodigo===scope)!;}
// I1: the backend already denies a revoked link; the open browser session must
// also drop what it loaded, without switching to another link by itself.
test('a link revoked during an open session removes its loaded detail and unsaved edit',async({page})=>{
 const admin=await signedIn('administrador'),technical=await signedIn('area_tecnica');
 const tc=await selected(technical,'ACADEMIC-NORTE-1');const ac=toCommandContext(await selected(admin,'ACADEMIC-NORTE'));
 await loginAcademic(page,'area_tecnica','area_tecnica','ACADEMIC-NORTE-1');
 await openAcademicPage(page,'Preenchimento');
 await page.getByRole('button',{name:'ACADEMIC-NORTE-1 · ausente',exact:true}).click();
 await page.getByLabel('Fonte',{exact:true}).fill('Fonte E2E não salva');
 await expect(page.getByRole('heading',{name:'ACADEMIC-NORTE-1',exact:true})).toBeVisible();
 const link=(await loadAdminCatalog(admin,ac)).links.find(l=>l.id===tc.vinculoId)!;
 await setDemoBusinessLink(admin,ac,link.actorId,link.version,{role:'area_tecnica',escopoId:link.escopoId,indicadorId:link.indicadorId,ativo:false,vigenciaInicio:link.vigenciaInicio,vigenciaFim:link.vigenciaFim},crypto.randomUUID());
 page.once('dialog',dialog=>void dialog.accept());
 await page.getByRole('button',{name:'Atualizar consulta',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('não está mais autorizado');
 await expect(page.getByRole('heading',{name:'Selecione seu contexto'})).toBeVisible();
 await expect(page.getByLabel('Contexto autorizado')).toHaveValue('');
 await expect(page.getByLabel('Contexto autorizado').locator('option',{hasText:'ACADEMIC-NORTE-1 · ACADEMIC-2026-10'})).toHaveCount(0);
 await expect(page.getByLabel('Fonte',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'ACADEMIC-NORTE-1',exact:true})).toHaveCount(0);
 for(const client of [admin,technical])await client.auth.signOut();
});
