import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "../../src/features/pilot/types.ts";
import { academicId, academicIndicator, academicMonths, academicRoles, academicRule, academicScopes, secondaryCredentials, type AcademicCredentials } from './academicFixtures.ts';

function assertLoopback(client: SupabaseClient) {
  const raw: unknown = Reflect.get(client,'supabaseUrl');
  let url: URL;
  try { url = new URL(String(raw)); } catch { throw new Error('Academic bootstrap requires local loopback'); }
  if (url.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw new Error('Academic bootstrap requires local loopback');
}
// Credentials create missing synthetic users only. Re-running does not rotate
// existing credentials or overwrite mutable business/catalog state.
export async function bootstrapAcademicDemo(client: SupabaseClient, credentials: AcademicCredentials): Promise<{ actors: Record<Role, string> }> {
  assertLoopback(client);
  const secondary = secondaryCredentials(credentials);
  const allCredentials = [...academicRoles.map(role => credentials[role]),...Object.values(secondary)];
  if (allCredentials.some(c => !c || !/^[^\s@]+@[^\s@]+\.invalid$/i.test(c.email) || c.password.length<8)) throw new Error('Only synthetic .invalid identities with supplied passwords are allowed');
  if (new Set(allCredentials.map(c=>c.email.toLowerCase())).size!==allCredentials.length) throw new Error('Academic identities must be distinct');
  // Refuse incompatible roots; never rewrite a rule/version already in use.
  const { data: rule, error: rootError } = await client.from('regras').select('id,indicador_id,versao,fator').eq('id',academicRule).single();
  if (rootError || !rule || rule.indicador_id!==academicIndicator || rule.versao!==1 || String(rule.fator)!=='0.8') throw new Error('Academic synthetic rule roots missing or incompatible');
  async function insertOnly(table: string, rows: object[], conflict = 'id') {
    const { error } = await client.from(table).upsert(rows,{ onConflict: conflict, ignoreDuplicates: true });
    if (error) throw new Error(`Academic bootstrap could not initialize ${table}; existing state was not reset`);
  }
  const actors = {} as Record<Role,string>;
  async function ensureIdentity(c: { email: string; password: string }, label: string) {
    let existing: { id: string } | undefined;
    for (let page=1; ;page++) {
      const { data, error } = await client.auth.admin.listUsers({page,perPage:1000});
      if (error) throw new Error('Academic identities could not be inspected');
      existing = data.users.find(user=>user.email?.toLowerCase()===c.email.toLowerCase());
      if (existing || data.users.length<1000) break;
    }
    if (!existing) {
      const { data,error }=await client.auth.admin.createUser({email:c.email,password:c.password,email_confirm:true});
      if(error || !data.user) throw new Error('Academic identity could not be provisioned');
      existing=data.user;
    }
    await insertOnly('contas_demo',[{ator_id:existing.id,rotulo:label}],'ator_id');
    return existing.id;
  }
  for (const role of academicRoles) actors[role]=await ensureIdentity(credentials[role],`Conta acadêmica ${role}`);
  const southTechnical = await ensureIdentity(secondary.southTechnical,'Área técnica Sul / duplo vínculo');
  const southReviewer = await ensureIdentity(secondary.southReviewer,'Revisor Sul');
  const partialCam = await ensureIdentity(secondary.partialCam,'CAM com cobertura parcial');
  await insertOnly('escopos',academicScopes.slice(0,2));
  await insertOnly('escopos',academicScopes.slice(2));
  await insertOnly('competencias',academicMonths);
  const north = new Set([academicId(10),academicId(12),academicId(13)]);
  for (const [monthIndex,month] of academicMonths.entries()) {
    await insertOnly('territorios_competencia',academicScopes.filter(s=>s.tipo==='unidade').map(s=>({competencia_id:month.id,unidade_id:s.id,distrito_id:s.distrito_id})),'competencia_id,unidade_id');
    await insertOnly('posicoes_esperadas',academicScopes.map((scope,index)=>({id:academicId(100+monthIndex*10+index),competencia_id:month.id,indicador_id:academicIndicator,alvo_id:scope.id,regra_id:academicRule,
      informante_id:north.has(scope.id)?actors.area_tecnica:southTechnical,revisor_id:north.has(scope.id)?actors.revisor_tecnico:southReviewer})));
  }
  const links: {actor_id:string;papel:Role;escopo_id:string;indicador_id:string;vigencia_inicio:string}[]=[];
  function link(actor:string,role:Role,scope:string) { links.push({actor_id:actor,papel:role,escopo_id:scope,indicador_id:academicIndicator,vigencia_inicio:'2026-01-01'}); }
  for (const scope of academicScopes) {
    link(north.has(scope.id)?actors.area_tecnica:southTechnical,'area_tecnica',scope.id);
    link(north.has(scope.id)?actors.revisor_tecnico:southReviewer,'revisor_tecnico',scope.id);
    link(actors.cam,'cam',scope.id);
  }
  link(actors.gestor_unidade,'gestor_unidade',academicId(12));
  for (const role of ['gestor_distrital','administrador','lideranca'] as const) link(actors[role],role,academicId(10));
  link(partialCam,'cam',academicId(10));
  link(southTechnical,'cam',academicId(14));
  await insertOnly('vinculos',links,'actor_id,papel,escopo_id');
  return { actors };
}
