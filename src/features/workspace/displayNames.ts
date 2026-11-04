import type { CompetenceState, CycleChecklist, Role } from '../pilot/types';

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

export const publicationLabels: Readonly<Record<CycleChecklist['publication'], string>> = {
  nao_publicada: 'Não publicada', publicada_demo: 'Publicada na demonstração',
};

// History lines (§4.7): the verb of each audited action and the role that performs it.
export const auditActions: Readonly<Record<string, { verb: string; role: Role }>> = {
  rascunho_salvo: { verb: 'Salvou rascunho de', role: 'area_tecnica' },
  posicao_enviada: { verb: 'Enviou', role: 'area_tecnica' },
  posicao_corrigida: { verb: 'Corrigiu', role: 'area_tecnica' },
  posicao_em_revisao: { verb: 'Iniciou a conferência de', role: 'revisor_tecnico' },
  posicao_validada: { verb: 'Aceitou', role: 'revisor_tecnico' },
  posicao_devolvida: { verb: 'Devolveu', role: 'revisor_tecnico' },
  retificacao_autorizada: { verb: 'Autorizou retificação de', role: 'cam' },
  indisponibilidade_decidida: { verb: 'Decidiu a indisponibilidade de', role: 'cam' },
  ciclo_em_consolidacao: { verb: 'Iniciou a consolidação do ciclo', role: 'cam' },
  ciclo_reaberto: { verb: 'Reabriu o ciclo', role: 'cam' },
  ciclo_fechado: { verb: 'Fechou o ciclo', role: 'cam' },
  ciclo_publicado_demo: { verb: 'Publicou a demonstração', role: 'cam' },
  escopo_demo_salvo: { verb: 'Salvou escopo', role: 'administrador' },
  vinculo_demo_alterado: { verb: 'Alterou vínculo', role: 'administrador' },
  competencia_demo_aberta: { verb: 'Abriu competência', role: 'administrador' },
  posicao_demo_reatribuida: { verb: 'Reatribuiu posição', role: 'administrador' },
  regra_demo_agendada: { verb: 'Agendou regra', role: 'administrador' },
};
