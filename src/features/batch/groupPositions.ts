import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthorizedContext, ContextGroup, EntryStatus, PositionSummary } from '../pilot/types';
import { toCommandContext } from '../context/contextApi';
import { listPositions } from '../submission/positionApi';

// A model-3 group spans one context per indicator. Each read and command still
// carries a single context, so every position keeps the context that listed it.
export type GroupPosition = { position: PositionSummary; context: AuthorizedContext };

async function listContext(client: SupabaseClient, context: AuthorizedContext): Promise<GroupPosition[]> {
  const rows: GroupPosition[] = [];
  for (let page = 1; ; page++) {
    const loaded = await listPositions(client, toCommandContext(context), { page, pageSize: 100 });
    rows.push(...loaded.items.map(position => ({ position, context })));
    if (!loaded.items.length || rows.length >= loaded.total) return rows;
  }
}

export async function loadGroupPositions(client: SupabaseClient, group: ContextGroup): Promise<GroupPosition[]> {
  const rows = new Map<string, GroupPosition>();
  for (const list of await Promise.all(group.contexts.map(context => listContext(client, context)))) {
    for (const row of list) if (!rows.has(row.position.id)) rows.set(row.position.id, row);
  }
  return [...rows.values()];
}

// The contexts allowed to read one unit's batch: the distinct contexts that listed a position of that unit.
export const unitContexts = (rows: GroupPosition[], unitId: string): AuthorizedContext[] =>
  [...new Map(rows.filter(row => row.position.escopoId === unitId).map(row => [row.context.key, row.context])).values()];

export const statusLabels: Record<EntryStatus | 'ausente', string> = { ausente: 'Não enviado', rascunho: 'Rascunho', devolvida: 'Devolvida',
  enviada: 'Aguardando conferência', em_revisao: 'Em conferência', validada: 'Aceita', invalidada: 'Invalidada' };
