import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "../../src/features/pilot/types.ts";
import { academicId, academicScopes, demoIndicators, demoRuleSet } from './academicFixtures.ts';
import { assertLoopback, provisioner, seedV3States } from './academicDemo.ts';

// External evaluation (11/2026): each evaluator gets an isolated copy of the V3
// October demo: own districts, units, month and accounts. Closing a kit's
// month never touches another kit or the base demo. No administrator: its
// screens are global, so it stays with the team.
export const evaluatorRoles = ['area_tecnica','revisor_tecnico','cam','gestor_unidade','gestor_distrital','lideranca'] as const satisfies readonly Role[];
export type EvaluatorRole = typeof evaluatorRoles[number];
const logins: Record<EvaluatorRole,string> = { area_tecnica:'tecnica', revisor_tecnico:'revisor', cam:'cam', gestor_unidade:'gestor', gestor_distrital:'distrital', lideranca:'lideranca' };
export type EvaluatorKit = { kit: number; password: string };

const two = (kit: number) => String(kit).padStart(2,'0');
export const kitCode = (kit: number) => `AVAL${two(kit)}`;
export const evaluatorEmail = (role: EvaluatorRole, kit: number) => `${logins[role]}${two(kit)}@gratifiki.invalid`;
const kitId = (kit: number, n: number) => academicId(0x100000 + kit*0x1000 + n);

export function kitFixtures(kit: number) {
  const code = kitCode(kit);
  const index = (id: string) => academicScopes.findIndex(s=>s.id===id);
  const scopes = academicScopes.map((s,i)=>({ id: kitId(kit,i), codigo: s.codigo.replace(/^ACADEMIC/,code), tipo: s.tipo,
    distrito_id: s.distrito_id && kitId(kit,index(s.distrito_id)) }));
  const month = { id: kitId(kit,0x10), codigo: `${code}-V3-2026-10`, referencia: '2026-10-01', estado: 'aberta', modelo: 3, conjunto_id: demoRuleSet.id };
  return { scopes, month };
}

export function validateKits(kits: EvaluatorKit[]) {
  if (!kits.length || kits.some(k=>!Number.isInteger(k.kit) || k.kit<1 || k.kit>99 || typeof k.password!=='string' || k.password.length<8)
    || new Set(kits.map(k=>k.kit)).size!==kits.length) throw new Error('Evaluator kits need distinct numbers 1-99 and passwords of 8+ characters');
}

// Insert-only and re-runnable: an existing account keeps its password and a
// position an evaluator already touched is never driven again.
export async function bootstrapEvaluatorKits(client: SupabaseClient, kits: EvaluatorKit[]) {
  assertLoopback(client);
  validateKits(kits);
  const { insertOnly, ensureIdentity } = provisioner(client);
  const { data: set, error } = await client.from('conjuntos_regra').select('id').eq('id',demoRuleSet.id);
  if (error || set?.length!==1) throw new Error('Evaluator kits need the DEMO-v1 rule set');
  for (const { kit, password } of kits) {
    const { scopes, month } = kitFixtures(kit);
    const ids = {} as Record<EvaluatorRole,string>;
    for (const role of evaluatorRoles) ids[role] = await ensureIdentity({ email: evaluatorEmail(role,kit), password },`Avaliador ${kitCode(kit)} · ${role}`);
    await insertOnly('escopos',scopes.slice(0,2));
    await insertOnly('escopos',scopes.slice(2));
    await insertOnly('competencias',[month]);
    const units = scopes.filter(s=>s.tipo==='unidade');
    await insertOnly('territorios_competencia',units.map(s=>({competencia_id:month.id,unidade_id:s.id,distrito_id:s.distrito_id})),'competencia_id,unidade_id');
    const positions = units.flatMap((unit,u)=>demoIndicators.map((indicator,i)=>({ id: kitId(kit,0x100+u*4+i), competencia_id: month.id, indicador_id: indicator.id,
      alvo_id: unit.id, regra_id: indicator.regraId, informante_id: ids.area_tecnica, revisor_id: ids.revisor_tecnico })));
    await insertOnly('posicoes_esperadas',positions);
    const links: Record<string,string>[] = [];
    const link = (role: EvaluatorRole, scope: string) => { for (const indicator of demoIndicators) links.push({ actor_id: ids[role], papel: role, escopo_id: scope, indicador_id: indicator.id, vigencia_inicio: '2026-01-01' }); };
    for (const unit of units) { link('area_tecnica',unit.id); link('revisor_tecnico',unit.id); link('cam',unit.id); }
    link('gestor_unidade',units[0].id);   // Unidade Alfa
    link('gestor_distrital',scopes[0].id); // Distrito Norte
    link('lideranca',scopes[0].id); link('lideranca',scopes[1].id);
    await insertOnly('vinculos',links,'actor_id,papel,escopo_id,indicador_id');
    const who = (role: EvaluatorRole) => ({ email: evaluatorEmail(role,kit), password, id: ids[role] });
    const technical = who('area_tecnica'), reviewer = who('revisor_tecnico');
    // Same October starting point as the base demo (octoberPlan), one técnico/revisor per kit.
    await seedV3States(client,{ technical, reviewer, southTechnical: technical, southReviewer: reviewer, cam: who('cam') },
      [{ month, positions }], new Set(scopes.map(s=>s.id)), scopeId => academicScopes[scopes.findIndex(s=>s.id===scopeId)].codigo);
  }
}
