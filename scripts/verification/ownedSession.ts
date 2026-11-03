import { spawn } from 'node:child_process';
import { closeSync, constants, cpSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { repositoryRoot, validateOwnedTarget, type OwnedTarget } from './runtime.ts';

export type MigrationStage = 'pre_export' | 'pre_configuration' | 'current';
const stages = { pre_export: '20261019102000', pre_configuration: '20261019104000', current: '20261102108000' };
const exclude = 'studio,mailpit,logflare,vector,supavisor,edge-runtime,realtime,storage-api,imgproxy,postgres-meta';
export function isolatedEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { CI: '1', SUPABASE_TELEMETRY_DISABLED: 'true' };
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'LANG', 'SystemRoot']) if (process.env[name]) env[name] = process.env[name];
  return env;
}

/** Minimal T16 lifecycle. No arbitrary URL/path/SQL CLI. Every operation rechecks
 * the original marker/configuration; all command diagnostics remain private. */
export class OwnedSession {
  readonly target: OwnedTarget;
  private children = new Set<ReturnType<typeof spawn>>();
  private cancelled = false;
  private cleaning = false;
  constructor(target: OwnedTarget) { validateOwnedTarget(target); this.target = target; }
  cancel() { this.cancelled = true; for (const child of this.children) child.kill('SIGTERM'); }
  async command(binary: string, args: string[], input?: string, files?: { input?: number; output?: number }): Promise<string> {
    validateOwnedTarget(this.target);
    if (this.cancelled && !this.cleaning) throw Error('Owned operation interrupted');
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, { cwd: repositoryRoot, env: isolatedEnvironment(), stdio: [files?.input ?? 'pipe', files?.output ?? 'pipe', 'pipe'] });
      this.children.add(child);
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', chunk => { stdout += String(chunk); });
      child.stderr?.on('data', chunk => { stderr += String(chunk); });
      const timer = setTimeout(() => { child.kill('SIGTERM'); }, 180_000);
      child.once('error', () => { clearTimeout(timer); this.children.delete(child); reject(Error('Owned process launch failed')); });
      child.once('close', code => {
        clearTimeout(timer);
        this.children.delete(child);
        if (code === 0) { resolve(stdout); return; }
        // Classify private diagnostics, never echo SQL, values or dump content.
        const category = [/must be owner/i, /permission denied/i, /cannot drop.*depend/i, /already exists/i, /does not exist/i, /not found/i, /unrecognized/i, /duplicate key/i, /violates.*constraint/i, /unsupported version/i].find(pattern => pattern.test(stderr))?.source ?? 'private diagnostic suppressed';
        reject(Error(`Owned command failed: ${binary === 'docker' ? args.includes('pg_restore') ? 'pg_restore' : args.includes('pg_dump') ? 'pg_dump' : 'database' : 'Supabase lifecycle'} (${category})`));
      });
      child.stdin?.on('error', () => {});
      child.stdin?.end(input);
    });
  }
  cli(args: string[]) { return this.command(process.execPath, [join(repositoryRoot, 'node_modules/supabase/dist/supabase.js'), ...args, '--workdir', this.target.workdir]); }
  sql(query: string) { return this.command('docker', ['exec', '-i', `supabase_db_${this.target.projectId}`, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], query); }
  async start() { await this.cli(['start', '--exclude', exclude]); }
  async status(): Promise<Record<string, string>> {
    const data = JSON.parse(await this.cli(['status', '--output', 'json'])) as Record<string, string>;
    if (data.API_URL !== this.target.url || !data.ANON_KEY || !data.SERVICE_ROLE_KEY) throw Error('Owned service identity mismatch');
    return data;
  }
  async migrate(stage: MigrationStage) {
    validateOwnedTarget(this.target);
    if (!Object.hasOwn(stages, stage)) throw Error('Owned migration stage refused');
    const destination = join(this.target.workdir, 'supabase/migrations');
    mkdirSync(destination, { recursive: true });
    if (lstatSync(destination).isSymbolicLink() || realpathSync(destination) !== destination) throw Error('Owned migration destination refused');
    for (const name of readdirSync(join(repositoryRoot, 'supabase/migrations')).sort()) {
      // Names may carry digits (model3, demo_v1); a skipped migration would leave a
      // stage silently incomplete, so every staged prefix must be copied.
      if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name) || name.slice(0, 14) > stages[stage]) continue;
      const source = join(repositoryRoot, 'supabase/migrations', name);
      if (!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink()) throw Error('Owned migration source refused');
      const staged = join(destination, name);
      if (existsSync(staged) && (lstatSync(staged).isSymbolicLink() || !lstatSync(staged).isFile() || realpathSync(staged) !== staged)) throw Error('Owned migration destination refused');
      cpSync(source, staged, { errorOnExist: false });
      if (realpathSync(staged) !== staged || !lstatSync(staged).isFile() || !readFileSync(source).equals(readFileSync(staged))) throw Error('Owned migration copy mismatch');
    }
    await this.cli(['migration', 'up', '--local']);
    await this.sql("notify pgrst, 'reload schema';");
  }
  async seed() { await this.sql(readFileSync(join(repositoryRoot, 'supabase/seed.sql'), 'utf8')); }
  /** Binary dumps only in a protected child of the marked temporary project. */
  async dump(): Promise<string> {
    validateOwnedTarget(this.target);
    const folder = join(this.target.workdir, 'recovery'); mkdirSync(folder, { mode: 0o700 });
    const path = join(folder, 'synthetic.dump');
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await this.command('docker', ['exec', `supabase_db_${this.target.projectId}`, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--format=custom', '--schema=public', '--schema=private', '--schema=auth', '--schema=supabase_migrations'], undefined, { output: fd }); }
    finally { closeSync(fd); }
    return path;
  }
  async restoreFrom(source: OwnedSession, dump: string) {
    validateOwnedTarget(source.target); validateOwnedTarget(this.target);
    if (source.target.projectId === this.target.projectId || dump !== join(source.target.workdir, 'recovery/synthetic.dump') || realpathSync(dump) !== dump || !lstatSync(dump).isFile() || (lstatSync(dump).mode & 0o077) !== 0) throw Error('Owned restore artifact refused');
    if ((await this.sql("select rolsuper from pg_roles where rolname='supabase_admin';")).trim() !== 't') throw Error('Owned restore requires existing Supabase base superuser; no role was changed');
    const fd = openSync(dump, constants.O_RDONLY | constants.O_NOFOLLOW);
    // postgres is deliberately not a superuser in Supabase. Restoring Auth's
    // original owners/ACLs needs the already-existing local base superuser;
    // never strip ownership/grants and never grant extra roles to the app.
    try { await this.command('docker', ['exec', '-i', `supabase_db_${this.target.projectId}`, 'pg_restore', '-U', 'supabase_admin', '-d', 'postgres', '--clean', '--if-exists', '--exit-on-error'], undefined, { input: fd }); }
    finally { closeSync(fd); }
    await this.sql("notify pgrst, 'reload schema';");
  }
  async cleanup() {
    validateOwnedTarget(this.target);
    this.cleaning = true;
    await this.cli(['stop', '--project-id', this.target.projectId, '--no-backup']);
    for (const resource of ['container', 'volume', 'network']) {
      if ((await this.command('docker', [resource, 'ls', '--quiet', ...(resource === 'container' ? ['--all'] : []), '--filter', `label=com.supabase.cli.project=${this.target.projectId}`])).trim()) throw Error('Owned cleanup incomplete; protected temporary project preserved');
    }
    validateOwnedTarget(this.target);
    rmSync(this.target.workdir, { recursive: true });
    process.stdout.write(`Removed only owned disposable project: ${this.target.projectId}\n`);
  }
}
