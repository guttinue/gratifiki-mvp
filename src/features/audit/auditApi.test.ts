import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { loadAudit, mergeAuditPages } from './auditApi';

it('merges context pages once each, newest first, and flags older events', () => {
  const e = (id: string, at: string) => ({ id, occurredAt: at, action: 'posicao_enviada', resourceId: 'p', version: 1, reason: null });
  const merged = mergeAuditPages([
    { items: [e('a', '2026-10-01T10:00:00Z'), e('b', '2026-10-02T10:00:00Z')], total: 2, page: 1, pageSize: 100 },
    { items: [e('b', '2026-10-02T10:00:00Z'), e('c', '2026-10-03T10:00:00Z')], total: 140, page: 1, pageSize: 100 },
  ]);
  expect(merged.items.map(i => i.id)).toEqual(['c', 'b', 'a']);
  expect(merged.truncated).toBe(true);
});

// CAM-04: the model-3 CAM audit answered 200 with a draft whose reason is an
// empty string; the decoder rejected it and the page showed the read error.
it('reads an event saved without a reason as having no reason', async () => {
  const body = { items: [
    { id: 'draft', occurredAt: '2026-10-20T12:00:00Z', action: 'rascunho_salvo', resourceId: 'p', version: 1, reason: '' },
    { id: 'sent', occurredAt: '2026-10-21T12:00:00Z', action: 'posicao_enviada', resourceId: 'p', version: 2, reason: 'Fonte conferida' },
  ], total: 2, page: 1, pageSize: 100 };
  const client = createClient('http://localhost:54321', 'key', { auth: { persistSession: false, storageKey: crypto.randomUUID() },
    global: { fetch: async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }) } });
  const page = await loadAudit(client, { vinculoId: 'v', competenciaId: 'c', indicadorId: 'i' }, { page: 1, pageSize: 100 });
  expect(page.items.map(i => i.reason)).toEqual([null, 'Fonte conferida']);
});
