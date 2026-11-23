import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { Role } from '../../src/features/pilot/types';
import { roleLabels } from '../../src/features/workspace/displayNames';
import { evaluatorEmail, type EvaluatorKit, type EvaluatorRole } from '../../scripts/bootstrap/evaluatorKits';
import { indicatorRow, logoutAcademic, openAcademicPage } from './academicFlowSupport';

test.use({ trace: 'off' });
test.skip(!process.env.EVALUATOR_KITS, 'Requires the owned fixture with evaluator kits');

// What an external evaluator does with kit 1, only through the screens, then
// proof that kit 2 was not touched. Same October start as the base demo.
const kits = JSON.parse(process.env.EVALUATOR_KITS ?? '[]') as EvaluatorKit[];

async function login(page: Page, role: EvaluatorRole, kit = 1) {
  await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(evaluatorEmail(role, kit));
  await page.getByLabel('Senha', { exact: true }).fill(kits.find(k => k.kit === kit)!.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  // One month per kit: every role lands straight in it.
  await expect(page.locator('.academic-person')).toContainText(roleLabels[role as Role]);
}

async function review(page: Page, code: string, unit: string) {
  await page.getByRole('tab', { name: /^Para conferir \d/ }).click();
  await page.getByRole('row', { name: new RegExp(code) }).filter({ hasText: unit }).getByRole('button', { name: new RegExp(`^${unit}`) }).click();
  await page.getByRole('button', { name: 'Iniciar revisão', exact: true }).click();
  await expect(page.getByText('Conferência confirmada: em_revisao.')).toBeVisible();
  await page.getByLabel('Motivo da conferência').fill('Conferido pelo avaliador');
  await page.getByRole('button', { name: 'Aceitar evidência', exact: true }).click();
  await expect(page.getByText('Conferência confirmada: validada.')).toBeVisible();
}

test('an evaluator runs the whole month in kit 1 and kit 2 stays untouched', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });

  // Área técnica: finishes Alfa (01 and the returned 03), then Beta 02.
  await login(page, 'area_tecnica');
  await openAcademicPage(page, 'Preenchimento');
  await indicatorRow(page, 'DEMO-V1-01').getByLabel('Valor apurado').fill('90');
  const returned = indicatorRow(page, 'DEMO-V1-03');
  await expect(returned).toContainText('Devolvida pelo revisor técnico.');
  await returned.getByLabel('Valor apurado').fill('40');
  await returned.getByLabel('Fonte do dado').fill('Relatório de outubro');
  await returned.getByLabel('O que você corrigiu?').fill('Usei o relatório de outubro.');
  await page.getByRole('button', { name: 'Enviar 2 itens', exact: true }).click();
  await expect(page.getByText('2 itens enviados')).toBeVisible();
  await page.getByRole('tab', { name: /^Unidade Beta/ }).click();
  const routine = indicatorRow(page, 'DEMO-V1-02');
  await routine.getByLabel('Valor apurado').fill('20');
  await routine.getByLabel('Fonte do dado').fill('Painel de rotinas');
  await page.getByRole('button', { name: 'Enviar 1 item', exact: true }).click();
  await expect(page.getByText('1 item enviado')).toBeVisible();
  await logoutAcademic(page);

  // Revisor: accepts everything waiting, including Beta 01 already in review.
  await login(page, 'revisor_tecnico');
  await openAcademicPage(page, 'Conferência');
  for (const code of ['DEMO-V1-01', 'DEMO-V1-02', 'DEMO-V1-03']) await review(page, code, 'Unidade Alfa');
  await review(page, 'DEMO-V1-02', 'Unidade Beta');
  await page.getByRole('tab', { name: /^Em conferência \d/ }).click();
  await page.getByRole('button', { name: 'Aceitar Unidade Beta DEMO-V1-01', exact: true }).click();
  await expect(page.getByText('Conferência confirmada: validada.')).toBeVisible();
  await logoutAcademic(page);

  // CAM: closes and publishes kit 1's October, then downloads the CSV.
  await login(page, 'cam');
  await openAcademicPage(page, 'Ciclo e fechamento');
  await expect(page.getByText('16 de 16 prontas')).toBeVisible();
  await page.getByRole('button', { name: 'Iniciar consolidação', exact: true }).click();
  await page.getByLabel('Referência do ciclo').fill('DEMO-DECISAO-AVAL01');
  await page.getByRole('button', { name: 'Fechar ciclo', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar fechamento', exact: true }).click();
  await expect(page.getByText('Situação do ciclo: Fechada')).toBeVisible();
  await page.getByLabel('Referência do ciclo').fill('DEMO-PUBLICACAO-AVAL01');
  await page.getByRole('button', { name: 'Publicar demonstração', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar publicação', exact: true }).click();
  await expect(page.getByText('Publicação: Publicada na demonstração')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar CSV', exact: true }).click();
  const csv = readFileSync((await (await download).path())!, 'utf8');
  expect(csv).toContain('AVAL01-NORTE-1');
  expect(csv).not.toContain('AVAL02');
  await logoutAcademic(page);

  // Gestores and liderança see kit 1's frozen results with the friendly names.
  await login(page, 'gestor_unidade');
  await expect(page.locator('.v3-score')).toContainText('93,42');
  await expect(page.getByText('Unidade Alfa').first()).toBeVisible();
  await page.getByRole('row', { name: /DEMO-V1-01/ }).getByRole('button', { name: 'Como foi calculado?' }).click();
  await expect(page.getByText('min(90 ÷ 95; 1) × 30')).toBeVisible();
  await logoutAcademic(page);
  await login(page, 'gestor_distrital');
  await expect(page.getByText('Unidade Beta').first()).toBeVisible();
  await logoutAcademic(page);
  await login(page, 'lideranca');
  const district = (name: string) => page.getByRole('region', { name: 'Médias por distrito' }).getByRole('article').filter({ hasText: name });
  await expect(district('Distrito Norte')).toContainText('95,05');
  await expect(district('Distrito Sul')).toContainText('84,46');
  await logoutAcademic(page);

  // Kit 2 still has its own open October with the same starting work.
  await login(page, 'cam', 2);
  await openAcademicPage(page, 'Ciclo e fechamento');
  await expect(page.getByText('Situação do ciclo: Aberta')).toBeVisible();
  await expect(page.getByText('16 de 16 prontas')).toHaveCount(0);
  await logoutAcademic(page);
  await login(page, 'area_tecnica', 2);
  await openAcademicPage(page, 'Preenchimento');
  await expect(indicatorRow(page, 'DEMO-V1-03')).toContainText('Devolvida pelo revisor técnico.');
  await logoutAcademic(page);

  expect(errors).toEqual([]);
});
