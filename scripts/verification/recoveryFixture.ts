import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { runAcademicBootstrap } from '../bootstrap/academicDemo-run.ts';
import { academicRoles, secondaryCredentials, type AcademicCredentials } from '../bootstrap/academicFixtures.ts';
import { OwnedSession } from './ownedSession.ts';
import type { CommandContext } from '../../src/features/pilot/types.ts';

export type Context = CommandContext & { actorId: string; escopoId: string; escopoCodigo: string; competenciaCodigo: string; role: string };
export const contextOf = (c: CommandContext): CommandContext => ({ vinculoId: c.vinculoId, competenciaId: c.competenciaId, indicadorId: c.indicadorId });
export async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown> = {}) {
  const result = await client.rpc(name, args);
  if (result.error) throw Error(`Owned fixture RPC failed: ${name} (${result.error.code})`);
  return result.data;
}
export const command = (client: SupabaseClient, name: string, c: CommandContext, args: Record<string, unknown>, id = randomUUID()) => rpc(client, name, { p_contexto: contextOf(c), ...args, p_operation_id: id });
export async function contexts(client: SupabaseClient, role: string, month: string): Promise<Context[]> {
  return ((await rpc(client, 'get_authorized_contexts')).contexts as Context[]).filter(c => c.role === role && c.competenciaCodigo === month);
}
export async function login(url: string, key: string, credential: { email: string; password: string }) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  if ((await client.auth.signInWithPassword(credential)).error) throw Error('Owned recovery login failed');
  return client;
}
export type RecoveryProof = { credentials: AcademicCredentials; context: Context; snapshotId: string; operationId: string; bundle: unknown };
// Only this process's fixture, never credentials in DTO/files/arguments/logs.
const proofs = new Map<string, RecoveryProof>();
export function getRecoveryProof(marker: string) { const proof = proofs.get(marker); if (!proof) throw Error('Owned recovery fixture missing'); return proof; }
export function forgetRecoveryProof(marker: string) { proofs.delete(marker); }
async function bootstrapEnvironment(session: OwnedSession, credentials: AcademicCredentials): Promise<NodeJS.ProcessEnv> {
  const status = await session.status();
  const env: NodeJS.ProcessEnv = { SUPABASE_URL: session.target.url, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY };
  for (const [role, credential] of Object.entries(credentials)) {
    env[`ACADEMIC_${role.toUpperCase()}_EMAIL`] = credential.email;
    env[`ACADEMIC_${role.toUpperCase()}_PASSWORD`] = credential.password;
  }
  return env;
}
// legacyOnly: the session is still on a schema before the V3 migrations.
export async function createAcademicIdentities(session: OwnedSession, options: { legacyOnly?: boolean } = {}): Promise<AcademicCredentials> {
  const status = await session.status();
  const credentials = Object.fromEntries(academicRoles.map(role => [role, { email: `${role}@recovery.invalid`, password: randomUUID() }])) as AcademicCredentials;
  const env = await bootstrapEnvironment(session, credentials);
  const first = await runAcademicBootstrap(env, options), second = await runAcademicBootstrap(env, options);
  if (JSON.stringify(first) !== JSON.stringify(second)) throw Error('Owned academic CLI bootstrap identity mismatch');
  process.stdout.write('Academic local CLI entrypoint: seven principals + three derived fixtures provisioned twice, IDs preserved; no reset/credential rotation.\n');
  const anon = createClient(session.target.url, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const attempt = await anon.auth.signUp({ email: 'uninvited@recovery.invalid', password: randomUUID() });
  if (attempt.data.user || !attempt.error || attempt.error.code !== 'signup_disabled') throw Error('Owned public signup was not rejected');
  process.stdout.write('Auth public signup: signup_disabled; no user created.\n');
  return credentials;
}
// After the last migration: the full bootstrap adds the V3 (DEMO-v1) months,
// links and states, including a closed and published V3 month, so the restore
// manifest and ACL comparison cover the V3 tables with rows.
export async function seedCurrentSchema(session: OwnedSession, credentials: AcademicCredentials) {
  const env = await bootstrapEnvironment(session, credentials);
  const first = await runAcademicBootstrap(env), second = await runAcademicBootstrap(env);
  if (JSON.stringify(first) !== JSON.stringify(second)) throw Error('Owned academic V3 bootstrap identity mismatch');
  const scored = (await session.sql('select count(*) from public.pontuacoes_fechamento;')).trim();
  if (!/^[1-9][0-9]*$/.test(scored)) throw Error('Owned V3 bootstrap closed no model-3 competence');
  process.stdout.write(`Current schema V3 bootstrap: DEMO-v1 months/links/states seeded after the last migration (${scored} frozen unit scores); repeat run kept identities.\n`);
}
export async function completeMonth(session: OwnedSession, credentials: AcademicCredentials, month: string) {
  const { ANON_KEY } = await session.status();
  const actors = { ...credentials, ...secondaryCredentials(credentials) };
  const clients: SupabaseClient[] = [];
  const connect = async (credential: { email: string; password: string }) => { const c = await login(session.target.url, ANON_KEY, credential); clients.push(c); return c; };
  try {
    const reviewClients = [await connect(actors.revisor_tecnico), await connect(actors.southReviewer)];
    const reviewContexts = await Promise.all(reviewClients.map(async client => ({ client, contexts: await contexts(client, 'revisor_tecnico', month) })));
    for (const side of ['', 'south']) {
      const technical = await connect(side ? actors.southTechnical : actors.area_tecnica);
      for (const tc of await contexts(technical, 'area_tecnica', month)) {
        const p = (await rpc(technical, 'get_operational_positions', { p_contexto: contextOf(tc), p_filters: { page: 1, pageSize: 25 } })).items[0];
        let r = await command(technical, 'save_position_draft', tc, { p_position_id: p.id, p_expected_version: p.version, p_input: { estadoDado: 'valor', valor: '10', fonte: 'Synthetic recovery source', periodoFonte: '2026-10-01', motivo: '' } });
        r = await command(technical, 'submit_position', tc, { p_position_id: p.id, p_expected_version: r.version });
        const review = reviewContexts.find(r => r.contexts.some(c => c.escopoId === tc.escopoId));
        if (!review) throw Error('Owned recovery position has no assigned reviewer context');
        const reviewer = review.client, rc = review.contexts.find(c => c.escopoId === tc.escopoId)!;
        r = await command(reviewer, 'start_position_review', rc, { p_position_id: p.id, p_expected_version: r.version });
        await command(reviewer, 'review_position', rc, { p_position_id: p.id, p_expected_version: r.version, p_decision: 'accept', p_reason: 'Independent synthetic check' });
      }
    }
    const cam = await connect(actors.cam);
    const context = (await contexts(cam, 'cam', month))[0];
    let check = await rpc(cam, 'get_cycle_checklist', { p_contexto: contextOf(context) });
    await command(cam, 'transition_cycle', context, { p_expected_version: check.version, p_action: 'consolidate', p_reason: '', p_reference: '' });
    check = await rpc(cam, 'get_cycle_checklist', { p_contexto: contextOf(context) });
    await command(cam, 'transition_cycle', context, { p_expected_version: check.version, p_action: 'close', p_reason: 'Synthetic recovery', p_reference: 'DEMO-DECISAO-RECOVERY' });
    check = await rpc(cam, 'get_cycle_checklist', { p_contexto: contextOf(context) });
    return { context, snapshotId: check.snapshotId as string };
  } finally { for (const client of clients) await client.auth.signOut(); }
}
export async function createCurrentRecoverySnapshot(session: OwnedSession, credentials: AcademicCredentials) {
  const { ANON_KEY } = await session.status();
  const admin = await login(session.target.url, ANON_KEY, credentials.administrador);
  try {
    const ac = (await contexts(admin, 'administrador', 'ACADEMIC-2026-10'))[0];
    const config = await rpc(admin, 'get_demo_configuration', { p_contexto: contextOf(ac) });
    const assignments = config.positions.filter((p: { competenceId: string }) => p.competenceId === ac.competenciaId).map((p: { escopoId: string; informanteId: string; revisorId: string; aplicavel: boolean }) => ({ escopoId: p.escopoId, informanteId: p.informanteId, revisorId: p.revisorId, aplicavel: p.aplicavel }));
    await command(admin, 'open_demo_competence', ac, { p_reference: '2026-11-01', p_assignments: assignments });
  } finally { await admin.auth.signOut(); }
  const { context, snapshotId } = await completeMonth(session, credentials, 'ACADEMIC-2026-11');
  const cam = await login(session.target.url, ANON_KEY, credentials.cam);
  try {
    await command(cam, 'publish_cycle_demo', context, { p_snapshot_id: snapshotId, p_reference: 'DEMO-PUBLICACAO-RECOVERY' });
    const operationId = randomUUID();
    const bundle = await command(cam, 'get_snapshot_export', context, { p_snapshot_id: snapshotId }, operationId);
    proofs.set(session.target.marker, { credentials, context, snapshotId, operationId, bundle });
  } finally { await cam.auth.signOut(); }
}
