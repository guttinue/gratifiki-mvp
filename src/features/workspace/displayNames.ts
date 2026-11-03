import type { CompetenceState, Role } from '../pilot/types';

// Presentation only: friendly V3 names for the synthetic academic scopes.
// Authorization and domain data keep using the scope codes.
export const unitDisplayNames: Readonly<Record<string, string>> = {
  'ACADEMIC-NORTE-1': 'Unidade Alfa',
  'ACADEMIC-NORTE-2': 'Unidade Beta',
  'ACADEMIC-SUL-1': 'Unidade Gama',
  'ACADEMIC-SUL-2': 'Unidade Delta',
  'ACADEMIC-NORTE': 'Distrito Norte',
  'ACADEMIC-SUL': 'Distrito Sul',
};

export const scopeName = (code: string) => unitDisplayNames[code] ?? code;

export function scopeSummary(codes: readonly string[]): string {
  const distinct = [...new Set(codes)];
  if (distinct.length > 2) return `${distinct.length} unidades`;
  return distinct.map(scopeName).join(' e ');
}

const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// Competence codes end in YYYY-MM (e.g. ACADEMIC-V3-2026-09).
export const monthName = (competencia: string) => months[Number(/-(\d{2})$/.exec(competencia)?.[1]) - 1] ?? 'mês anterior';

export function competenceLabel(competencia: string): string {
  const match = /(\d{4})-(\d{2})$/.exec(competencia);
  const month = match && months[Number(match[2]) - 1];
  return month ? `${month.replace(/^./, (letter) => letter.toUpperCase())}/${match[1]}` : competencia;
}

export const roleLabels: Readonly<Record<Role, string>> = {
  area_tecnica: 'Área técnica', revisor_tecnico: 'Revisor técnico', cam: 'CAM', gestor_unidade: 'Gestor de unidade',
  gestor_distrital: 'Gestor distrital', administrador: 'Administrador', lideranca: 'Liderança',
};

export const competenceStateLabels: Readonly<Record<CompetenceState, string>> = {
  aberta: 'Aberta', em_revisao: 'Em revisão', em_consolidacao: 'Em consolidação', fechada: 'Fechada', invalidada: 'Invalidada',
};
