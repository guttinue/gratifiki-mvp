// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { lstatSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildDefaultAclRepair, restoreCapturedDefaultAcls } from './defaultAcl.ts';
import { createOwnedEnvironment, validateOwnedTarget } from './runtime.ts';
import { OwnedSession } from './ownedSession.ts';

const owner = { grantor: 'postgres', grantee: 'postgres', privilege: 'EXECUTE', grantable: false };
const additional = { grantor: 'postgres', grantee: 'authenticated', privilege: 'EXECUTE', grantable: true };
const row = { role: 'postgres', schema: null, objectType: 'f', configured: true, template: [owner, additional], effective: [owner, additional] };
it('restores the exact source global template with grant option and original grantor role', () => {
  const previous = { ...row, configured: false, template: [owner], effective: [owner] };
  expect(buildDefaultAclRepair(JSON.stringify([row]), JSON.stringify([previous]), 'global')).toBe('begin;set local role "postgres";alter default privileges for role "postgres" revoke all privileges on functions from "authenticated","postgres";alter default privileges for role "postgres" grant execute on functions to "postgres";alter default privileges for role "postgres" grant execute on functions to "authenticated" with grant option;reset role;commit;');
});
it('restores only per-schema additions, not the broader global effective ACL', () => {
  const source = { ...row, schema: 'private', objectType: 'r', template: [{ ...owner, grantee: 'authenticated', privilege: 'SELECT' }], effective: [{ ...owner, privilege: 'SELECT' }, { ...owner, grantee: 'authenticated', privilege: 'SELECT' }] };
  expect(buildDefaultAclRepair(JSON.stringify([source]), '[]', 'schema')).toBe('begin;set local role "postgres";alter default privileges for role "postgres" in schema "private" revoke all privileges on tables from "authenticated";alter default privileges for role "postgres" in schema "private" grant select on tables to "authenticated";reset role;commit;');
});
it('performs no mutations when templates already match', () => {
  expect(buildDefaultAclRepair(JSON.stringify([row]), JSON.stringify([row]), 'global')).toBe('');
});
it('removes an extra schema-only template without inventing a source grant', () => {
  expect(buildDefaultAclRepair('[]', JSON.stringify([{ ...row, schema: 'private' }]), 'schema')).toBe('begin;set local role "postgres";alter default privileges for role "postgres" in schema "private" revoke all privileges on functions from "authenticated","postgres";reset role;commit;');
});
it('fails closed on unsupported privileges, types or a grantor different from its owner role', () => {
  for (const invalid of [
    { ...row, objectType: 'z' },
    { ...row, template: [{ ...additional, privilege: 'SUPERUSER' }] },
    { ...row, template: [{ ...additional, grantor: 'supabase_admin' }] },
  ]) expect(() => buildDefaultAclRepair(JSON.stringify([invalid]), '[]', 'global')).toThrow(/Owned default ACL/);
});
it('captures and reads the exact source metadata in a private companion artifact without needing a permission change', async () => {
  const source = await createOwnedEnvironment(55420), target = await createOwnedEnvironment(55520);
  mkdirSync(join(source.workdir, 'recovery'), { mode: 0o700 });
  const captured = JSON.stringify([row]);
  const sql = vi.spyOn(OwnedSession.prototype, 'sql').mockResolvedValue(JSON.stringify([row], null, 2));
  try {
    await expect(restoreCapturedDefaultAcls(source, target, captured)).resolves.toBeUndefined();
    expect(lstatSync(join(source.workdir, 'recovery/default-acl.json')).mode & 0o077).toBe(0);
  } finally {
    sql.mockRestore();
    for (const owned of [source, target]) { validateOwnedTarget(owned); rmSync(owned.workdir, { recursive: true }); }
  }
});
