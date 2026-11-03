import { createClient } from '@supabase/supabase-js';
import type { AuthorizedContext } from '../pilot/types';
import type { UnitResult, UnitResultItem, UnitResults } from './resultsApi';

// Test fixtures for model-3 reads: DEMO-v1 numbers where unit Alfa sums 93.42.
export const v3Context: AuthorizedContext = { key: 'v3-gestor', actorId: 'actor', role: 'gestor_unidade', vinculoId: 'link', competenciaId: 'month',
  indicadorId: 'indicator', escopoId: 'alfa', escopoCodigo: 'ACADEMIC-NORTE-1', competenciaCodigo: 'ACADEMIC-V3-2026-10', mode: 'academic', modelo: 3 };
const base = { direction: 'maior_melhor' as const, reviewStatus: 'valor' as const, state: 'valor' as const };
export const acceptedItems: UnitResultItem[] = [
  { ...base, indicatorCode: 'DEMO-V1-01', name: 'Registros conferidos', inputValue: '90', meta: '95', weight: '30', effectiveWeight: '30', points: '28.42', expression: 'min(90 ÷ 95; 1) × 30' },
  { ...base, indicatorCode: 'DEMO-V1-02', name: 'Rotinas concluídas', inputValue: '20', meta: '20', weight: '25', effectiveWeight: '25', points: '25', expression: 'min(20 ÷ 20; 1) × 25' },
  { ...base, direction: 'menor_melhor', indicatorCode: 'DEMO-V1-03', name: 'Tempo de resposta', inputValue: '60', meta: '48', weight: '25', effectiveWeight: '25', points: '20', expression: 'min(48 ÷ 60; 1) × 25' },
  { ...base, indicatorCode: 'DEMO-V1-04', name: 'Verificações realizadas', inputValue: '12', meta: '12', weight: '20', effectiveWeight: '20', points: '20', expression: 'min(12 ÷ 12; 1) × 20' },
];
export const pendingItem: UnitResultItem = { indicatorCode: 'DEMO-V1-01', name: 'Registros conferidos', state: 'pendente', inputValue: null, meta: '95',
  direction: 'maior_melhor', weight: '30', effectiveWeight: '30', points: null, expression: null, reviewStatus: 'sem_envio' };
export const completeUnit: UnitResult = { unitId: 'alfa', unitCode: 'ACADEMIC-NORTE-1', districtCode: 'ACADEMIC-NORTE', points: '93.42', complete: true, noBase: false,
  partial: false, previous: { points: '88.62', competencia: 'ACADEMIC-V3-2026-09' }, delta: '4.80', items: acceptedItems };
export const partialUnit: UnitResult = { unitId: 'beta', unitCode: 'ACADEMIC-NORTE-2', districtCode: 'ACADEMIC-NORTE', points: '70', complete: false, noBase: false,
  partial: true, previous: { points: '92.51', competencia: 'ACADEMIC-V3-2026-09' }, delta: null, items: [pendingItem, ...acceptedItems.slice(1)] };
export const results = (...units: UnitResult[]): UnitResults => ({ competencia: 'ACADEMIC-V3-2026-10', state: 'aberta', publication: 'nao_publicada', units });
export function rpcClient(handler: (name: string, body: Record<string, unknown>) => unknown, status = 200) {
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  const client = createClient('http://localhost:54321', 'key', { auth: { persistSession: false, storageKey: crypto.randomUUID() },
    global: { fetch: async (url, init) => {
      const name = String(url).split('/rpc/')[1] ?? String(url);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push({ name, body });
      return new Response(JSON.stringify(handler(name, body)), { status, headers: { 'content-type': 'application/json' } });
    } } });
  return { client, calls };
}
