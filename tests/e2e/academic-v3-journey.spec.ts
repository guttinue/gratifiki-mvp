import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { indicatorRow, loginAcademic, logoutAcademic, openAcademicPage } from './academicFlowSupport';

test.use({ trace: 'off' });
test.skip(!process.env.ACADEMIC_CAM_EMAIL, 'Requires owned disposable academic fixture');

// V3 journey on the T7 seed (model 3, ACADEMIC-V3-2026-10, DEMO-v1 rule set).
// Nothing is intercepted: every read and write goes through the real API and SQL.
const MONTH = 'ACADEMIC-V3-2026-10';

// Model 3 lands each role directly in the month, with every unit of the role at once.
const login = (page: Page, identity: Parameters<typeof loginAcademic>[2]) => loginAcademic(page, identity, identity, undefined, MONTH);

async function review(page: Page, tab: string, code: string, unit: string) {
  await page.getByRole('tab', { name: new RegExp(`^${tab} \\d`) }).click();
  // Opening the row only shows the evidence; starting the review is its own click.
  await page.getByRole('row', { name: new RegExp(code) }).filter({ hasText: unit }).getByRole('button', { name: new RegExp(`^${unit}`) }).click();
  if (tab === 'Para conferir') {
    await page.getByRole('button', { name: 'Iniciar revisão', exact: true }).click();
    await expect(page.getByText('Conferência confirmada: em_revisao.')).toBeVisible();
  }
  await page.getByLabel('Motivo da conferência').fill('Conferência independente sintética');
  await page.getByRole('button', { name: 'Aceitar evidência', exact: true }).click();
  await expect(page.getByText('Conferência confirmada: validada.')).toBeVisible();
}

test('V3 journey: batch entry, one-at-a-time review, closure, publication, results and export', async ({ page }) => {
  test.setTimeout(240_000);
  const consoleErrors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`); });
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`));
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. The Norte technician fills Alfa: types 01 = 90, corrects the returned 03 = 40 and sends the batch.
  await login(page, 'area_tecnica');
  await openAcademicPage(page, 'Preenchimento');
  await indicatorRow(page, 'DEMO-V1-01').getByLabel('Valor apurado').fill('90');
  const returned = indicatorRow(page, 'DEMO-V1-03');
  await expect(returned).toContainText('Devolvida pelo revisor técnico.');
  await returned.getByLabel('Valor apurado').fill('40');
  await returned.getByLabel('Fonte do dado').fill('Relatório sintético de outubro');
  await returned.getByLabel('O que você corrigiu?').fill('Troquei o relatório de setembro pelo de outubro.');
  await expect(page.getByText('2 prontos para envio')).toBeVisible();
  // 9. At 375 px the filling screen does not scroll sideways (rows with a pending correction are the widest).
  await page.setViewportSize({ width: 375, height: 800 });
  const narrow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(narrow.scrollWidth, '375px: page scrollWidth').toBeLessThanOrEqual(narrow.innerWidth);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Enviar 2 itens', exact: true }).click();
  await expect(page.getByText('2 itens enviados')).toBeVisible();
  await logoutAcademic(page);

  // 2. The reviewer accepts Alfa 01, 02 and 03 one at a time, then Beta 01, which was already in review, from the same queue.
  await login(page, 'revisor_tecnico');
  await openAcademicPage(page, 'Conferência');
  for (const code of ['DEMO-V1-01', 'DEMO-V1-02', 'DEMO-V1-03']) await review(page, 'Para conferir', code, 'Unidade Alfa');
  // Alfa 01-04 plus Beta 03 and 04, accepted in the seed (octoberPlan).
  await expect(page.getByRole('tab', { name: /^Aceitas 6/ })).toBeVisible();
  // Beta 01 is accepted straight from its row: one accept command, no detail form.
  await page.getByRole('tab', { name: /^Em conferência \d/ }).click();
  await page.getByRole('button', { name: 'Aceitar Unidade Beta DEMO-V1-01', exact: true }).click();
  await expect(page.getByText('Conferência confirmada: validada.')).toBeVisible();
  await logoutAcademic(page);

  // 3. The technician sends Beta 02 = 20 and the reviewer accepts it.
  await login(page, 'area_tecnica');
  await openAcademicPage(page, 'Preenchimento');
  // The fill screen opens on Alfa, the first unit by code.
  await page.getByRole('tab', { name: /^Unidade Beta/ }).click();
  const routine = indicatorRow(page, 'DEMO-V1-02');
  await routine.getByLabel('Valor apurado').fill('20');
  await routine.getByLabel('Fonte do dado').fill('Painel sintético de rotinas');
  await expect(page.getByText('1 pronto para envio')).toBeVisible();
  await page.getByRole('button', { name: 'Enviar 1 item', exact: true }).click();
  await expect(page.getByText('1 item enviado')).toBeVisible();
  await logoutAcademic(page);
  await login(page, 'revisor_tecnico');
  await openAcademicPage(page, 'Conferência');
  await review(page, 'Para conferir', 'DEMO-V1-02', 'Unidade Beta');
  await logoutAcademic(page);

  // 4. The CAM sees every position ready, consolidates, closes and publishes with a reference.
  await login(page, 'cam');
  await openAcademicPage(page, 'Ciclo e fechamento');
  await expect(page.getByText('16 de 16 prontas')).toBeVisible();
  await page.getByRole('button', { name: 'Iniciar consolidação', exact: true }).click();
  await expect(page.getByText('Situação do ciclo: Em consolidação')).toBeVisible();
  await page.getByLabel('Referência do ciclo').fill('DEMO-DECISAO-V3-OUT');
  await page.getByRole('button', { name: 'Fechar ciclo', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar fechamento', exact: true }).click();
  await expect(page.getByText('Situação do ciclo: Fechada')).toBeVisible();
  await page.getByLabel('Referência do ciclo').fill('DEMO-PUBLICACAO-V3-OUT');
  await page.getByRole('button', { name: 'Publicar demonstração', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar publicação', exact: true }).click();
  await expect(page.getByText('Publicação: Publicada na demonstração')).toBeVisible();

  // 8. The downloaded CSV carries the frozen points column.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar CSV', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.csv$/);
  const csv = readFileSync((await file.path())!, 'utf8').split('\r\n');
  expect(csv[0].split(',')).toContain('pontos');
  const pontos = csv[0].split(',').indexOf('pontos');
  // Unit score = sum of the frozen per-indicator points, in hundredths (no float on the sum).
  const unitTotals: Record<string, number> = { 'ACADEMIC-NORTE-1': 9342, 'ACADEMIC-NORTE-2': 9667, 'ACADEMIC-SUL-1': 9905, 'ACADEMIC-SUL-2': 6987 };
  for (const [unit, total] of Object.entries(unitTotals)) {
    const rows = csv.filter(line => line.includes(`,${unit},`) && line.includes(MONTH));
    expect(rows, unit).toHaveLength(4);
    expect(rows.reduce((sum, line) => sum + Math.round(Number(line.split(',')[pontos]) * 100), 0), unit).toBe(total);
  }
  await logoutAcademic(page);

  // 5-6. The Alfa manager sees the published score, the comparison and the calculation.
  await login(page, 'gestor_unidade');
  await expect(page.locator('.v3-score')).toContainText('93,42');
  await expect(page.getByText('+4,80 vs. setembro')).toBeVisible();
  await page.getByRole('row', { name: /DEMO-V1-01/ }).getByRole('button', { name: 'Como foi calculado?' }).click();
  await expect(page.getByText('min(90 ÷ 95; 1) × 30')).toBeVisible();
  await logoutAcademic(page);

  // 7. Leadership sees both districts with their average.
  await login(page, 'lideranca');
  const district = (name: string) => page.getByRole('region', { name: 'Médias por distrito' }).getByRole('article').filter({ hasText: name });
  // Norte: (93,42 + 96,67) / 2. Sul: (99,05 + 69,87) / 2, with Delta's decided "indisponível" at zero (DEMO-v1 is mode zero).
  await expect(district('Distrito Norte')).toContainText('2 de 2');
  await expect(district('Distrito Norte')).toContainText('95,05');
  await expect(district('Distrito Sul')).toContainText('2 de 2');
  await expect(district('Distrito Sul')).toContainText('84,46');
  await logoutAcademic(page);

  // 10. Nothing was logged as an error along the whole journey.
  expect(consoleErrors).toEqual([]);
});
