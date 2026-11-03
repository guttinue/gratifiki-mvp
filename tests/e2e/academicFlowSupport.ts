import { expect, type Page } from '@playwright/test';
import type { Role } from '../../src/features/pilot/types';
import { academicCredential } from './e2eSupport';

export type Identity = Parameters<typeof academicCredential>[0];
export async function chooseAcademicContext(page: Page, role: Role, scope = 'ACADEMIC-NORTE') {
  const picker = page.getByLabel('Contexto autorizado');
  const option = picker.locator('option').filter({ hasText: `${role} · ${scope} · ACADEMIC-2026-10 · acadêmico` });
  await expect(option).toHaveCount(1);
  await picker.selectOption((await option.getAttribute('value'))!);
  await expect(page.getByText(`Perfil ${role} · ${scope} · ACADEMIC-2026-10`, { exact: true })).toBeVisible();
}

export async function loginAcademic(page: Page, identity: Identity, role: Role, scope?: string) {
  await page.goto('/');
  const credentials = academicCredential(identity);
  await page.getByLabel('E-mail', { exact: true }).fill(credentials.email);
  await page.getByLabel('Senha', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await chooseAcademicContext(page, role, scope);
}

export async function logoutAcademic(page: Page) {
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible();
}

// The V3 menu lands every role on Painel; work screens are reached through it.
export async function openAcademicPage(page: Page, label: string) {
  await page.getByRole('navigation', { name: 'Navegação acadêmica' }).getByRole('button', { name: label, exact: true }).click();
}
