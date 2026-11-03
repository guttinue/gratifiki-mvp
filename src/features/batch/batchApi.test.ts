import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { BatchCommandError, loadUnitBatch, submitUnitBatch, type BatchItem } from './batchApi';

const context = { vinculoId: 'link-1', competenciaId: 'month', indicadorId: 'indicator-1' };
const other = { vinculoId: 'link-3', competenciaId: 'month', indicadorId: 'indicator-3' };
const item = { positionId: 'position-1', indicatorCode: 'DEMO-V1-01', name: 'Registros conferidos', meta: '95', direction: 'maior_melhor', weight: '30',
  decimals: 2, max: '100', unit: '%', status: 'rascunho', version: 2, estadoDado: 'valor', valor: '90', fonte: 'Painel sintético', motivo: '',
  returnReason: null, revisionNumber: 1 };
const returned = { ...item, positionId: 'position-3', indicatorCode: 'DEMO-V1-03', name: 'Tempo de resposta', meta: '48', direction: 'menor_melhor', weight: '25',
  max: '8760', unit: 'h', status: 'devolvida', version: 5, valor: '96', returnReason: 'Confirme outubro.' };
const empty = { ...item, positionId: 'position-2', indicatorCode: 'DEMO-V1-02', status: 'ausente', version: 1, estadoDado: null, valor: null, fonte: null, motivo: null, revisionNumber: null };
const batch = { unitId: 'unit', unitCode: 'ACADEMIC-NORTE-1', items: [item, empty, returned] };
const input = { estadoDado: 'valor' as const, valor: '90,0', fonte: ' Painel ', periodoFonte: '2026-10-01', motivo: '' };
const items: BatchItem[] = [
  { context: { ...context, actorId: 'untrusted' } as typeof context, positionId: 'position-1', expectedVersion: 2, input, correction: null },
  { context: other, positionId: 'position-3', expectedVersion: 5, input: { ...input, valor: '40' }, correction: { explanation: ' Usei outubro. ' } },
];
const receipt = (id: string, version: number, resultValue: string) => ({ resourceId: id, version, revisionId: `rev-${id}`, status: 'enviada', resultValue });
const receipts = { items: [receipt('position-1', 4, '28.42'), receipt('position-3', 6, '25')] };

function transport(respond: (body: Record<string, unknown>) => Response) {
  return createClient('http://127.0.0.1:54321', 'public-test-key', { auth: { persistSession: false, storageKey: crypto.randomUUID() },
    global: { fetch: async (_url, init) => respond(JSON.parse(String(init?.body)) as Record<string, unknown>) } });
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const failure = (code: string, message: string, details: string | null = null) => transport(() => json({ code, message, details, hint: null }, 400));

describe('unit batch read', () => {
  it('sends only the command context fields and the unit, and decodes the exact batch', async () => {
    let sent: Record<string, unknown> = {};
    const result = await loadUnitBatch(transport(body => { sent = body; return json(batch); }), [{ ...context, actorId: 'untrusted' } as typeof context, other], 'unit');
    expect(sent).toEqual({ p_contextos: [context, other], p_unidade_id: 'unit' });
    expect(result).toEqual(batch);
  });
  it.each([
    { ...batch, extra: true },
    { ...batch, items: [{ ...item, meta: 95 }] },
    { ...batch, items: [{ ...item, status: 'pendente' }] },
    { ...batch, items: [{ ...item, person: 'someone' }] },
    { ...batch, items: [{ ...item, version: 0 }] },
    { ...batch, items: [item, item] },
  ])('rejects a malformed batch', async (value) => {
    await expect(loadUnitBatch(transport(() => json(value)), [context], 'unit')).rejects.toMatchObject({ code: 'invalid_input' });
  });
  it('maps a denied read', async () => {
    await expect(loadUnitBatch(failure('42501', 'access_denied'), [context], 'unit')).rejects.toMatchObject({ code: 'access_denied' });
  });
});

describe('unit batch submission', () => {
  it('sends canonical items under one operation and decodes every receipt', async () => {
    let sent: Record<string, unknown> = {};
    const result = await submitUnitBatch(transport(body => { sent = body; return json(receipts); }), items, 'operation');
    expect(sent).toEqual({ p_operation_id: 'operation', p_itens: [
      { contexto: context, positionId: 'position-1', expectedVersion: 2, input: { estadoDado: 'valor', valor: '90', fonte: 'Painel', periodoFonte: '2026-10-01', motivo: '' }, correction: null },
      { contexto: other, positionId: 'position-3', expectedVersion: 5, input: { estadoDado: 'valor', valor: '40', fonte: 'Painel', periodoFonte: '2026-10-01', motivo: '' }, correction: { explanation: 'Usei outubro.' } },
    ] });
    expect(result).toEqual(receipts.items);
  });
  it.each([
    { items: [receipts.items[0]] },
    { items: [receipts.items[0], receipt('position-9', 6, '25')] },
    { items: [receipts.items[0], { ...receipts.items[1], status: 'rascunho' }] },
    { items: [receipts.items[0], { ...receipts.items[1], resultValue: 25 }] },
    receipts.items,
  ])('rejects receipts that do not answer the submitted items', async (value) => {
    await expect(submitUnitBatch(transport(() => json(value)), items, 'operation')).rejects.toMatchObject({ code: 'invalid_input' });
  });
  it('maps an item failure to its position and code', async () => {
    const error = await submitUnitBatch(failure('22023', 'invalid_input', JSON.stringify({ positionId: 'position-3', code: 'invalid_state' })), items, 'operation').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BatchCommandError);
    expect(error).toMatchObject({ positionId: 'position-3', code: 'invalid_state', confirmedRejected: true });
  });
  it.each([
    ['42501', 'access_denied', null, 'access_denied'],
    ['40001', 'version_conflict', null, 'version_conflict'],
    ['22023', 'invalid_input', null, 'invalid_input'],
    ['22023', 'operation_payload_mismatch', null, 'operation_payload_mismatch'],
    ['22023', 'invalid_input', '{"positionId":"position-3","code":"invented"}', 'invalid_input'],
    ['22023', 'invalid_input', 'not json', 'invalid_input'],
  ])('maps %s %s without a position', async (code, message, details, expected) => {
    const error = await submitUnitBatch(failure(code, message, details), items, 'operation').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BatchCommandError);
    expect(error).toMatchObject({ code: expected, positionId: undefined });
  });
  it('keeps a lost response retryable', async () => {
    const client = transport(() => { throw new TypeError('network down'); });
    await expect(submitUnitBatch(client, items, 'operation')).rejects.toMatchObject({ code: 'network_error', confirmedRejected: false });
  });
});
