import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { assertLocalE2eConfiguration } from './e2eSupport';
import { chooseAcademicContext, loginAcademic } from './academicFlowSupport';

test.skip(!process.env.ACADEMIC_CAM_EMAIL, 'Requires owned academic fixture');
test('public signup is denied by Auth and authorized academic session survives browser reload', async ({ page }) => {
  assertLocalE2eConfiguration();
  const anonymous = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const signup = await anonymous.auth.signUp({ email: 'not-provisioned@academic-verification.invalid', password: randomUUID() });
  expect(signup.data.user).toBeNull();
  expect(signup.error?.code).toBe('signup_disabled');
  await loginAcademic(page, 'area_tecnica', 'area_tecnica');
  await expect(page.getByRole('button', { name: 'Preenchimento', exact: true })).toBeVisible();
  await page.reload();
  await chooseAcademicContext(page, 'area_tecnica');
  await expect(page.getByRole('button', { name: 'Preenchimento', exact: true })).toBeVisible();
});
