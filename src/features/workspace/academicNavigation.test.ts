import { expect, it } from 'vitest';
import { academicPageFromHash, getAcademicDestinations } from './academicNavigation';
import type { Role } from '../pilot/types';

it.each([
  ['area_tecnica', 'preenchimento'], ['revisor_tecnico', 'conferencia'],
  ['cam', 'ciclo'], ['gestor_unidade', 'avaliacoes'],
  ['gestor_distrital', 'avaliacoes'], ['administrador', 'cadastros'],
  ['lideranca', 'agregados'],
] as const)('uses only the %s primary journey and canonicalizes forged destinations', (role: Role, primary) => {
  expect(getAcademicDestinations(role)[0].id).toBe(primary);
  expect(academicPageFromHash(role, '#academico/not-authorized')).toBe(primary);
});
it('never gives leadership operational input, history or administrative navigation', () => {
  expect(getAcademicDestinations('lideranca').map(destination => destination.id)).toEqual(['agregados', 'painel']);
  expect(getAcademicDestinations('lideranca').map(destination => destination.id)).not.toContain('preenchimento');
  expect(academicPageFromHash('gestor_unidade', '#academico/cadastros')).toBe('avaliacoes');
});
