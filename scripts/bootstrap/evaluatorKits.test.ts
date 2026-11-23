// @vitest-environment node
import { expect, it } from 'vitest';
import { academicScopes } from './academicFixtures.ts';
import { evaluatorEmail, kitFixtures, validateKits } from './evaluatorKits.ts';

it('builds kits isolated from each other and from the base demo', () => {
  const one = kitFixtures(1), two = kitFixtures(2);
  const ids = [...one.scopes, one.month, ...two.scopes, two.month, ...academicScopes].map(s => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(one.scopes.map(s => s.codigo)).toEqual(['AVAL01-NORTE', 'AVAL01-SUL', 'AVAL01-NORTE-1', 'AVAL01-NORTE-2', 'AVAL01-SUL-1', 'AVAL01-SUL-2']);
  expect(one.scopes[2].distrito_id).toBe(one.scopes[0].id);
  expect(one.month.codigo).toBe('AVAL01-V3-2026-10');
  expect(evaluatorEmail('area_tecnica', 7)).toBe('tecnica07@gratifiki.invalid');
});

it('refuses repeated kits and weak passwords', () => {
  expect(() => validateKits([{ kit: 1, password: 'aval01-1' }, { kit: 1, password: 'aval01-2' }])).toThrow();
  expect(() => validateKits([{ kit: 1, password: 'short' }])).toThrow();
  expect(() => validateKits([{ kit: 1, password: 'aval01-0042' }, { kit: 15, password: 'aval15-9001' }])).not.toThrow();
});
