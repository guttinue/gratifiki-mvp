import type { Role } from "../../src/features/pilot/types.ts";
export const academicRoles: Role[] = ['area_tecnica','revisor_tecnico','cam','gestor_unidade','gestor_distrital','administrador','lideranca'];
// Reserved synthetic identifiers only; credentials are supplied at runtime.
export function academicId(n: number): string { return `acade000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`; }
export const academicIndicator = 'c0de0000-0000-4000-8000-000000000002';
export const academicRule = 'c0de0000-0000-4000-8000-000000000004';
export const academicMonths = [
  { id: academicId(1), codigo: 'ACADEMIC-2026-09', referencia: '2026-09-01', estado: 'aberta', modelo: 2 },
  { id: academicId(2), codigo: 'ACADEMIC-2026-10', referencia: '2026-10-01', estado: 'aberta', modelo: 2 },
];
// DEMO-v1 catalogue (migration 20261102104000_demo_v1_rule_set.sql). The
// legacy model-2 indicator keeps the code DEMO-01; model 3 uses DEMO-V1-0N.
function demoId(n: number): string { return `c0de0000-0000-4000-8000-0000000001${n.toString().padStart(2,'0')}`; }
export const demoRuleSet = { id: demoId(0), codigo: 'DEMO', versao: 1 };
export const demoIndicators = [
  { id: demoId(1), codigo: 'DEMO-V1-01', nome: 'Registros conferidos', regraId: demoId(11), peso: 30 },
  { id: demoId(2), codigo: 'DEMO-V1-02', nome: 'Rotinas concluídas', regraId: demoId(12), peso: 25 },
  { id: demoId(3), codigo: 'DEMO-V1-03', nome: 'Tempo de resposta', regraId: demoId(13), peso: 25 },
  { id: demoId(4), codigo: 'DEMO-V1-04', nome: 'Verificações realizadas', regraId: demoId(14), peso: 20 },
];
export const academicV3Months = [
  { id: academicId(3), codigo: 'ACADEMIC-V3-2026-09', referencia: '2026-09-01', estado: 'aberta', modelo: 3, conjunto_id: demoRuleSet.id },
  { id: academicId(4), codigo: 'ACADEMIC-V3-2026-10', referencia: '2026-10-01', estado: 'aberta', modelo: 3, conjunto_id: demoRuleSet.id },
];
export { unitDisplayNames } from '../../src/features/workspace/displayNames.ts';
// November is intentionally not opened: T13 owns future competence/rule commands.
export const academicScopes = [
  { id: academicId(10), codigo: 'ACADEMIC-NORTE', tipo: 'distrito', distrito_id: null },
  { id: academicId(11), codigo: 'ACADEMIC-SUL', tipo: 'distrito', distrito_id: null },
  { id: academicId(12), codigo: 'ACADEMIC-NORTE-1', tipo: 'unidade', distrito_id: academicId(10) },
  { id: academicId(13), codigo: 'ACADEMIC-NORTE-2', tipo: 'unidade', distrito_id: academicId(10) },
  { id: academicId(14), codigo: 'ACADEMIC-SUL-1', tipo: 'unidade', distrito_id: academicId(11) },
  { id: academicId(15), codigo: 'ACADEMIC-SUL-2', tipo: 'unidade', distrito_id: academicId(11) },
];
export type AcademicCredentials = Record<Role, { email: string; password: string }>;
export function secondaryCredentials(credentials: AcademicCredentials) {
  return { southTechnical: { ...credentials.area_tecnica, email: `south+${credentials.area_tecnica.email}` },
    southReviewer: { ...credentials.revisor_tecnico, email: `south+${credentials.revisor_tecnico.email}` },
    partialCam: { ...credentials.cam, email: `partial+${credentials.cam.email}` } };
}
