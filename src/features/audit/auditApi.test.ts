import { createClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { auditDay, loadAudit, loadGroupAudit, mergeAuditPages } from './auditApi';
import { groupContexts } from '../context/contextGroups';
import type { AuthorizedContext } from '../pilot/types';

it('merges context pages once each, newest first, and flags older events', () => {
  const e = (id: string, at: string) => ({ id, occurredAt: at, action: 'posicao_enviada', resourceId: 'p', version: 1, reason: null });
  const merged = mergeAuditPages([
    { items: [e('a', '2026-10-01T10:00:00Z'), e('b', '2026-10-02T10:00:00Z')], total: 2, page: 1, pageSize: 100 },
    { items: [e('b', '2026-10-02T10:00:00Z'), e('c', '2026-10-03T10:00:00Z')], total: 140, page: 1, pageSize: 100 },
  ]);
  expect(merged.items.map(i => i.id)).toEqual(['c', 'b', 'a']);
  expect(merged.truncated).toBe(true);
});

// CAM-04: the model-3 CAM audit answered 200 with an acceptance whose reason is an
// empty string (review commands btrim the reason); the decoder rejected it.
it('reads an event saved without a reason as having no reason', async () => {
  const body = { items: [
    { id: 'accepted', occurredAt: '2026-10-20T12:00:00Z', action: 'posicao_validada', resourceId: 'p', version: 1, reason: '' },
    { id: 'sent', occurredAt: '2026-10-21T12:00:00Z', action: 'posicao_enviada', resourceId: 'p', version: 2, reason: 'Fonte conferida' },
  ], total: 2, page: 1, pageSize: 100 };
  const client = createClient('http://localhost:54321', 'key', { auth: { persistSession: false, storageKey: crypto.randomUUID() },
    global: { fetch: async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }) } });
  const page = await loadAudit(client, { vinculoId: 'v', competenciaId: 'c', indicadorId: 'i' }, { page: 1, pageSize: 100 });
  expect(page.items.map(i => i.reason)).toEqual([null, 'Fonte conferida']);
});

it('labels days in Recife time and marks today', () => {
  const now = new Date('2026-11-17T15:00:00Z');
  expect(auditDay('2026-11-17T02:30:00Z', now)).toBe('segunda, 16/11'); // 23h30 in Recife
  expect(auditDay('2026-11-17T12:00:00Z', now)).toBe('Hoje · terça, 17/11');
});

it('loadGroupAudit reads every context once and names targets only for operational roles', async () => {
  const position = { id: 'pos-alfa-03', escopoId: 'alfa', escopoCodigo: 'ACADEMIC-NORTE-1', escopoTipo: 'unidade', aplicavel: true, status: 'devolvida', estadoDado: 'valor', version: 2, revisionId: 'rev', inputValue: '10', resultValue: null, indicatorCode: 'DEMO-V1-03', indicatorName: 'Rotinas concluídas' };
  const event = { id: 'returned', occurredAt: '2026-10-21T12:00:00Z', action: 'posicao_devolvida', resourceId: 'pos-alfa-03', version: 2, reason: 'fonte de setembro' };
  const calls: { name: string; indicadorId: string }[] = [];
  const client = createClient('http://localhost:54321', 'key', { auth: { persistSession: false, storageKey: crypto.randomUUID() }, global: { fetch: async (url, init) => {
    const name = String(url).split('/rpc/')[1]; const body = JSON.parse(String(init?.body)); calls.push({ name, indicadorId: body.p_contexto.indicadorId });
    const items = name === 'get_scoped_audit' ? [event] : body.p_contexto.indicadorId === 'indicator-2' ? [position] : [];
    return new Response(JSON.stringify({ items, total: items.length, page: 1, pageSize: 100 }), { headers: { 'content-type': 'application/json' } });
  } } });
  const ctx = (n: number, role: AuthorizedContext['role']): AuthorizedContext => ({ key: `v3-${n}`, actorId: 'a', role, vinculoId: `link-${n}`, competenciaId: 'c', indicadorId: `indicator-${n}`, escopoId: 's', escopoCodigo: 'ACADEMIC-NORTE-1', competenciaCodigo: 'ACADEMIC-V3-2026-10', mode: 'academic', modelo: 3 });
  const reviewer = await loadGroupAudit(client, groupContexts([ctx(1, 'revisor_tecnico'), ctx(2, 'revisor_tecnico')])[0]);
  expect(calls.filter(c => c.name === 'get_scoped_audit').map(c => c.indicadorId).sort()).toEqual(['indicator-1', 'indicator-2']);
  expect(reviewer.items.map(i => i.id)).toEqual(['returned']);
  expect(reviewer.targets.get('pos-alfa-03')).toBe('Unidade Alfa · DEMO-V1-03');
  calls.length = 0;
  await loadGroupAudit(client, groupContexts([ctx(1, 'gestor_unidade'), ctx(2, 'gestor_unidade')])[0]);
  expect(calls.filter(c => c.name === 'get_scoped_audit')).toHaveLength(2);
  expect(calls.some(c => c.name === 'get_operational_positions')).toBe(false);
});
