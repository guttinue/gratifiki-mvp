import { randomUUID } from 'node:crypto';
import type { AcademicCredentials } from '../bootstrap/academicFixtures.ts';
import { Connection, blockedBy } from './concurrency.ts';
import { OwnedSession } from './ownedSession.ts';
import { contextOf, contexts, login } from './recoveryFixture.ts';
import { validateOwnedTarget, type OwnedTarget } from './runtime.ts';
const literal = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;

export async function runAdminConcurrency(target: OwnedTarget, key: string, credentials: AcademicCredentials) {
  validateOwnedTarget(target);
  const client = await login(target.url, key, credentials.administrador);
  const a = new Connection(target), b = new Connection(target);
  try {
    const first = (await contexts(client, 'administrador', 'ACADEMIC-2026-09'))[0];
    const second = (await contexts(client, 'administrador', 'ACADEMIC-2026-10'))[0];
    if (!first || !second) throw Error('Owned admin concurrency requires two contexts');
    const scope = randomUUID();
    await new OwnedSession(target).sql(`insert into public.escopos(id,codigo,tipo) values(${literal(scope)}::uuid,'ACADEMIC-RACE-START','distrito');`);
    const pid = await b.query('select pg_backend_pid();');
    await b.query(`create function pg_temp.capture(q text) returns text language plpgsql as $$declare result text;begin execute q into result;return result;exception when others then return sqlstate||':'||sqlerrm;end;$$;select set_config('request.jwt.claim.sub',${literal(first.actorId)},false);set role authenticated;`);
    const sql = (c: typeof first, version: number, code: string, op: string) => `select public.save_demo_scope(${literal(JSON.stringify(contextOf(c)))}::jsonb,${literal(scope)}::uuid,${version},${literal(JSON.stringify({ codigo: code, tipo: 'distrito', distritoId: null, ativo: true }))}::jsonb,${literal(op)}::uuid)`;
    async function race(version: number, sameUuid: boolean) {
      const operation = randomUUID(), other = sameUuid ? operation : randomUUID();
      await a.query(`begin;select id from public.competencias where id=${literal(first.competenciaId)}::uuid for update;select pg_advisory_xact_lock(hashtextextended('academic:admin-catalog',0));`);
      const loser = b.query(`select pg_temp.capture(${literal(sql(second, version, `ACADEMIC-RACE-${version}`, other))});`);
      await blockedBy(a, pid);
      const exactLock = await a.query(`select exists(select 1 from pg_locks where pid=${Number(pid)} and locktype='advisory' and not granted and classid=((hashtextextended('academic:admin-catalog',0)>>32)&4294967295)::oid and objid=(hashtextextended('academic:admin-catalog',0)&4294967295)::oid);`);
      if (exactLock !== 't') throw Error('Owned admin race did not wait on global catalogue lock');
      await a.query(`select set_config('request.jwt.claim.sub',${literal(first.actorId)},false);set role authenticated;${sql(first, version, `ACADEMIC-RACE-${version}`, operation)};commit;reset role;`);
      const failure = await loser;
      if (failure !== (sameUuid ? '22023:operation_payload_mismatch' : '40001:version_conflict')) throw Error('Owned admin concurrent conflict category incorrect');
      if ((await a.query(`select count(*) from public.eventos_auditoria where correlacao_id=${literal(operation)}::uuid and acao='escopo_demo_salvo';`)) !== '1') throw Error('Owned admin race duplicated/missed audit event');
      if ((await a.query(`select lock_version from public.escopos where id=${literal(scope)}::uuid;`)) !== String(version + 1)) throw Error('Owned admin race changed resource more than once');
    }
    await race(1, false);
    await race(2, true);
    if ((await a.query(`select count(*) from public.operacoes_dominio where comando='save_demo_scope' and resposta->>'resourceId'=${literal(scope)};`)) !== '2') throw Error('Owned admin race duplicated operation');
    process.stdout.write('Admin concurrency cross-competence: two real sessions; observed exact global catalogue advisory wait after distinct competence locks; same version → one winner/40001; same actor+UUID different contexts → one winner/22023 payload mismatch; two total mutations/events/operations.\n');
  } finally { await Promise.all([a.close(), b.close()]); await client.auth.signOut(); }
}
