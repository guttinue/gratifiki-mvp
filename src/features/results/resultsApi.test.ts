import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { decodeRuleCatalog, decodeUnitResults, loadUnitResults } from './resultsApi';
import { loadRuleCatalog } from '../admin/adminApi';

const context = { vinculoId: 'link', competenciaId: 'month', indicadorId: 'indicator' };
function transport(value: unknown, rpc: string, status = 200) {
  return createClient('http://127.0.0.1:54321', 'public-test-key', { auth: { persistSession: false, storageKey: crypto.randomUUID() },
    global: { fetch: async (url, init) => {
      expect(String(url)).toContain(`/rpc/${rpc}`);
      expect(JSON.parse(String(init?.body))).toEqual({ p_contexto: context });
      return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    } } });
}
const accepted = { indicatorCode: 'DEMO-V1-04', name: 'Verificações realizadas', state: 'valor', inputValue: '12', meta: '12', direction: 'maior_melhor',
  weight: '20', effectiveWeight: '20', points: '20', expression: 'min(12 ÷ 12; 1) × 20', reviewStatus: 'valor' };
const pending = { indicatorCode: 'DEMO-V1-01', name: 'Registros conferidos', state: 'pendente', inputValue: null, meta: '95', direction: 'maior_melhor',
  weight: '30', effectiveWeight: '30', points: null, expression: null, reviewStatus: 'sem_envio' };
const unavailable = { indicatorCode: 'DEMO-V1-03', name: 'Tempo de resposta', state: 'indisponivel', inputValue: null, meta: '48', direction: 'menor_melhor',
  weight: '25', effectiveWeight: '25', points: '0', expression: null, reviewStatus: 'indisponivel' };
const partial = { unitId: 'alfa', unitCode: 'ACADEMIC-NORTE-1', districtCode: 'ACADEMIC-NORTE', points: '20', complete: false, noBase: false, partial: true,
  previous: { points: '88.62', competencia: 'ACADEMIC-V3-2026-09' }, delta: null, items: [pending, accepted] };
const complete = { unitId: 'delta', unitCode: 'ACADEMIC-SUL-2', districtCode: 'ACADEMIC-SUL', points: '69.87', complete: true, noBase: false, partial: false,
  previous: { points: '87.84', competencia: 'ACADEMIC-V3-2026-09' }, delta: '-17.97', items: [accepted, unavailable] };
const validResults = { competencia: 'ACADEMIC-V3-2026-10', state: 'aberta', publication: 'nao_publicada', units: [partial, complete] };
const catalog = { ruleSets: [{ id: 'set', code: 'DEMO', version: 1, mode: 'zero', synthetic: true, validFrom: '2026-09-01', reference: 'DEMO-v1 · regra fictícia acadêmica', inUse: true,
  items: [{ indicatorCode: 'DEMO-V1-03', name: 'Tempo de resposta', meta: '48', direction: 'menor_melhor', decimals: 2, maximum: '8760', unit: 'h', weight: '25' },
    { indicatorCode: 'DEMO-V1-02', name: 'Rotinas concluídas', meta: '20', direction: 'maior_melhor', decimals: 0, maximum: '999999', unit: null, weight: '75' }] }] };

describe('unit results boundary', () => {
  it('accepts the valid example, keeping decimals as text', () => {
    expect(decodeUnitResults(validResults)).toEqual(validResults);
  });
  it.each([
    ['numeric unit points', { ...validResults, units: [{ ...partial, points: 20 }] }],
    ['numeric item points', { ...validResults, units: [{ ...partial, items: [pending, { ...accepted, points: 20 }] }] }],
    ['numeric delta', { ...validResults, units: [{ ...complete, delta: -17.97 }] }],
    ['delta without two places', { ...validResults, units: [{ ...complete, delta: '-17.9' }] }],
    ['delta on a partial unit', { ...validResults, units: [{ ...partial, delta: '4.80' }] }],
    ['partial disagreeing with complete', { ...validResults, units: [{ ...partial, partial: false }] }],
    ['a pending item exposing its value', { ...validResults, units: [{ ...partial, items: [{ ...pending, inputValue: '90' }, accepted] }] }],
    ['an accepted item without expression', { ...validResults, units: [{ ...partial, items: [pending, { ...accepted, expression: null }] }] }],
    ['an unknown review status', { ...validResults, units: [{ ...partial, items: [{ ...pending, reviewStatus: 'rascunho' }, accepted] }] }],
    ['an unknown publication', { ...validResults, publication: 'preliminar' }],
    ['a person field', { ...validResults, units: [{ ...partial, actorId: 'someone' }] }],
  ])('rejects %s', (_label, value) => {
    expect(() => decodeUnitResults(value)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });
  it('reads get_unit_results with only the command context', async () => {
    expect(await loadUnitResults(transport(validResults, 'get_unit_results'), context)).toEqual(validResults);
  });
  it('maps a denied read to access_denied', async () => {
    await expect(loadUnitResults(transport({ code: '42501', message: 'access_denied' }, 'get_unit_results', 403), context)).rejects.toMatchObject({ code: 'access_denied' });
  });
});

describe('rule catalogue boundary', () => {
  it('accepts the valid example', () => {
    expect(decodeRuleCatalog(catalog)).toEqual(catalog);
  });
  it.each([
    ['numeric weight', { ruleSets: [{ ...catalog.ruleSets[0], items: [{ ...catalog.ruleSets[0].items[0], weight: 25 }] }] }],
    ['an unknown mode', { ruleSets: [{ ...catalog.ruleSets[0], mode: 'media' }] }],
    ['an evaluation value', { ruleSets: [{ ...catalog.ruleSets[0], items: [{ ...catalog.ruleSets[0].items[0], points: '25' }] }] }],
  ])('rejects %s', (_label, value) => {
    expect(() => decodeRuleCatalog(value)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });
  it('reads get_rule_catalog with only the command context', async () => {
    expect(await loadRuleCatalog(transport(catalog, 'get_rule_catalog'), context)).toEqual(catalog);
  });
});
