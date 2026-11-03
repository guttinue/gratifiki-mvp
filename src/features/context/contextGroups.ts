import type { AuthorizedContext, ContextGroup } from "../pilot/types";

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Groups the contexts of one actor by role, competence and scope. This only
// shapes the screens: every read and command still carries one context and is
// authorized by the server for that context alone.
export function groupContexts(contexts: AuthorizedContext[]): ContextGroup[] {
  const groups = new Map<string, ContextGroup>();
  for (const context of contexts) {
    const key = `${context.role}:${context.competenciaId}:${context.escopoId}`;
    const group = groups.get(key);
    if (group) group.contexts.push(context);
    else groups.set(key, {
      key, role: context.role, modelo: context.modelo, competenciaId: context.competenciaId,
      competenciaCodigo: context.competenciaCodigo, escopoId: context.escopoId,
      escopoCodigo: context.escopoCodigo, contexts: [context],
    });
  }
  return [...groups.values()]
    .map((group) => ({ ...group, contexts: [...group.contexts].sort((a, b) => compare(a.indicadorId, b.indicadorId)) }))
    .sort((a, b) => compare(b.competenciaCodigo, a.competenciaCodigo) || compare(a.role, b.role)
      || compare(a.escopoCodigo, b.escopoCodigo));
}
