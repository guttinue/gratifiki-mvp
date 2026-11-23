import type { CompetenceState, CycleChecklist, EntryStatus, PositionSummary, Role } from '../pilot/types';

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

// Evaluator kits (AVAL01-NORTE-1...) reuse the same friendly names.
export const scopeName = (code: string) => unitDisplayNames[code.replace(/^AVAL\d+-/, 'ACADEMIC-')] ?? code;

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

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
  snapshot_exportado_demo: { verb: 'Exportou o snapshot', role: 'cam' },
};

// V4 tones (spec §4.1.1): they color badges, dots and bars.
export type Tone = 'neutral' | 'info' | 'warn' | 'vio' | 'bad' | 'ok';

export const statusTones: Readonly<Record<EntryStatus | 'ausente', Tone>> = {
  ausente: 'neutral', rascunho: 'info', enviada: 'warn', em_revisao: 'vio', devolvida: 'bad', validada: 'ok', invalidada: 'neutral',
};

export const stateTones: Readonly<Record<CompetenceState, Tone>> = {
  aberta: 'info', em_consolidacao: 'warn', em_revisao: 'warn', fechada: 'vio', invalidada: 'neutral',
};

export const blockerReasons: Readonly<Record<'ausente' | 'rascunho' | 'enviada' | 'em_revisao' | 'devolvida', string>> = {
  ausente: 'Não enviado pela área técnica', rascunho: 'Rascunho ainda não enviado', enviada: 'Aguardando o revisor técnico',
  em_revisao: 'Em conferência pelo revisor', devolvida: 'Devolvida, aguardando correção',
};

// History filter (§5.1). An action outside every category shows only under "Todos".
export const auditCategories: readonly { id: 'todos' | 'envio' | 'conferencia' | 'ciclo' | 'cadastro' | 'exportacao'; label: string; actions: readonly string[] | null }[] = [
  { id: 'todos', label: 'Todos os eventos', actions: null },
  { id: 'envio', label: 'Envios e rascunhos', actions: ['rascunho_salvo', 'posicao_enviada', 'posicao_corrigida'] },
  { id: 'conferencia', label: 'Conferência', actions: ['posicao_em_revisao', 'posicao_validada', 'posicao_devolvida'] },
  { id: 'ciclo', label: 'Ciclo da competência', actions: ['ciclo_em_consolidacao', 'ciclo_reaberto', 'ciclo_fechado', 'ciclo_publicado_demo', 'retificacao_autorizada', 'indisponibilidade_decidida'] },
  { id: 'cadastro', label: 'Cadastros', actions: ['escopo_demo_salvo', 'vinculo_demo_alterado', 'competencia_demo_aberta', 'posicao_demo_reatribuida', 'regra_demo_agendada'] },
  { id: 'exportacao', label: 'Exportações', actions: ['snapshot_exportado_demo'] },
];

export function countByStatus(rows: readonly { position: PositionSummary }[]) {
  const counts = { ausente: 0, rascunho: 0, enviada: 0, em_revisao: 0, devolvida: 0, validada: 0, invalidada: 0, total: rows.length };
  for (const { position } of rows) counts[position.status] += 1;
  return counts;
}
