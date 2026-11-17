import { expect, test, type Page } from '@playwright/test';
import { loginAcademic, logoutAcademic, openAcademicPage } from './academicFlowSupport';
import { academicPageHeading, getAcademicDestinations } from '../../src/features/workspace/academicNavigation';
import type { Role } from '../../src/features/pilot/types';

test.use({ trace: 'off' });
test.skip(!process.env.ACADEMIC_CAM_EMAIL, 'Requires owned disposable academic fixture');

const roles = ['area_tecnica', 'revisor_tecnico', 'cam', 'gestor_unidade', 'gestor_distrital', 'administrador', 'lideranca'] as Role[];

// Skip link to main, then 320-1440 px at 100% and 200%: no page overflow, labelled fields, buttons with text.
async function checkKeyboardAndReflow(page: Page, role: Role) {
  const skip = page.getByRole('link', { name: 'Pular para o conteúdo', exact: true });
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const zoom of ['100%', '200%']) {
      await page.evaluate(value => { document.body.style.zoom = value; }, zoom);
      // The collapsed menu slides out; measure once its transition has settled.
      // Only finite animations settle; a cancelled one rejects its promise, which is fine here.
      await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${role}, ${width}px, ${zoom}: no page overflow`).toBe(true);
      const inputs = page.locator('input:visible, select:visible, textarea:visible');
      for (const input of await inputs.all()) {
        const box = await input.boundingBox();
        expect(box?.width).toBeGreaterThan(0);
        expect(await input.evaluate(element => !!element.closest('label') || !!element.getAttribute('aria-label'))).toBe(true);
      }
      for (const button of await page.getByRole('button').all()) expect((await button.innerText()).trim()).not.toBe('');
    }
  }
  await page.evaluate(() => { document.body.style.zoom = '100%'; });
}

for (const role of roles) {
  test(`${role}: keyboard landmarks and narrow/desktop layouts reflow at 100% and 200%`, async ({ page }) => {
    test.setTimeout(60_000);
    await loginAcademic(page, role, role, role === 'gestor_unidade' ? 'ACADEMIC-NORTE-1' : undefined);
    await checkKeyboardAndReflow(page, role);
    if (role !== 'lideranca') {
      const history = ['cam', 'administrador'].includes(role) ? 'Auditoria' : 'Histórico';
      await page.getByRole('button', { name: history, exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('main')).toBeFocused();
      await expect(page.getByRole('heading', { name: role === 'administrador' ? 'Auditoria administrativa' : 'Histórico autorizado', exact: true })).toBeVisible();
    }
    await logoutAcademic(page);
  });
}

// V3 shell: the side menu becomes a top bar below 768px; no screen may scroll the page sideways.
for (const role of roles) {
  test(`${role}: every screen of the menu fits 375px and 1440px without horizontal page scroll`, async ({ page }) => {
    test.setTimeout(90_000);
    await loginAcademic(page, role, role, role === 'gestor_unidade' ? 'ACADEMIC-NORTE-1' : undefined);
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const destination of getAcademicDestinations(role)) {
        await openAcademicPage(page, destination.label);
        await page.waitForLoadState('networkidle');
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
        expect(scrollWidth, `${role}, ${destination.label}, ${width}px: page scrollWidth`).toBeLessThanOrEqual(innerWidth);
      }
    }
    await logoutAcademic(page);
  });
}

// V4 battery: the same checks on the model-3 month each role lands on, plus the V4 page heading of every destination,
// no third-party request, the self-hosted fonts, tables that keep their semantics at 375px and no leaked e-mail, code or person.
const V3 = 'ACADEMIC-V3-2026-10';
// Units of each role in the seed; the heading only depends on them on the managers' painel.
const v3Scopes: Partial<Record<Role, string[]>> = {
  area_tecnica: ['ACADEMIC-NORTE-1', 'ACADEMIC-NORTE-2'], revisor_tecnico: ['ACADEMIC-NORTE-1', 'ACADEMIC-NORTE-2'], gestor_unidade: ['ACADEMIC-NORTE-1'],
  gestor_distrital: ['ACADEMIC-NORTE'],
};
for (const role of roles) {
  test(`${role} V4: keyboard, reflow, fonts, no third party and every destination heading at 1440, 768 and 375px`, async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    // Every request of the session goes to the app or to the disposable API: fonts are self-hosted, nothing else is fetched.
    const allowed = [new URL(baseURL!).origin, new URL(process.env.VITE_SUPABASE_URL!).origin];
    const foreign: string[] = [];
    page.on('request', request => { const url = new URL(request.url()); if (!allowed.includes(url.origin)) foreign.push(`${url.origin}${url.pathname}`); });
    await loginAcademic(page, role, role, undefined, V3);
    // A screen may not use all three faces yet, so ask for each: it must resolve to a self-hosted face and then be ready.
    const fonts = ['14px Inter', '14px Geist', '12px "Geist Mono"'];
    expect(await page.evaluate(list => Promise.all(list.map(font => document.fonts.load(font).then(faces => faces.length))), fonts)).not.toContain(0);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(list => list.map(font => document.fonts.check(font)), fonts)).toEqual([true, true, true]);
    await checkKeyboardAndReflow(page, role);
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      for (const destination of getAcademicDestinations(role)) {
        await openAcademicPage(page, destination.label);
        await page.waitForLoadState('networkidle');
        // The text checks below read the loaded screen, not its loading placeholder.
        await expect(page.getByRole('status').filter({ hasText: /^Carregando/ })).toHaveCount(0);
        const where = `${role} V4, ${destination.label}, ${width}px`;
        const { title } = academicPageHeading(role, destination.id, { competence: V3, scopes: v3Scopes[role] ?? [] });
        await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
        expect(scrollWidth, `${where}: page scrollWidth`).toBeLessThanOrEqual(innerWidth);
        // Tabs that do not fit scroll inside their bar; a tab shrunk below its label would paint over its neighbour.
        const squeezed = await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].filter(tab => tab.scrollWidth > tab.clientWidth + 1).map(tab => tab.textContent));
        expect(squeezed, `${where}: tabs narrower than their label`).toEqual([]);
        // Below 900px a closed menu is out of the Tab order.
        if (width < 900) await expect(page.locator('#academic-menu:not([data-open="true"])')).toHaveCSS('visibility', 'hidden');
        // At 375px tables turn into cards, yet stay inside the viewport and keep their table, row and rowgroup semantics.
        if (width === 375) for (const table of await page.locator('.v4-tbl, .fill-tbl').all()) {
          expect(await table.evaluate(element => element.getBoundingClientRect().width <= window.innerWidth), `${where}: table wider than the viewport`).toBe(true);
          await expect(table.getByRole('table')).toBeVisible();
          await expect(table.getByRole('row').nth(1)).toBeVisible();
          await expect(table.getByRole('row', { name: /\S/ }).first()).toBeVisible();
          if (await table.evaluate(element => element.classList.contains('fill-tbl'))) await expect(table.getByRole('rowgroup').nth(1)).toBeVisible();
        }
        // Spec §8.3: no e-mail, no ACADEMIC- code and no person on a model-3 screen; only the links table names the demo accounts.
        const text = await page.evaluate(() => document.body.innerText);
        expect(text, `${where}: e-mail or scope code on screen`).not.toMatch(/@|ACADEMIC-/);
        if (destination.id !== 'vinculos') expect(text, `${where}: person on screen`).not.toMatch(/Conta acadêmica/);
        await page.screenshot({ path: test.info().outputPath(`${role}-${destination.id}-${width}.png`), fullPage: true });
      }
    }
    // The 375px header is static, not sticky: "Menu" is the Tab stop right after the skip link and scrolls into view on focus.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.getByRole('link', { name: 'Pular para o conteúdo', exact: true }).focus();
    await page.keyboard.press('Tab');
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    await expect(menu).toBeFocused();
    await expect(menu).toBeInViewport();
    await logoutAcademic(page);
    expect(foreign, `${role} V4: requests outside the app and the API`).toEqual([]);
  });
}

test('invalid keyboard-submitted draft exposes an actionable error without sending data', async ({ page }) => {
  await loginAcademic(page, 'area_tecnica', 'area_tecnica', 'ACADEMIC-NORTE-1');
  await openAcademicPage(page, 'Preenchimento');
  await page.getByRole('button', { name: 'ACADEMIC-NORTE-1 · ausente', exact: true }).click();
  await page.getByLabel('Valor', { exact: true }).fill('not-a-number');
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('decimal válido');
  await expect(page.getByLabel('Valor', { exact: true })).toHaveValue('not-a-number');
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeDisabled();
  page.once('dialog', dialog => dialog.accept());
  await logoutAcademic(page);
});
