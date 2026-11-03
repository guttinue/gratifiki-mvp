import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { decodeLeadershipOverview, loadLeadershipOverview } from './leadershipApi';

const context = { vinculoId: 'link', competenciaId: 'month', indicadorId: 'indicator' };
const overview = { acceptedPercent: '68.75', mode: 'zero',
  districts: [{ districtCode: 'ACADEMIC-NORTE', average: null, completeUnits: 0, totalUnits: 2 }, { districtCode: 'ACADEMIC-SUL', average: '84.46', completeUnits: 2, totalUnits: 2 }],
  attention: [{ unitCode: 'ACADEMIC-NORTE-1', pending: 3 }, { unitCode: 'ACADEMIC-NORTE-2', pending: 2 }] };

describe('model-3 leadership boundary', () => {
  it('accepts the valid example', () => {
    expect(decodeLeadershipOverview(overview)).toEqual(overview);
  });
  it.each([
    ['a numeric average', { ...overview, districts: [overview.districts[0], { ...overview.districts[1], average: 84.46 }] }],
    ['a numeric accepted percentage', { ...overview, acceptedPercent: 68.75 }],
    ['an average without complete units', { ...overview, districts: [{ ...overview.districts[0], average: '10.00' }] }],
    ['more complete than total units', { ...overview, districts: [{ ...overview.districts[1], completeUnits: 3 }] }],
    ['an attention row without pending items', { ...overview, attention: [{ unitCode: 'ACADEMIC-NORTE-1', pending: 0 }] }],
    ['an individual value', { ...overview, attention: [{ unitCode: 'ACADEMIC-NORTE-1', pending: 3, points: '20' }] }],
    ['a model-2 aggregate array', []],
    ['an unknown absence mode', { ...overview, mode: 'misto' }],
    ['a missing absence mode', { ...overview, mode: undefined }],
  ])('rejects %s', (_label, value) => {
    expect(() => decodeLeadershipOverview(value)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });
  it('reads get_leadership_aggregates with only the command context', async () => {
    const client = createClient('http://127.0.0.1:54321', 'public-test-key', { auth: { persistSession: false, storageKey: crypto.randomUUID() },
      global: { fetch: async (url, init) => {
        expect(String(url)).toContain('/rpc/get_leadership_aggregates');
        expect(JSON.parse(String(init?.body))).toEqual({ p_contexto: context });
        return new Response(JSON.stringify(overview), { headers: { 'content-type': 'application/json' } });
      } } });
    expect(await loadLeadershipOverview(client, context)).toEqual(overview);
  });
});
