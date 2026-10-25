// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { createOwnedEnvironment, validateOwnedTarget, type OwnedTarget } from './runtime.ts';
import { verifyRestore, verifySecurityParity } from './restore.ts';
import { OwnedSession } from './ownedSession.ts';
import { spawn } from 'node:child_process';
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => { throw Error('process must not start'); }) }));

const owned: OwnedTarget[] = [];
afterEach(() => { for (const target of owned.splice(0)) { validateOwnedTarget(target); rmSync(target.workdir, { recursive: true }); } });
it('refuses remote/unmarked source and target before spawning any dump or restore process', async () => {
  const source = await createOwnedEnvironment(55420); owned.push(source);
  const target = await createOwnedEnvironment(55520); owned.push(target);
  const spy = vi.mocked(spawn);
  try {
    await expect(verifyRestore({ ...source, url: 'https://remote.invalid' }, target)).rejects.toThrow(/Refused/);
    await expect(verifyRestore(source, { ...target, marker: 'forged' })).rejects.toThrow(/Refused/);
    await expect(verifyRestore(source, source)).rejects.toThrow(/distinct/);
    expect(spy).not.toHaveBeenCalled();
  } finally { spy.mockClear(); }
});

it.each([
  { name: 'global default privilege missing', changed: { schema: null, role: 'postgres', objectType: 'f', template: [], effective: [] } },
  { name: 'per-schema future grant added', changed: { schema: 'private', role: 'postgres', objectType: 'r', template: [{ grantor: 'postgres', grantee: 'authenticated', privilege: 'SELECT', grantable: false }], effective: [{ grantor: 'postgres', grantee: 'authenticated', privilege: 'SELECT', grantable: false }] } },
  { name: 'grant option changed', changed: { schema: null, role: 'postgres', objectType: 'f', template: [{ grantor: 'postgres', grantee: 'PUBLIC', privilege: 'EXECUTE', grantable: true }], effective: [{ grantor: 'postgres', grantee: 'PUBLIC', privilege: 'EXECUTE', grantable: true }] } },
  { name: 'future grantor changed', changed: { schema: null, role: 'postgres', objectType: 'f', template: [{ grantor: 'supabase_admin', grantee: 'PUBLIC', privilege: 'EXECUTE', grantable: false }], effective: [{ grantor: 'supabase_admin', grantee: 'PUBLIC', privilege: 'EXECUTE', grantable: false }] } },
  { name: 'owner role changed', changed: { schema: null, role: 'supabase_admin', objectType: 'f', template: [], effective: [] } },
  { name: 'future object type changed', changed: { schema: null, role: 'postgres', objectType: 'r', template: [], effective: [] } },
])('rejects $name even when all existing object ACLs are unchanged', async ({ changed }) => {
  const source = await createOwnedEnvironment(55420); owned.push(source);
  const target = await createOwnedEnvironment(55520); owned.push(target);
  const original = { schema: null, role: 'postgres', objectType: 'f', configured: true, template: [{ grantor: 'postgres', grantee: 'PUBLIC', privilege: 'EXECUTE', grantable: false }], effective: [{ grantor: 'postgres', grantee: 'PUBLIC', privilege: 'EXECUTE', grantable: false }] };
  const targetRows = changed.schema === null ? [{ ...changed, configured: true }] : [original, { ...changed, configured: true }];
  const sql = vi.spyOn(OwnedSession.prototype, 'sql').mockImplementation(function (this: OwnedSession, query: string) {
    return Promise.resolve(query.includes('pg_default_acl')
      ? JSON.stringify(this.target.projectId === source.projectId ? [original] : targetRows)
      : JSON.stringify({ policies: [], grants: [], schemas: [], functions: [], triggers: [] }));
  });
  try { expect(await verifySecurityParity(source, target)).toBe(false); }
  finally { sql.mockRestore(); }
});
