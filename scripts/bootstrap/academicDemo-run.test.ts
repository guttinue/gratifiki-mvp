// @vitest-environment node
import { expect, it } from 'vitest';
import { academicRoles } from './academicFixtures.ts';
import { readAcademicBootstrapEnvironment } from './academicDemo-run.ts';

it('refuses remote before reading protected credentials', () => {
  expect(() => readAcademicBootstrapEnvironment({ SUPABASE_URL: 'https://remote.invalid', get SUPABASE_SERVICE_ROLE_KEY(): string { throw Error('secret read'); } })).toThrow(/loopback/);
});
it('accepts seven runtime synthetic principals and refuses missing or non-synthetic credentials', () => {
  const env: Record<string, string> = { SUPABASE_URL: 'http://127.0.0.1:55421', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-private-not-output' };
  for (const role of academicRoles) { env[`ACADEMIC_${role.toUpperCase()}_EMAIL`] = `${role}@demo.invalid`; env[`ACADEMIC_${role.toUpperCase()}_PASSWORD`] = 'synthetic-test-password'; }
  expect(Object.keys(readAcademicBootstrapEnvironment(env).credentials)).toHaveLength(7);
  env.ACADEMIC_CAM_EMAIL = 'real@example.com';
  expect(() => readAcademicBootstrapEnvironment(env)).toThrow(/synthetic/);
  delete env.ACADEMIC_CAM_EMAIL;
  expect(() => readAcademicBootstrapEnvironment(env)).toThrow(/synthetic/);
});
