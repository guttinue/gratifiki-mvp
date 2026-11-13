import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { academicRoles, secondaryCredentials, type AcademicCredentials } from './academicFixtures.ts';
import { bootstrapAcademicDemo } from './academicDemo.ts';

export function readAcademicBootstrapEnvironment(env: NodeJS.ProcessEnv): { url: string; key: string; credentials: AcademicCredentials } {
  let url: URL;
  try { url = new URL(env.SUPABASE_URL ?? ''); } catch { throw Error('Academic CLI requires HTTP loopback'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Academic CLI requires HTTP loopback');
  const credentials = Object.fromEntries(academicRoles.map(role => [role, { email: env[`ACADEMIC_${role.toUpperCase()}_EMAIL`] ?? '', password: env[`ACADEMIC_${role.toUpperCase()}_PASSWORD`] ?? '' }])) as AcademicCredentials;
  const all = [...Object.values(credentials), ...Object.values(secondaryCredentials(credentials))];
  if (all.some(c => !/^[^\s@]+@[^\s@]+\.invalid$/i.test(c.email) || c.password.length < 8) || new Set(all.map(c => c.email.toLowerCase())).size !== 10) throw Error('Academic CLI requires seven distinct synthetic .invalid principals and protected passwords');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key?.trim()) throw Error('Academic CLI requires protected administrative provisioning credential');
  return { url: url.origin, key, credentials };
}
export async function runAcademicBootstrap(env: NodeJS.ProcessEnv, options: { legacyOnly?: boolean } = {}) {
  const { url, key, credentials } = readAcademicBootstrapEnvironment(env);
  return bootstrapAcademicDemo(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }), credentials, options);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 2) { process.stderr.write('Academic CLI accepts protected environment only; no credentials in arguments.\n'); process.exitCode = 1; }
  else void runAcademicBootstrap(process.env).then(() => process.stdout.write('Academic synthetic bootstrap complete: seven roles, ten fixture identities; existing credentials/history were not reset.\n')).catch(() => { process.stderr.write('Academic local bootstrap refused or failed; private diagnostic suppressed.\n'); process.exitCode = 1; });
}
