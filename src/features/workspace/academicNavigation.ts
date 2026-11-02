import type { Role } from '../pilot/types';

export type AcademicDestination = { id: string; label: string };
const painel = { id: 'painel', label: 'Painel' };
const managerDestinations = [painel, { id: 'resultados', label: 'Resultados' }, { id: 'historico', label: 'Histórico' }];
const destinations: Record<Role, AcademicDestination[]> = {
  area_tecnica: [painel, { id: 'preenchimento', label: 'Preenchimento' }, { id: 'historico', label: 'Histórico' }],
  revisor_tecnico: [painel, { id: 'conferencia', label: 'Conferência' }, { id: 'historico', label: 'Histórico' }],
  cam: [painel, { id: 'ciclo', label: 'Ciclo e fechamento' }, { id: 'resultados', label: 'Resultados' },
    { id: 'entradas', label: 'Todas as entradas' }, { id: 'historico', label: 'Auditoria' }],
  gestor_unidade: managerDestinations,
  gestor_distrital: managerDestinations,
  lideranca: [painel],
  administrador: [painel, { id: 'regras', label: 'Indicadores e regras' },
    { id: 'vinculos', label: 'Usuários e vínculos' }, { id: 'historico', label: 'Auditoria' }],
};

// Navigation is presentation, never authorization. Every mounted page still
// calls its own server-authorized boundary with the selected context.
export function getAcademicDestinations(role: Role): readonly AcademicDestination[] {
  return destinations[role];
}

export function academicPageFromHash(role: Role, hash: string): string {
  const destinations = getAcademicDestinations(role);
  const id = hash.replace(/^#academico\//, '');
  return destinations.find(destination => destination.id === id)?.id ?? destinations[0].id;
}

export function requestAcademicLeave(): boolean {
  return window.dispatchEvent(new Event('academic:beforeleave', { cancelable: true }));
}
