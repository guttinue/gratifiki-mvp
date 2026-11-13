import { expect, test } from '@playwright/test';
import { chooseAcademicContext, loginAcademic, logoutAcademic, openAcademicPage } from './academicFlowSupport';

test.use({ trace: 'off' });
test.skip(!process.env.ACADEMIC_CAM_EMAIL, 'Requires owned disposable academic fixture');

test('cancelled page/context/logout navigation preserves edits, while Back/Forward and forged hashes remain scoped', async ({ page }) => {
  await loginAcademic(page, 'area_tecnica', 'area_tecnica');
  await openAcademicPage(page, 'Preenchimento');
  await page.getByRole('button', { name: 'ACADEMIC-NORTE · ausente', exact: true }).click();
  await page.getByLabel('Valor', { exact: true }).fill('12');
  for (const action of ['page', 'context', 'logout'] as const) {
    const dialog = page.waitForEvent('dialog');
    const change = action === 'page' ? page.getByRole('button', { name: 'Histórico', exact: true }).click()
      : action === 'logout' ? page.getByRole('button', { name: 'Sair', exact: true }).click()
        : page.getByLabel('Contexto autorizado').selectOption({ label: 'area_tecnica · ACADEMIC-NORTE-1 · ACADEMIC-2026-10 · acadêmico' });
    const prompt = await dialog;
    expect(prompt.message()).toContain('alterações não salvas');
    await prompt.dismiss();
    await change;
    await expect(page.getByLabel('Valor', { exact: true })).toHaveValue('12');
    await expect(page.getByText('Perfil area_tecnica · ACADEMIC-NORTE · ACADEMIC-2026-10', { exact: true })).toBeVisible();
  }
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Histórico', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Histórico autorizado', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Rascunhos do indicador', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Histórico autorizado', exact: true })).toBeVisible();
  await logoutAcademic(page);
  await loginAcademic(page, 'gestor_unidade', 'gestor_unidade', 'ACADEMIC-NORTE-1');
  const forbidden: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/rpc/get_admin_catalog')) forbidden.push(request.url()); });
  await page.evaluate(() => { location.hash = '#academico/cadastros'; });
  await expect(page).toHaveURL(/#academico\/painel$/);
  await expect(page.getByRole('button', { name: 'Salvar escopo', exact: true })).toHaveCount(0);
  expect(forbidden).toEqual([]);
  await logoutAcademic(page);
});

test('logout discards an actual delayed detail response, including after a different authenticated actor signs in', async ({ page }) => {
  await loginAcademic(page, 'area_tecnica', 'area_tecnica', 'ACADEMIC-NORTE-2');
  await openAcademicPage(page, 'Preenchimento');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let fetched!: () => void;
  const received = new Promise<void>(resolve => { fetched = resolve; });
  await page.route('**/rest/v1/rpc/get_position_detail', async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    fetched();
    await held;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'ACADEMIC-NORTE-2 · ausente', exact: true }).click();
  await received;
  await logoutAcademic(page);
  await loginAcademic(page, 'gestor_unidade', 'gestor_unidade', 'ACADEMIC-NORTE-1');
  release();
  await expect(page.getByRole('heading', { name: 'Avaliações autorizadas', exact: true })).toBeVisible();
  await expect(page.getByLabel('Valor', { exact: true })).toHaveCount(0);
  await page.unroute('**/rest/v1/rpc/get_position_detail');
  await logoutAcademic(page);
});

test('expired persisted session with an invalid refresh token returns to login instead of retaining academic data', async ({ page }) => {
  await loginAcademic(page, 'gestor_unidade', 'gestor_unidade', 'ACADEMIC-NORTE-1');
  const corrupted = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(name => name.startsWith('sb-') && name.endsWith('-auth-token'));
    if (!key) return false;
    const session = JSON.parse(localStorage.getItem(key)!);
    session.expires_at = 1;
    session.refresh_token = 'synthetic-invalid-expired-refresh-token';
    localStorage.setItem(key, JSON.stringify(session));
    return true;
  });
  expect(corrupted).toBe(true);
  await page.reload();
  await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Avaliações autorizadas', exact: true })).toHaveCount(0);
});

test('blocked operation storage prevents a new submission; committed response-loss retries preserve the exact operation', async ({ page }) => {
  await loginAcademic(page, 'area_tecnica', 'area_tecnica', 'ACADEMIC-NORTE-1');
  await openAcademicPage(page, 'Preenchimento');
  await page.getByRole('button', { name: 'ACADEMIC-NORTE-1 · ausente', exact: true }).click();
  await page.getByLabel('Valor', { exact: true }).fill('10');
  await page.getByLabel('Fonte', { exact: true }).fill('T14 synthetic storage test');
  await page.getByLabel('Período da fonte', { exact: true }).fill('2026-10-01');
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await expect(page.getByText('Rascunho salvo. Ainda não enviado.')).toBeVisible();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('gratifiki:pending-submit:v2:')) throw new DOMException('Storage blocked', 'SecurityError');
      return original.call(this, key, value);
    };
  });
  const submissions: unknown[] = [];
  page.on('request', request => { if (request.url().endsWith('/rpc/submit_position')) submissions.push(request.postDataJSON()); });
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('armazenamento');
  expect(submissions).toHaveLength(0);
  await page.reload();
  await chooseAcademicContext(page, 'area_tecnica', 'ACADEMIC-NORTE-1');
  await page.getByRole('button', { name: 'ACADEMIC-NORTE-1 · rascunho', exact: true }).click();
  let lost = true;
  await page.route('**/rest/v1/rpc/submit_position', async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (lost) { lost = false; await route.abort('failed'); }
    else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Repetir envio pendente', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Repetir envio pendente', exact: true }).click();
  await expect(page.getByText('Envio confirmado. Dados fixados para revisão.')).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);
  await logoutAcademic(page);
});

test('academic module loading failure shows a recoverable error without silently remounting another journey', async ({ page }) => {
  await loginAcademic(page, 'gestor_unidade', 'gestor_unidade', 'ACADEMIC-NORTE-1');
  const modulePattern = process.env.VERIFICATION_OWNED_TARGET
    ? /\/assets\/AcademicWorkspace-[^/?]+\.js(?:\?.*)?$/
    : '**/src/features/workspace/AcademicWorkspace.tsx*';
  let intercepted = 0;
  await page.route(modulePattern, route => { intercepted += 1; return route.abort('failed'); });
  await page.reload();
  // The selected key is not persisted: re-discovery lands on this actor's own
  // latest open model-3 month, so its module is requested right after the reload.
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar o espaço acadêmico');
  await expect(page.getByRole('button', { name: 'Recarregar espaço', exact: true })).toBeVisible();
  expect(intercepted).toBeGreaterThan(0);
  await page.unroute(modulePattern);
  await page.getByRole('button', { name: 'Recarregar espaço', exact: true }).click();
  await chooseAcademicContext(page, 'gestor_unidade', 'ACADEMIC-NORTE-1');
  await expect(page.getByRole('heading', { name: 'Avaliações autorizadas', exact: true })).toBeVisible();
  await logoutAcademic(page);
});
