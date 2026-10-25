import type { Role } from '../pilot/types';

export type AcademicDestination = { id: string; label: string };
const primary: Record<Role, AcademicDestination> = {
  area_tecnica: { id: 'preenchimento', label: 'Preenchimento' },
  revisor_tecnico: { id: 'conferencia', label: 'Conferência' },
  cam: { id: 'ciclo', label: 'Ciclo e evidências' },
  gestor_unidade: { id: 'avaliacoes', label: 'Avaliações' },
  gestor_distrital: { id: 'avaliacoes', label: 'Avaliações' },
  administrador: { id: 'cadastros', label: 'Contexto administrativo' },
  lideranca: { id: 'agregados', label: 'Agregados' },
};

// Navigation is presentation, never authorization. Every mounted page still
// calls its own server-authorized boundary with the selected context.
export function getAcademicDestinations(role: Role): readonly AcademicDestination[] {
  return [primary[role],
    ...(['area_tecnica', 'revisor_tecnico', 'cam', 'lideranca'].includes(role)
      ? [{ id: 'painel', label: 'Painel' }] : []),
    ...(role !== 'lideranca' ? [{ id: 'historico', label: 'Histórico' }] : []),
  ];
}

export function academicPageFromHash(role: Role, hash: string): string {
  const destinations = getAcademicDestinations(role);
  const id = hash.replace(/^#academico\//, '');
  return destinations.find(destination => destination.id === id)?.id ?? destinations[0].id;
}

export function requestAcademicLeave(): boolean {
  return window.dispatchEvent(new Event('academic:beforeleave', { cancelable: true }));
}
