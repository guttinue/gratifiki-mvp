import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { academicCredential } from './e2eSupport';
import { chooseAcademicContext, loginAcademic } from './academicFlowSupport';
import { loadAuthorizedContexts, toCommandContext } from '../../src/features/context/contextApi';
import { listPositions } from '../../src/features/submission/positionApi';
test.use({trace:'off'});
test.skip(!process.env.ACADEMIC_AREA_TECNICA_EMAIL,'Requires protected isolated academic fixture');
// The technical list requests only the first page. That is complete because the
// backend scopes area_tecnica to one target per context and
// uq_posicoes_contexto allows one position per month/indicator/target. If that
// invariant ever changes, this guard fails instead of hiding positions.
test('each technical context shows every authorized position the server reports',async({page})=>{
 const technical=createClient(process.env.VITE_SUPABASE_URL!,process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 expect((await technical.auth.signInWithPassword(academicCredential('area_tecnica'))).error).toBeNull();
 const contexts=(await loadAuthorizedContexts(technical)).filter(c=>c.role==='area_tecnica'&&c.competenciaCodigo==='ACADEMIC-2026-10');
 expect(contexts.length).toBeGreaterThan(1);
 for(const [index,context] of contexts.entries()){
  const server=await listPositions(technical,toCommandContext(context),{page:1,pageSize:100});
  expect(server.total).toBe(server.items.length);
  expect(server.items.map(p=>p.escopoCodigo)).toEqual([context.escopoCodigo]);
  if(index===0)await loginAcademic(page,'area_tecnica','area_tecnica',context.escopoCodigo);
  else await chooseAcademicContext(page,'area_tecnica',context.escopoCodigo);
  const list=page.getByRole('region',{name:'Posições autorizadas'}).getByRole('listitem');
  await expect(list).toHaveCount(server.total);
  await expect(list.first()).toHaveText(`${context.escopoCodigo} · ${server.items[0].status}`);
  await list.first().getByRole('button').click();
  await expect(page.getByRole('heading',{name:context.escopoCodigo,exact:true})).toBeVisible();
  await expect(page.getByLabel('Fonte',{exact:true})).toBeVisible();
 }
 await technical.auth.signOut();
});
