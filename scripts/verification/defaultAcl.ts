import { OwnedSession } from './ownedSession.ts';
import { validateOwnedTarget, type OwnedTarget } from './runtime.ts';
import { closeSync, constants, lstatSync, openSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Grant = { grantor: string; grantee: string; privilege: string; grantable: boolean };
type DefaultRow = { role: string; schema: string | null; objectType: string; configured: boolean; template: Grant[]; effective: Grant[] };
const kinds: Record<string, { keyword: string; privileges: readonly string[] }> = {
  r: { keyword: 'tables', privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] },
  S: { keyword: 'sequences', privileges: ['SELECT', 'UPDATE', 'USAGE'] },
  f: { keyword: 'functions', privileges: ['EXECUTE'] },
  T: { keyword: 'types', privileges: ['USAGE'] },
  n: { keyword: 'schemas', privileges: ['CREATE', 'USAGE'] },
};
function refused(): never { throw Error('Owned default ACL metadata refused'); }
function identifier(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.length <= 63 &&
    [...value].every(c => c.codePointAt(0)! >= 32 && c.codePointAt(0)! !== 127) ? value : refused();
}
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
function rows(value: string): DefaultRow[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) return refused();
  const result = parsed.map((value: unknown) => {
    if (!value || typeof value !== 'object') return refused();
    const r = value as Record<string, unknown>;
    const role = identifier(r.role), schema = r.schema === null ? null : identifier(r.schema);
    if (typeof r.objectType !== 'string' || !Object.hasOwn(kinds, r.objectType) || typeof r.configured !== 'boolean') return refused();
    const kind = r.objectType;
    function grants(value: unknown): Grant[] {
      if (!Array.isArray(value)) return refused();
      return value.map((item: unknown) => {
        if (!item || typeof item !== 'object') return refused();
        const g = item as Record<string, unknown>;
        if (typeof g.privilege !== 'string' || !kinds[kind].privileges.includes(g.privilege) || typeof g.grantable !== 'boolean') return refused();
        const grantor = identifier(g.grantor), grantee = identifier(g.grantee);
        // ALTER DEFAULT PRIVILEGES always records the owning role as grantor.
        // Do not silently substitute superuser or normalize a different grantor.
        if (grantor !== role) return refused();
        return { grantor, grantee, privilege: g.privilege, grantable: g.grantable };
      });
    }
    return { role, schema, objectType: kind, configured: r.configured, template: grants(r.template), effective: grants(r.effective) };
  });
  if (new Set(result.map(key)).size !== result.length) return refused();
  return result;
}
const key = (r: DefaultRow) => JSON.stringify([r.role, r.schema, r.objectType]);

/** Restore raw templates, not a permissive union of their effective ACLs. Global
 * templates are full defaults; per-schema templates are only additions. */
export function buildDefaultAclRepair(source: string, target: string, scope: 'global' | 'schema'): string {
  const sourceRows = rows(source), targetRows = rows(target);
  const wanted = new Map(sourceRows.filter(r => (r.schema === null) === (scope === 'global')).map(r => [key(r), r]));
  const current = new Map(targetRows.filter(r => (r.schema === null) === (scope === 'global')).map(r => [key(r), r]));
  const statements: string[] = [];
  for (const id of [...new Set([...wanted.keys(), ...current.keys()])].sort()) {
    const desired = wanted.get(id), previous = current.get(id);
    if (JSON.stringify(desired) === JSON.stringify(previous)) continue;
    if (!desired && scope === 'global') return refused(); // Different base roles are not a grant-repair operation.
    const model = desired ?? previous!;
    const prefix = `alter default privileges for role ${quote(model.role)}${model.schema === null ? '' : ` in schema ${quote(model.schema)}`}`;
    const grantees = [...new Set([...(desired?.template ?? []), ...(previous?.template ?? [])].map(g => g.grantee))].sort();
    statements.push(`set local role ${quote(model.role)};`);
    if (grantees.length) statements.push(`${prefix} revoke all privileges on ${kinds[model.objectType].keyword} from ${grantees.map(g => g === 'PUBLIC' ? 'public' : quote(g)).join(',')};`);
    for (const g of desired?.template ?? []) statements.push(`${prefix} grant ${g.privilege.toLowerCase()} on ${kinds[model.objectType].keyword} to ${g.grantee === 'PUBLIC' ? 'public' : quote(g.grantee)}${g.grantable ? ' with grant option' : ''};`);
    statements.push('reset role;');
  }
  return statements.length ? `begin;${statements.join('')}commit;` : '';
}

/** pg_dump -n omits non-schema global default ACLs. Keep their complete source
 * metadata beside the binary archive, protected like the synthetic Auth dump. */
export async function restoreCapturedDefaultAcls(source: OwnedTarget, target: OwnedTarget, captured: string) {
  validateOwnedTarget(source); validateOwnedTarget(target);
  rows(captured); // Validate every field before saving or mutating the target.
  const folder = join(source.workdir, 'recovery');
  if (realpathSync(folder) !== folder || !lstatSync(folder).isDirectory() || (lstatSync(folder).mode & 0o077) !== 0) return refused();
  const path = join(folder, 'default-acl.json');
  const fd = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(fd, captured);
    // writeFileSync advances the descriptor offset; positional read must start
    // at zero instead of treating its end-of-file as an empty ACL manifest.
    const buffer = Buffer.alloc(Buffer.byteLength(captured));
    if (readSync(fd, buffer, 0, buffer.length, 0) !== buffer.length) return refused();
    const snapshot = buffer.toString('utf8');
    if (snapshot !== captured) return refused();
    const session = new OwnedSession(target);
    for (const scope of ['global', 'schema'] as const) {
      const before = await readDefaultAclManifest(target);
      const sql = buildDefaultAclRepair(snapshot, before, scope);
      if (sql) {
        // Only the already-existing local base superuser; no role creation,
        // blanket GRANT ALL, changing the user database or arbitrary target SQL.
        if ((await session.sql("select rolsuper from pg_roles where rolname='supabase_admin';")).trim() !== 't') return refused();
        await session.command('docker', ['exec', '-i', `supabase_db_${target.projectId}`, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], sql);
        process.stdout.write(`Recovery future-default source metadata reconstructed exactly: ${scope} scope; no new roles or blanket grants.\n`);
      }
    }
    if (await readDefaultAclManifest(target) !== snapshot) throw Error('Owned default ACL reconstruction did not match source');
  } finally { closeSync(fd); }
}

/** Includes every persisted per-schema template, including Supabase base
 * schemas, and implicit global defaults for every existing role/object kind.
 * PostgreSQL schema defaults ADD to (never subtract from) global defaults. */
export async function readDefaultAclManifest(target: OwnedTarget): Promise<string> {
  validateOwnedTarget(target);
  const output = (await new OwnedSession(target).sql(`
with scopes as (
 select r.oid role_id,0::oid schema_id,k.kind,g.oid is not null configured,
        coalesce(g.defaclacl,acldefault(k.kind,r.oid)) template,
        coalesce(g.defaclacl,acldefault(k.kind,r.oid)) global_acl
 from pg_roles r cross join (values ('r'::"char"),('S'::"char"),('f'::"char"),('T'::"char"),('n'::"char")) k(kind)
 left join pg_default_acl g on g.defaclrole=r.oid and g.defaclnamespace=0 and g.defaclobjtype=k.kind
 union all
 select d.defaclrole,d.defaclnamespace,d.defaclobjtype,true,d.defaclacl,
        coalesce(g.defaclacl,acldefault(d.defaclobjtype,d.defaclrole))
 from pg_default_acl d left join pg_default_acl g
 on g.defaclrole=d.defaclrole and g.defaclnamespace=0 and g.defaclobjtype=d.defaclobjtype
 where d.defaclnamespace<>0
), canonical as (
 select pg_get_userbyid(s.role_id) role,n.nspname schema,s.kind::text object_type,s.configured,
  (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable)
   order by pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type,a.is_grantable),'[]'::jsonb) from aclexplode(case when cardinality(s.template)>0 then s.template end) a) template,
  (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.grantable)
   order by pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type,a.grantable),'[]'::jsonb)
   from (select grantor,grantee,privilege_type,bool_or(is_grantable) grantable from (
    select * from aclexplode(case when cardinality(s.global_acl)>0 then s.global_acl end)
    union all select * from aclexplode(case when s.schema_id<>0 and cardinality(s.template)>0 then s.template end)
   ) permissions group by grantor,grantee,privilege_type) a) effective
 from scopes s left join pg_namespace n on n.oid=s.schema_id
)
select coalesce(jsonb_agg(jsonb_build_object('role',role,'schema',schema,'objectType',object_type,'configured',configured,'template',template,'effective',effective)
 order by role,schema nulls first,object_type),'[]'::jsonb) from canonical;
`)).trim();
  // PostgreSQL jsonb text has insignificant spaces; the protected companion
  // stores compact JSON. Compare canonical data, not those textual spaces.
  return JSON.stringify(JSON.parse(output) as unknown);
}

export async function verifyDefaultAclParity(source: OwnedTarget, target: OwnedTarget): Promise<boolean> {
  validateOwnedTarget(source); validateOwnedTarget(target);
  return await readDefaultAclManifest(source) === await readDefaultAclManifest(target);
}
