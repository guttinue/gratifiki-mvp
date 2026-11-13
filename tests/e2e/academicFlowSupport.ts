import { expect, type Locator, type Page } from '@playwright/test';
import type { Role } from '../../src/features/pilot/types';
import { competenceLabel, roleLabels } from '../../src/features/workspace/displayNames';
import { academicCredential } from './e2eSupport';

export type Identity = Parameters<typeof academicCredential>[0];

// Model-3 people land in their V3 month; the legacy picker sits behind "Outros contextos".
export async function openContextPicker(page: Page): Promise<Locator> {
  await expect(page.locator('.academic-side').or(page.getByRole('heading', { name: 'Selecione seu contexto' }))).toBeVisible();
  const picker = page.getByLabel('Contexto autorizado');
  if (!await picker.isVisible()) await page.getByRole('button', { name: 'Outros contextos', exact: true }).click();
  return picker;
}

// Model-2 flows use ACADEMIC-2026-10; the V3 seed adds ACADEMIC-V3-2026-09/10.
export async function chooseAcademicContext(page: Page, role: Role, scope = 'ACADEMIC-NORTE', competence = 'ACADEMIC-2026-10') {
  if (competence.startsWith('ACADEMIC-V3-')) {
    // Model 3 shows every unit of the role at once, so the scope is not chosen.
    await expect(page.locator('.academic-side')).toBeVisible();
    const month = page.locator('.academic-top').getByRole('combobox', { name: 'Competência', exact: true });
    if (await month.locator('option:checked').textContent() !== competenceLabel(competence)) await month.selectOption({ label: competenceLabel(competence) });
    await expect(page.locator('.academic-person')).toContainText(roleLabels[role]);
    return;
  }
  const picker = await openContextPicker(page);
  const option = picker.locator('option').filter({ hasText: `${role} · ${scope} · ${competence} · acadêmico` });
  await expect(option).toHaveCount(1);
  await picker.selectOption((await option.getAttribute('value'))!);
  await expect(page.getByText(`Perfil ${role} · ${scope} · ${competence}`, { exact: true })).toBeVisible();
}

export async function loginAcademic(page: Page, identity: Identity, role: Role, scope?: string, competence?: string) {
  await page.goto('/');
  const credentials = academicCredential(identity);
  await page.getByLabel('E-mail', { exact: true }).fill(credentials.email);
  await page.getByLabel('Senha', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await chooseAcademicContext(page, role, scope, competence);
}

export async function logoutAcademic(page: Page) {
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible();
}

// The V3 menu lands every role on Painel; work screens are reached through it.
// Below 768 px the menu is collapsed behind the "Menu" button.
export async function openAcademicPage(page: Page, label: string) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible() && await menu.getAttribute('aria-expanded') === 'false') await menu.click();
  await page.getByRole('navigation', { name: 'Navegação acadêmica' }).getByRole('button', { name: label, exact: true }).click();
}
