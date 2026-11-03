import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { secondaryCredentials, type AcademicCredentials } from '../bootstrap/academicFixtures.ts';
import { command, completeMonth, contextOf, contexts, createAcademicIdentities, login, rpc, type Context } from './recoveryFixture.ts';
import { OwnedSession } from './ownedSession.ts';
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const snapshotDigest = `select md5(jsonb_build_object('headers',(select jsonb_agg(to_jsonb(f)-'competencia_codigo' order by id) from public.fechamentos f),'items',(select jsonb_agg(to_jsonb(i)-array['indicador_id','indicador_codigo','unidade_medida'] order by id) from public.itens_fechamento i))::text);`;
const historyDigest = `select md5(jsonb_build_object('revisions',(select jsonb_agg(to_jsonb(r)-'explicacao_correcao' order by id) from public.revisoes_entrada r),'decisions',(select jsonb_agg(to_jsonb(d) order by id) from public.decisoes_entrada d),'entries',(select jsonb_agg(to_jsonb(e)-'claim_revisao_atual_id' order by id) from public.entradas e),'positions',(select jsonb_agg(to_jsonb(p) order by id) from public.posicoes_esperadas p))::text);`;

/** Real ordered migrations. Invalid old records are adversarial fixtures under
 * enabled old constraints, not a claim that the old API created bad history. */
export async function runIncrementalUpgrades(session: OwnedSession): Promise<AcademicCredentials> {
  await session.migrate('pre_export'); await session.seed();
  const credentials = await createAcademicIdentities(session);
  const old = await completeMonth(session, credentials, 'ACADEMIC-2026-09');
  const frozenBefore = await session.sql(snapshotDigest);
  await session.migrate('pre_configuration');
  if (await session.sql(snapshotDigest) !== frozenBefore) throw Error('Owned T11 upgrade rewrote frozen snapshot');
  if ((await session.sql("select count(*) from public.fechamentos where competencia_codigo is not null; select count(*) from public.itens_fechamento where indicador_id is not null or indicador_codigo is not null or unidade_medida is not null;")).trim() !== '0\n0') throw Error('Owned T11 upgrade backfilled old snapshot metadata');
  const { ANON_KEY } = await session.status();
  const cam = await login(session.target.url, ANON_KEY, credentials.cam);
  try {
    const exportAttempt = await cam.rpc('get_snapshot_export', { p_contexto: contextOf(old.context), p_snapshot_id: old.snapshotId, p_operation_id: randomUUID() });
    if (exportAttempt.error?.code !== '55000' || exportAttempt.error.message !== 'snapshot_metadata_unavailable') throw Error('Owned old snapshot export did not fail closed');
  } finally { await cam.auth.signOut(); }
  process.stdout.write('Upgrade preT11 → T11/T12: real API snapshot retained IDs/values/checksum, no metadata backfill; export denied 55000/snapshot_metadata_unavailable.\n');

  const clients: SupabaseClient[] = [];
  const connect = async (c: { email: string; password: string }) => { const client = await login(session.target.url, ANON_KEY, c); clients.push(client); return client; };
  try {
    const technical = await connect(credentials.area_tecnica), reviewer = await connect(credentials.revisor_tecnico);
    const secondary = secondaryCredentials(credentials);
    const southTechnical = await connect(secondary.southTechnical), southReviewer = await connect(secondary.southReviewer);
    const admin = await connect(credentials.administrador);
    const northern = await contexts(technical, 'area_tecnica', 'ACADEMIC-2026-10');
    const southern = await contexts(southTechnical, 'area_tecnica', 'ACADEMIC-2026-10');
    const cases: { kind: string; context: Context; position: string; revision: string; reviewer: SupabaseClient; reviewContext: Context; version: number }[] = [];
    for (const [index, tc] of [...northern, southern[0]].entries()) {
      const t = index < northern.length ? technical : southTechnical;
      const r = index < northern.length ? reviewer : southReviewer;
      const rc = (await contexts(r, 'revisor_tecnico', 'ACADEMIC-2026-10')).find(c => c.escopoId === tc.escopoId)!;
      const position = (await rpc(t, 'get_operational_positions', { p_contexto: contextOf(tc), p_filters: {} })).items[0];
      let receipt = await command(t, 'save_position_draft', tc, { p_position_id: position.id, p_expected_version: position.version, p_input: { estadoDado: 'valor', valor: '10', fonte: 'PreT13 synthetic upgrade', periodoFonte: '2026-10-01', motivo: '' } });
      receipt = await command(t, 'submit_position', tc, { p_position_id: position.id, p_expected_version: receipt.version });
      const kind = ['unique', 'missing', 'ambiguous', 'incompatible'][index];
      if (kind !== 'missing') receipt = await command(r, 'start_position_review', rc, { p_position_id: position.id, p_expected_version: receipt.version });
      else await session.sql(`update public.entradas set estado='em_revisao' where posicao_id=${literal(position.id)}::uuid;`);
      if (kind === 'ambiguous') await session.sql(`insert into public.decisoes_entrada(revisao_id,ator_id,tipo,motivo) values(${literal(receipt.revisionId)}::uuid,${literal(rc.actorId)}::uuid,'iniciar_revisao','FIXTURE ADVERSARIAL: duplicate preT13 claim');`);
      if (kind === 'incompatible') {
        const ac = (await contexts(admin, 'administrador', 'ACADEMIC-2026-10'))[0];
        const newReviewerId = (await contexts(reviewer, 'revisor_tecnico', 'ACADEMIC-2026-10'))[0].actorId;
        await command(admin, 'set_demo_business_link', ac, { p_actor_id: newReviewerId, p_expected_version: 0, p_input: { role: 'revisor_tecnico', escopoId: tc.escopoId, indicadorId: tc.indicadorId, ativo: true, vigenciaInicio: '2026-01-01', vigenciaFim: null } });
        await session.sql(`update public.posicoes_esperadas set revisor_id=${literal(newReviewerId)}::uuid where id=${literal(position.id)}::uuid;`);
        const newReviewer = (await contexts(reviewer, 'revisor_tecnico', 'ACADEMIC-2026-10')).find(c => c.escopoId === tc.escopoId)!;
        if (!newReviewer) throw Error('Owned incompatible fixture reviewer link missing');
        cases.push({ kind, context: tc, position: position.id, revision: receipt.revisionId, reviewer, reviewContext: newReviewer, version: receipt.version });
      } else cases.push({ kind, context: tc, position: position.id, revision: receipt.revisionId, reviewer: r, reviewContext: rc, version: receipt.version });
    }
    const before = await session.sql(historyDigest);
    const guards = (await session.sql("select count(*) from pg_trigger where tgrelid in ('public.decisoes_entrada'::regclass,'public.revisoes_entrada'::regclass,'public.entradas'::regclass) and not tgisinternal and tgenabled<>'O';")).trim();
    if (guards !== '0') throw Error('Owned preT13 fixture disabled a guard');
    await session.migrate('current');
    if (await session.sql(historyDigest) !== before) throw Error('Owned T13 upgrade rewrote payload/author/history');
    for (const item of cases) {
      const pointer = (await session.sql(`select coalesce(claim_revisao_atual_id::text,'null') from public.entradas where posicao_id=${literal(item.position)}::uuid;`)).trim();
      if ((item.kind === 'unique') === (pointer === 'null')) throw Error('Owned T13 upgrade guessed/missed historical claim');
      const result = await item.reviewer.rpc('review_position', { p_contexto: contextOf(item.reviewContext), p_position_id: item.position, p_expected_version: item.version, p_decision: 'accept', p_reason: 'Post upgrade independent check', p_operation_id: randomUUID() });
      if (item.kind === 'unique' ? !!result.error : result.error?.code !== '55000') throw Error(`Owned T13 ${item.kind} upgrade review guard failed`);
    }
    process.stdout.write('Upgrade preT13 → T13: unique API claim recovered; missing/ambiguous/incompatible adversarial old-state fixtures null/fail-closed 55000; enabled guards and payload/actor/decision checksums preserved.\n');
  } finally { for (const client of clients) await client.auth.signOut(); }
  return credentials;
}
