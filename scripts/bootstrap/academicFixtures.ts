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
