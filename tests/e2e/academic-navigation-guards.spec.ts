import { expect, test, type Page } from '@playwright/test';
import { loginAcademic, logoutAcademic, openAcademicPage } from './academicFlowSupport';

test.use({ trace: 'off' });
test.skip(!process.env.ACADEMIC_CAM_EMAIL, 'Requires owned disposable academic fixture');

async function confirmAction(page: Page, action: () => Promise<unknown>, accept: boolean) {
  const nextDialog = page.waitForEvent('dialog');
  const operation = action();
  const dialog = await nextDialog;
  expect(dialog.type()).toBe('confirm');
  expect(dialog.message()).toContain('alterações não salvas');
  if (accept) await dialog.accept();
  else await dialog.dismiss();
  await operation;
}

test('admin protects post-save edits, local record replacement and assignment-only edits before the month', async ({ page }) => {
  test.setTimeout(60_000);
  await loginAcademic(page, 'administrador', 'administrador');
  await page.getByLabel('Código do escopo').fill('DEMO-T14-FIX1-DISTRICT');
  await page.getByRole('button', { name: 'Salvar escopo', exact: true }).click();
  await expect(page.getByText('Cadastro salvo.', { exact: true })).toBeVisible();
  await page.getByLabel('Código do escopo').fill('UNSAVED-AFTER-SUCCESS');
  await expect(page.getByText('Cadastro salvo.', { exact: true })).toHaveCount(0);
  await confirmAction(page, () => page.getByRole('button', { name: 'Novo escopo', exact: true }).click(), false);
  await expect(page.getByLabel('Código do escopo')).toHaveValue('UNSAVED-AFTER-SUCCESS');
  const editScope = page.getByRole('button', { name: 'Editar ACADEMIC-NORTE', exact: true });
  await confirmAction(page, () => editScope.click(), false);
  await expect(page.getByLabel('Código do escopo')).toHaveValue('UNSAVED-AFTER-SUCCESS');
  await confirmAction(page, () => editScope.click(), true);
  await expect(page.getByLabel('Código do escopo')).toHaveValue('ACADEMIC-NORTE');
  await page.getByLabel('Código do escopo').fill('UNSAVED-SAME-RECORD');
  await confirmAction(page, () => editScope.click(), false);
  await expect(page.getByLabel('Código do escopo')).toHaveValue('UNSAVED-SAME-RECORD');
  await confirmAction(page, () => editScope.click(), true);
  await expect(page.getByLabel('Código do escopo')).toHaveValue('ACADEMIC-NORTE');
  await confirmAction(page, () => page.getByRole('button', { name: 'Novo escopo', exact: true }).click(), true);
  await page.getByRole('button', { name: 'Vínculos de negócio', exact: true }).click();
  const firstLink = page.getByRole('button', { name: 'Editar vínculo Conta acadêmica area_tecnica · area_tecnica · ACADEMIC-NORTE-1', exact: true });
  const secondLink = page.getByRole('button', { name: 'Editar vínculo Conta acadêmica revisor_tecnico · revisor_tecnico · ACADEMIC-NORTE-1', exact: true });
  await firstLink.click();
  await page.getByLabel('Início da vigência').fill('2026-03-01');
  await confirmAction(page, () => firstLink.click(), false);
  await expect(page.getByLabel('Início da vigência')).toHaveValue('2026-03-01');
  await confirmAction(page, () => secondLink.click(), false);
  await expect(page.getByLabel('Papel de negócio')).toHaveValue('area_tecnica');
  await expect(page.getByLabel('Início da vigência')).toHaveValue('2026-03-01');
  await confirmAction(page, () => secondLink.click(), true);
  await expect(page.getByLabel('Papel de negócio')).toHaveValue('revisor_tecnico');
  await expect(page.getByLabel('Início da vigência')).toHaveValue('2026-01-01');
  await confirmAction(page, () => page.getByRole('button', { name: 'Competências e atribuições', exact: true }).click(), true);
  await expect(page.getByRole('combobox', { name: 'Informante de ACADEMIC-NORTE', exact: true })).not.toHaveValue('');
  // Loaded suggestions are not an edit: this transition needs no dialog.
  await page.getByRole('button', { name: 'Auditoria', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Auditoria administrativa', exact: true })).toBeVisible();
  for (const field of ['checkbox', 'informant'] as const) {
    await page.getByRole('button', { name: 'Painel', exact: true }).click();
    await page.getByRole('button', { name: 'Competências e atribuições', exact: true }).click();
    const applicable = page.getByLabel('Aplicável: ACADEMIC-NORTE', { exact: true });
    const informant = page.getByRole('combobox', { name: 'Informante de ACADEMIC-NORTE', exact: true });
    if (field === 'checkbox') await applicable.uncheck();
    else await informant.selectOption('');
    await expect(page.getByLabel('Mês da nova competência')).toHaveValue('');
    await confirmAction(page, () => page.getByRole('button', { name: 'Auditoria', exact: true }).click(), false);
    if (field === 'checkbox') await expect(applicable).not.toBeChecked();
    else await expect(informant).toHaveValue('');
    await confirmAction(page, () => page.getByRole('button', { name: 'Auditoria', exact: true }).click(), true);
    await expect(page.getByRole('heading', { name: 'Auditoria administrativa', exact: true })).toBeVisible();
  }
  // A different successful command must not acknowledge this unsent opening.
  await page.getByRole('button', { name: 'Painel', exact: true }).click();
  await page.getByRole('button', { name: 'Competências e atribuições', exact: true }).click();
  const applicable = page.getByLabel('Aplicável: ACADEMIC-NORTE', { exact: true });
  const informant = page.getByRole('combobox', { name: 'Informante de ACADEMIC-NORTE', exact: true });
  await applicable.uncheck();
  await informant.selectOption('');
  await expect(page.getByLabel('Mês da nova competência')).toHaveValue('');
  const position = page.getByRole('combobox', { name: 'Posição para reatribuição', exact: true });
  const north = position.getByRole('option', { name: /^ACADEMIC-NORTE · versão / });
  await expect(north).toHaveCount(1);
  await position.selectOption((await north.getAttribute('value'))!);
  await page.getByLabel('Motivo da reatribuição').fill('Somente reatribuição sintética, sem abrir novo mês');
  await page.getByRole('button', { name: 'Salvar reatribuição', exact: true }).click();
  await expect(page.getByText('Configuração confirmada.', { exact: true })).toBeVisible();
  await expect(page.getByText('Somente a reatribuição foi confirmada. As escolhas de abertura não foram enviadas por esta operação.', { exact: true })).toBeVisible();
  await expect(applicable).not.toBeChecked();
  await expect(informant).toHaveValue('');
  await confirmAction(page, () => page.getByRole('button', { name: 'Auditoria', exact: true }).click(), false);
  await expect(applicable).not.toBeChecked();
  await expect(informant).toHaveValue('');
  await expect(page.getByLabel('Mês da nova competência')).toHaveValue('');
  await confirmAction(page, () => page.getByRole('button', { name: 'Auditoria', exact: true }).click(), true);
  await expect(page.getByRole('heading', { name: 'Auditoria administrativa', exact: true })).toBeVisible();
  await logoutAcademic(page);
});

test('CAM can retry the same blocker after cancel and return A to B to A with real scoped detail reads', async ({ page }) => {
  await loginAcademic(page, 'cam', 'cam');
  await openAcademicPage(page, 'Ciclo e fechamento');
  const reads: unknown[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/rpc/get_position_detail')) reads.push(request.postDataJSON());
  });
  const open = page.getByRole('button', { name: 'Ver pendência de ACADEMIC-NORTE', exact: true });
  await page.getByLabel('Motivo do ciclo').fill('UNSAVED CAM REASON');
  await confirmAction(page, () => open.click(), false);
  await expect(page.getByLabel('Motivo do ciclo')).toHaveValue('UNSAVED CAM REASON');
  expect(reads).toHaveLength(0);
  await confirmAction(page, () => open.click(), true);
  await expect(page.getByRole('heading', { name: 'ACADEMIC-NORTE', exact: true })).toBeFocused();
  await page.getByLabel('Motivo do ciclo').fill('');
  await page.getByRole('button', { name: 'ACADEMIC-NORTE-1 · ausente', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ACADEMIC-NORTE-1', exact: true })).toBeVisible();
  await open.click();
  await expect(page.getByRole('heading', { name: 'ACADEMIC-NORTE', exact: true })).toBeFocused();
  expect(reads).toHaveLength(3);
  expect(reads[2]).toEqual(reads[0]);
  expect(reads[1]).not.toEqual(reads[0]);
  await logoutAcademic(page);
});
