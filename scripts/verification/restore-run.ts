import { createOwnedEnvironment } from './runtime.ts';
import { OwnedSession } from './ownedSession.ts';
import { runIncrementalUpgrades } from './upgrades.ts';
import { createCurrentRecoverySnapshot, forgetRecoveryProof } from './recoveryFixture.ts';
import { verifyRestore, verifySecurityParity } from './restore.ts';
import { readDefaultAclManifest, verifyDefaultAclParity } from './defaultAcl.ts';

async function main() {
  if (process.argv.length !== 2) throw Error('Owned restore accepts no arguments or remote targets');
  const source = new OwnedSession(await createOwnedEnvironment(55420));
  let target: OwnedSession | undefined;
  let cleanupFailed: boolean;
  let failure: unknown;
  const interrupt = () => { source.cancel(); target?.cancel(); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    target = new OwnedSession(await createOwnedEnvironment(55520));
    process.stdout.write(`Recovery source=${source.target.projectId} target=${target.target.projectId}; ports 55420–55422 and 55520–55522; synthetic only.\n`);
    await source.start();
    const credentials = await runIncrementalUpgrades(source);
    await createCurrentRecoverySnapshot(source, credentials);
    // Fixture-only future permissions, after creating ALL application objects.
    // A matching base image alone cannot make this positive proof pass.
    await source.sql('alter default privileges for role postgres grant execute on functions to authenticated with grant option;alter default privileges for role postgres in schema private grant select on tables to authenticated;');
    process.stdout.write('Recovery current-schema synthetic snapshot + published export fixture prepared.\n');
    // Restore into the second pristine Supabase base (roles/extensions already
    // present). The archive itself restores the complete migration history.
    await target.start();
    const restored = await verifyRestore(source.target, target.target);
    if (!restored.businessRecordsEqual || !restored.authLoginWorks || !restored.permissionsVerified) throw Error('Owned recovery proof incomplete');
    process.stdout.write(`Recovery verified: ${JSON.stringify(restored)}\n`);
    // Negative control AFTER the positive recovery proof. Do not repair/toggle
    // permissions back: this target is disposed immediately after the check.
    await target.sql('revoke execute on function public.get_snapshot_export(jsonb,uuid,uuid) from authenticated;');
    if (await verifySecurityParity(source.target, target.target)) throw Error('Owned recovery comparator missed a real missing grant');
    process.stdout.write('Recovery negative control: one real target RPC grant revoked; complete security comparator rejected drift; no regrant before disposal.\n');
    const defaultsBefore = await readDefaultAclManifest(source.target);
    const beforeRows = JSON.parse(defaultsBefore) as { schema: string | null; role: string; objectType: string }[];
    await target.sql('alter default privileges for role postgres revoke execute on functions from authenticated;');
    if (await verifyDefaultAclParity(source.target, target.target)) throw Error('Owned recovery comparator missed future default privilege drift');
    const globalAfter = JSON.parse(await readDefaultAclManifest(target.target)) as typeof beforeRows;
    const globalScope = (r: typeof beforeRows[number]) => r.schema === null && r.role === 'postgres' && r.objectType === 'f';
    if (JSON.stringify(beforeRows.filter(globalScope)) === JSON.stringify(globalAfter.filter(globalScope))) throw Error('Owned recovery negative global default was not changed/detected');
    await target.sql('alter default privileges for role postgres in schema private grant select on tables to authenticated with grant option;');
    const schemaAfter = JSON.parse(await readDefaultAclManifest(target.target)) as typeof beforeRows;
    const schemaScope = (r: typeof beforeRows[number]) => r.schema === 'private' && r.role === 'postgres' && r.objectType === 'r';
    if (JSON.stringify(beforeRows.filter(schemaScope)) === JSON.stringify(schemaAfter.filter(schemaScope))) throw Error('Owned recovery negative schema default was not changed/detected');
    process.stdout.write('Recovery future-default negative control: real global EXECUTE and private-schema SELECT grant-option drift detected independently of existing object ACLs; no template repair/regrant before disposal.\n');
  } catch (error) {
    failure = error;
    process.stderr.write(`${error instanceof Error && /^Owned /.test(error.message) ? error.message : 'Owned recovery fixture failed; private diagnostic suppressed'}\n`);
  } finally {
    forgetRecoveryProof(source.target.marker);
    // Always attempt BOTH cleanups, even when the first fails. Each revalidates
    // ownership and preserves evidence if shutdown/label checks fail.
    cleanupFailed = false;
    for (const session of [source, ...(target ? [target] : [])]) {
      try { await session.cleanup(); } catch {
        // A partially stopped container is still ours. Retry the SAME guarded
        // project once, never widen to other projects or remove generic volumes.
        try { await session.cleanup(); } catch { cleanupFailed = true; }
      }
    }
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  }
  if (cleanupFailed) throw Error('Owned recovery cleanup failed; protected temporary project preserved');
  if (failure) throw failure;
}
void main().catch(error => {
  process.stderr.write(`${error instanceof Error && /^(Owned |Refused target|Verification port)/.test(error.message) ? error.message : 'Owned recovery failed; private diagnostic suppressed'}\n`);
  process.exitCode = 1;
});
