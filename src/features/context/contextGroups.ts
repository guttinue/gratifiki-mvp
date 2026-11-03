import type { AuthorizedContext, ContextGroup, Role } from "../pilot/types";

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const roleOrder: readonly Role[] = ['area_tecnica', 'revisor_tecnico', 'cam', 'gestor_unidade', 'gestor_distrital', 'administrador', 'lideranca'];

// Groups the contexts of one actor: model 3 by role and competence (one view
// over all its units), models 1 and 2 by role, competence and scope. This only
// shapes the screens: every read and command still carries one context and is
// authorized by the server for that context alone. The group's scope is just
// the first context's, never used to display or authorize the whole view.
export function groupContexts(contexts: AuthorizedContext[]): ContextGroup[] {
  const groups = new Map<string, ContextGroup>();
  for (const context of contexts) {
    const key = context.modelo === 3 ? `${context.role}:${context.competenciaId}`
      : `${context.role}:${context.competenciaId}:${context.escopoId}`;
    const group = groups.get(key);
    if (group) group.contexts.push(context);
    else groups.set(key, {
      key, role: context.role, modelo: context.modelo, competenciaId: context.competenciaId,
      competenciaCodigo: context.competenciaCodigo, escopoId: context.escopoId,
      escopoCodigo: context.escopoCodigo, contexts: [context],
    });
  }
  return [...groups.values()]
    .map((group) => {
      const sorted = [...group.contexts].sort((a, b) => (group.modelo === 3 ? compare(a.escopoCodigo, b.escopoCodigo) : 0)
        || compare(a.indicadorId, b.indicadorId));
      return { ...group, escopoId: sorted[0].escopoId, escopoCodigo: sorted[0].escopoCodigo, contexts: sorted };
    })
    .sort((a, b) => compare(b.competenciaCodigo, a.competenciaCodigo) || compare(a.role, b.role)
      || compare(a.escopoCodigo, b.escopoCodigo));
}

// The view opened without an explicit choice: the latest open model-3 month,
// else the latest model-3 month (ties by roleOrder); without model 3, only a
// single group opens by itself.
export function pickDefaultGroup(groups: readonly ContextGroup[]): ContextGroup | null {
  const academic = groups.filter((group) => group.modelo === 3);
  if (academic.length === 0) return groups.length === 1 ? groups[0] : null;
  const open = academic.filter((group) => group.contexts[0].competenciaEstado === 'aberta');
  return [...(open.length > 0 ? open : academic)].sort((a, b) => compare(b.competenciaCodigo, a.competenciaCodigo)
    || roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role))[0];
}
