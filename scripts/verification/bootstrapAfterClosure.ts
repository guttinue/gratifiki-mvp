import { createClient } from '@supabase/supabase-js';
import { bootstrapAcademicDemo } from '../bootstrap/academicDemo.ts';
import type { AcademicCredentials } from '../bootstrap/academicFixtures.ts';
import { Connection } from './concurrency.ts';
import { validateOwnedTarget, type OwnedTarget } from './runtime.ts';

// Every business, history and identity table the bootstrap could touch. Whole
// rows are compared, so a changed ID, version, state or credential is caught.
const tables = ['competencias','posicoes_esperadas','territorios_competencia','escopos','vinculos','contas_demo','regras','ativacoes_regra',
  'entradas','revisoes_entrada','decisoes_entrada','resultados','fechamentos','itens_fechamento','publicacoes','operacoes_dominio','eventos_auditoria',
  'pontuacoes_fechamento','conjuntos_regra','itens_conjunto'];
const digest = `select jsonb_build_object(${[
  ...tables.map(t => `'${t}',(select md5(coalesce(string_agg(r::text,'|' order by r::text),'')) from public.${t} r)`),
  `'auth.users',(select md5(coalesce(string_agg(concat_ws(':',id,email,encrypted_password,created_at),'|' order by id),'')) from auth.users)`,
].join(',')})::text;`;

// I4: bootstrap -> close -> publish -> bootstrap must be an exact no-op on a
// real database with the BEFORE INSERT closed-cycle guards active.
export async function verifyBootstrapAfterClosure(target: OwnedTarget, serviceKey: string, credentials: AcademicCredentials, expectedActors: unknown) {
  validateOwnedTarget(target);
  const connection = new Connection(target);
  try {
    const closed = await connection.query(`select count(*)::text||':'||(select count(*) from public.publicacoes)::text from public.fechamentos;`);
    if (!/^[1-9][0-9]*:[1-9][0-9]*$/.test(closed)) throw Error('Owned bootstrap-after-closure fixture has no closed and published competence');
    const before = await connection.query(digest);
    const admin = createClient(target.url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const repeated = await bootstrapAcademicDemo(admin, credentials).catch(() => { throw Error('Owned bootstrap after closure failed'); });
    if (JSON.stringify(repeated) !== JSON.stringify(expectedActors)) throw Error('Owned bootstrap after closure changed actor identities');
    if (await connection.query(digest) !== before) throw Error('Owned bootstrap after closure changed persisted state');
    process.stdout.write(`Bootstrap after closure/publication: ${closed.replace(':',' closed / ')} published; actors and ${tables.length + 1} tables unchanged.\n`);
  } finally {
    await connection.close();
  }
}
