import { validateOwnedTarget, type OwnedTarget } from './runtime.ts';
import { OwnedSession } from './ownedSession.ts';
import { academicRoles } from '../bootstrap/academicFixtures.ts';
import { contextOf, contexts, getRecoveryProof, login, rpc } from './recoveryFixture.ts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readDefaultAclManifest, restoreCapturedDefaultAcls } from './defaultAcl.ts';

async function manifest(session: OwnedSession): Promise<string> {
  return (await session.sql(`create function pg_temp.recovery_manifest() returns jsonb language plpgsql as $$
declare r record; n bigint; checksum text; result jsonb:='{}'::jsonb;
begin
 for r in select schemaname,tablename from pg_tables where schemaname in ('public','private','auth','supabase_migrations') order by schemaname,tablename loop
  execute format('select count(*),md5(coalesce(string_agg(j,E''\\n'' order by j),'''')) from (select to_jsonb(t)::text j from %I.%I t)s',r.schemaname,r.tablename) into n,checksum;
  result:=result||jsonb_build_object(r.schemaname||'.'||r.tablename,jsonb_build_object('count',n,'checksum',checksum));
 end loop;return result;
end;$$;select pg_temp.recovery_manifest();`)).trim();
}
async function securityManifest(session: OwnedSession): Promise<string> {
  const existing = JSON.parse((await session.sql(`create function pg_temp.canonical_acl(a aclitem[],kind "char",owner_id oid) returns jsonb language sql as $$select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(grantor),'grantee',case when grantee=0 then 'PUBLIC' else pg_get_userbyid(grantee) end,'privilege',privilege_type,'grantable',is_grantable) order by pg_get_userbyid(grantor),case when grantee=0 then 'PUBLIC' else pg_get_userbyid(grantee) end,privilege_type,is_grantable) from aclexplode(coalesce(a,acldefault(kind,owner_id)));$$;
 select jsonb_build_object(
 'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p where schemaname in ('public','private','auth')),
 'grants',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'relation',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'acl',pg_temp.canonical_acl(c.relacl,case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner)) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','auth') and c.relkind in ('r','S','v')),
 'schemas',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',pg_temp.canonical_acl(n.nspacl,'n',n.nspowner)) order by n.nspname) from pg_namespace n where n.nspname in ('public','private','auth')),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'acl',pg_temp.canonical_acl(p.proacl,'f',p.proowner),'definer',p.prosecdef,'config',p.proconfig) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','auth')),
 'triggers',(select jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by n.nspname,c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','auth') and not t.tgisinternal));`)).trim()) as Record<string, unknown>;
  return JSON.stringify({ ...existing, defaultAcls: JSON.parse(await readDefaultAclManifest(session.target)) as unknown });
}
async function restorePublicDefaultUsage(fromSecurity: string, target: OwnedSession) {
  const before = JSON.parse(fromSecurity) as { schemas: { schema: string; owner: string; acl: unknown[] }[] };
  const after = JSON.parse(await securityManifest(target)) as typeof before;
  if (JSON.stringify(before.schemas) === JSON.stringify(after.schemas)) return;
  // pg_dump treats public's initial PUBLIC USAGE as an initdb default and can
  // omit its GRANT against Supabase's hardened target baseline. Reconstruct
  // ONLY that exact proven source privilege, never blanket/default GRANT ALL.
  const expected = { grantee: 'PUBLIC', grantor: 'pg_database_owner', grantable: false, privilege: 'USAGE' };
  const schema = before.schemas.find(s => s.schema === 'public');
  const index = schema?.acl.findIndex(a => JSON.stringify(a) === JSON.stringify(expected)) ?? -1;
  if (!schema || schema.owner !== 'pg_database_owner' || index < 0) throw Error('Owned restore unsupported schema privilege drift');
  const withoutDefault = structuredClone(before.schemas);
  withoutDefault.find(s => s.schema === 'public')!.acl.splice(index, 1);
  if (JSON.stringify(withoutDefault) !== JSON.stringify(after.schemas)) throw Error('Owned restore unexpected schema privilege drift');
  await target.command('docker', ['exec', '-i', `supabase_db_${target.target.projectId}`, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], 'begin;set local role pg_database_owner;grant usage on schema public to public;commit;');
  process.stdout.write('Recovery public schema: restored exactly source PUBLIC USAGE omitted as pg_dump initdb default; owner/grantor/grantable preserved, no GRANT ALL or table grants.\n');
}
export async function verifySecurityParity(source: OwnedTarget, target: OwnedTarget): Promise<boolean> {
  validateOwnedTarget(source); validateOwnedTarget(target);
  return await securityManifest(new OwnedSession(source)) === await securityManifest(new OwnedSession(target));
}
export async function verifyRestore(source: OwnedTarget, target: OwnedTarget): Promise<{ businessRecordsEqual: boolean; authLoginWorks: boolean; permissionsVerified: boolean }> {
  validateOwnedTarget(source); validateOwnedTarget(target);
  if (source.projectId === target.projectId || source.workdir === target.workdir || source.url === target.url) throw Error('Owned restore requires distinct source and target');
  const proof = getRecoveryProof(source.marker);
  const from = new OwnedSession(source), to = new OwnedSession(target);
  if ((await to.sql("select (select count(*) from auth.users)+(select count(*) from pg_tables where schemaname in ('public','private'));")).trim() !== '0') throw Error('Owned restore requires a pristine empty disposable target');
  const actors = JSON.parse((await from.sql('select jsonb_object_agg(email,id) from auth.users;')).trim()) as Record<string, string>;
  const records = await manifest(from), security = await securityManifest(from);
  const dump = await from.dump();
  await to.restoreFrom(from, dump);
  await restorePublicDefaultUsage(security, to);
  await restoreCapturedDefaultAcls(source, target, JSON.stringify((JSON.parse(security) as { defaultAcls: unknown }).defaultAcls));
  const restoredRecords = await manifest(to), restoredSecurity = await securityManifest(to);
  const businessRecordsEqual = restoredRecords === records;
  if (!businessRecordsEqual || restoredSecurity !== security) {
    const before = JSON.parse(records) as Record<string, { count: number; checksum: string }>;
    const after = JSON.parse(restoredRecords) as typeof before;
    const tables = Object.keys(before).filter(name => JSON.stringify(before[name]) !== JSON.stringify(after[name]));
    const beforeSecurity = JSON.parse(security) as Record<string, unknown>, afterSecurity = JSON.parse(restoredSecurity) as Record<string, unknown>;
    const sections = Object.keys(beforeSecurity).filter(name => JSON.stringify(beforeSecurity[name]) !== JSON.stringify(afterSecurity[name]));
    // Names/categories only. Never row data, credential hashes, SQL or secrets.
    process.stdout.write(`Recovery mismatch names only: tables=${tables.join(',') || 'none'}; security=${sections.join(',') || 'none'}\n`);
    if (sections.includes('schemas')) process.stdout.write(`Recovery schema permissions only (no rows/secrets): source=${JSON.stringify(beforeSecurity.schemas)} target=${JSON.stringify(afterSecurity.schemas)}\n`);
    throw Error('Owned restore count/checksum/grants/policies mismatch');
  }
  process.stdout.write('Recovery manifest: ALL public/private/Auth/migration tables equal by count + ordered MD5 row checksum; owners/grants/RLS/policies/function ACLs/triggers + pg_default_acl global/schema/role/objectType/template/effective/grantor/grantable equal. Raw dump private in owned temp only.\n');
  const { ANON_KEY } = await to.status();
  const clients: SupabaseClient[] = [];
  let authLoginWorks = true;
  try {
    for (const role of academicRoles) {
      const client = await login(target.url, ANON_KEY, proof.credentials[role]); clients.push(client);
      const allowed = await contexts(client, role, 'ACADEMIC-2026-11');
      if (!allowed.length || allowed.some(c => c.actorId !== actors[proof.credentials[role].email])) authLoginWorks = false;
    }
    if (!authLoginWorks) throw Error('Owned restored identities lost authorized contexts');
    const cam = clients[academicRoles.indexOf('cam')];
    const bundle = await rpc(cam, 'get_snapshot_export', { p_contexto: contextOf(proof.context), p_snapshot_id: proof.snapshotId, p_operation_id: proof.operationId });
    if (JSON.stringify(bundle) !== JSON.stringify(proof.bundle)) throw Error('Owned restored export differs');
    const positions = await rpc(cam, 'get_operational_positions', { p_contexto: contextOf(proof.context), p_filters: {} });
    const detail = await rpc(cam, 'get_position_detail', { p_contexto: contextOf(proof.context), p_position_id: positions.items[0].id });
    if (!detail.memories?.length || !detail.decisions?.length || !detail.revisions?.length) throw Error('Owned restored memory/review evidence missing');
    const manager = clients[academicRoles.indexOf('gestor_unidade')];
    const mc = (await contexts(manager, 'gestor_unidade', 'ACADEMIC-2026-11'))[0];
    const own = await rpc(manager, 'get_my_evaluations', { p_contexto: contextOf(mc), p_view: 'own', p_filters: {} });
    if (own.items.length !== 1 || own.items[0].publication !== 'publicada_demo' || own.items[0].resultValue !== '8') throw Error('Owned restored scoped snapshot lost');
    if ((await manager.rpc('get_snapshot_export', { p_contexto: contextOf(proof.context), p_snapshot_id: proof.snapshotId, p_operation_id: proof.operationId })).error?.code !== '42501') throw Error('Owned restored foreign RPC access allowed');
    const direct = await manager.from('entradas').select('id').not('posicao_id', 'is', null);
    if (direct.error || direct.data?.length) throw Error('Owned restored RLS leaked academic records');
    const anon = createClient(target.url, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const choices = await anon.rpc('get_authorized_contexts');
    if (choices.error || JSON.stringify(choices.data) !== '{"contexts":[]}') throw Error('Owned restored anonymous discovery leaked contexts');
    if ((await anon.rpc('get_snapshot_export', { p_contexto: contextOf(proof.context), p_snapshot_id: proof.snapshotId, p_operation_id: proof.operationId })).error?.code !== '42501') throw Error('Owned restored anonymous export allowed');
    const signup = await anon.auth.signUp({ email: 'uninvited-after-restore@recovery.invalid', password: crypto.randomUUID() });
    if (signup.data.user || signup.error?.code !== 'signup_disabled') throw Error('Owned restored signup opened');
    process.stdout.write('Recovery identities: seven original passwords login to original actor/context IDs; restored memory/decisions/published snapshot/export pass; manager foreign RPC + anonymous export + direct RLS + signup denied; anonymous discovery empty.\n');
    return { businessRecordsEqual, authLoginWorks, permissionsVerified: true };
  } finally { for (const client of clients) await client.auth.signOut(); }
}
