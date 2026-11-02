import { expect, it } from 'vitest';
import { academicPageFromHash, getAcademicDestinations } from './academicNavigation';
import type { Role } from '../pilot/types';

const pair = (id: string, label: string) => [id, label];
it.each([
  ['area_tecnica', [pair('painel', 'Painel'), pair('preenchimento', 'Preenchimento'), pair('historico', 'Histórico')]],
  ['revisor_tecnico', [pair('painel', 'Painel'), pair('conferencia', 'Conferência'), pair('historico', 'Histórico')]],
  ['cam', [pair('painel', 'Painel'), pair('ciclo', 'Ciclo e fechamento'), pair('resultados', 'Resultados'),
    pair('entradas', 'Todas as entradas'), pair('historico', 'Auditoria')]],
  ['gestor_unidade', [pair('painel', 'Painel'), pair('resultados', 'Resultados'), pair('historico', 'Histórico')]],
  ['gestor_distrital', [pair('painel', 'Painel'), pair('resultados', 'Resultados'), pair('historico', 'Histórico')]],
  ['lideranca', [pair('painel', 'Painel')]],
  ['administrador', [pair('painel', 'Painel'), pair('regras', 'Indicadores e regras'),
    pair('vinculos', 'Usuários e vínculos'), pair('historico', 'Auditoria')]],
] as const)('lists the V3 destinations for %s', (role: Role, expected) => {
  expect(getAcademicDestinations(role).map(d => [d.id, d.label])).toEqual(expected);
});
it('falls back to painel for unknown or forged destinations', () => {
  expect(academicPageFromHash('cam', '#academico/inexistente')).toBe('painel');
  expect(academicPageFromHash('gestor_unidade', '#academico/cadastros')).toBe('painel');
  expect(academicPageFromHash('lideranca', '#academico/historico')).toBe('painel');
});
