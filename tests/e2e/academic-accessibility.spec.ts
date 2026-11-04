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

// V3 battery: the same checks on the model-3 month each role lands on, plus the V3 page heading of every destination.
const V3 = 'ACADEMIC-V3-2026-10';
// Units of each role in the seed; the heading only depends on them on the unit manager's painel.
const v3Scopes: Partial<Record<Role, string[]>> = {
  area_tecnica: ['ACADEMIC-NORTE-1', 'ACADEMIC-NORTE-2'], revisor_tecnico: ['ACADEMIC-NORTE-1', 'ACADEMIC-NORTE-2'], gestor_unidade: ['ACADEMIC-NORTE-1'],
};
for (const role of roles) {
  test(`${role} V3: keyboard, reflow and every destination heading at 375px and 1440px`, async ({ page }) => {
    test.setTimeout(120_000);
    await loginAcademic(page, role, role, undefined, V3);
    await checkKeyboardAndReflow(page, role);
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 });
      for (const destination of getAcademicDestinations(role)) {
        await openAcademicPage(page, destination.label);
        await page.waitForLoadState('networkidle');
        const { title } = academicPageHeading(role, destination.id, { competence: V3, scopes: v3Scopes[role] ?? [] });
        await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
        expect(scrollWidth, `${role} V3, ${destination.label}, ${width}px: page scrollWidth`).toBeLessThanOrEqual(innerWidth);
        // Tabs that do not fit scroll inside their bar; a tab shrunk below its label would paint over its neighbour.
        const squeezed = await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].filter(tab => tab.scrollWidth > tab.clientWidth + 1).map(tab => tab.textContent));
        expect(squeezed, `${role} V3, ${destination.label}, ${width}px: tabs narrower than their label`).toEqual([]);
        // A closed menu is out of the Tab order.
        if (width === 375) await expect(page.locator('#academic-menu:not([data-open="true"])')).toHaveCSS('visibility', 'hidden');
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
