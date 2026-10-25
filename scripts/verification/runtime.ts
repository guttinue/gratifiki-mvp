import { createHash, randomUUID } from "node:crypto";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface OwnedTarget { projectId: string; workdir: string; url: string; marker: string }

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const markerFile = ".owned-verification.json";

export async function assertPortAvailable(port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid verification port");
  for (const host of ["127.0.0.1", "::1", "0.0.0.0"]) {
    await new Promise<void>((resolvePort, reject) => {
      const server = createServer();
      server.once("error", () => reject(new Error(`Verification port ${port} is occupied or unavailable; no process was stopped`)));
      server.listen({ port, host, exclusive: true }, () => server.close((error) => error ? reject(error) : resolvePort()));
    });
  }
}

export async function createOwnedEnvironment(portBase = 55420): Promise<OwnedTarget> {
  for (const port of [portBase, portBase + 1, portBase + 2]) await assertPortAvailable(port);
  const workdir = realpathSync(mkdtempSync(join(tmpdir(), "gratifiki-verification-")));
  try {
    const target = {
      projectId: `gratifiki-verify-${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      workdir,
      url: `http://127.0.0.1:${portBase + 1}`,
      marker: randomUUID(),
    };
    mkdirSync(join(workdir, "supabase"));
    // Stage public migrations until after start: only migration up applies them.
    cpSync(join(repositoryRoot, "supabase/migrations"), join(workdir, "inputs/migrations"), { recursive: true });
    cpSync(join(repositoryRoot, "supabase/tests"), join(workdir, "supabase/tests"), { recursive: true });
    cpSync(join(repositoryRoot, "supabase/seed.sql"), join(workdir, "supabase/seed.sql"));
    writeFileSync(join(workdir, "supabase/config.toml"), `project_id = "${target.projectId}"
[api]
port = ${portBase + 1}
[db]
port = ${portBase + 2}
shadow_port = ${portBase}
major_version = 17
[db.seed]
enabled = false
[db.pooler]
enabled = false
[studio]
enabled = false
[inbucket]
enabled = false
[analytics]
enabled = false
[edge_runtime]
enabled = false
[auth]
enable_signup = false
site_url = "http://127.0.0.1:4175"
[auth.rate_limit]
sign_in_sign_ups = 1000
token_refresh = 1000
`);
    const configDigest = createHash("sha256").update(readFileSync(join(workdir, "supabase/config.toml"))).digest("hex");
    writeFileSync(join(workdir, markerFile), JSON.stringify({ ...target, configDigest }), { mode: 0o600, flag: "wx" });
    return target;
  } catch (error) {
    rmSync(workdir, { recursive: true, force: true });
    throw error;
  }
}

export function validateOwnedTarget(target: OwnedTarget): void {
  try {
    const root = realpathSync(target.workdir);
    const url = new URL(target.url);
    if (root !== target.workdir || dirname(root) !== realpathSync(tmpdir()) ||
        !/^gratifiki-verification-[A-Za-z0-9]+$/.test(basename(root)) ||
        !/^gratifiki-verify-[a-f0-9]{16}$/.test(target.projectId) ||
        !/^[a-f0-9-]{36}$/.test(target.marker) ||
        url.protocol !== "http:" || url.hostname !== "127.0.0.1" ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash || !url.port) throw new Error();
    const markerPath = join(root, markerFile);
    if (!lstatSync(markerPath).isFile() || lstatSync(markerPath).isSymbolicLink()) throw new Error();
    const saved = JSON.parse(readFileSync(markerPath, "utf8")) as OwnedTarget & { configDigest: string };
    for (const key of ["projectId", "workdir", "url", "marker"] as const) {
      if (saved[key] !== target[key]) throw new Error();
    }
    const config = readFileSync(join(root, "supabase/config.toml"), "utf8");
    if (!config.startsWith(`project_id = "${target.projectId}"\n`) ||
        createHash("sha256").update(config).digest("hex") !== saved.configDigest) throw new Error();
  } catch {
    throw new Error("Refused target: only this run's marked temporary verification project is allowed");
  }
}

export function redactOutput(output: string, privateValues: readonly string[]): string {
  let safe = output;
  for (const value of [...privateValues].filter(Boolean).sort((a, b) => b.length - a.length)) {
    safe = safe.replaceAll(value, "[redacted]");
  }
  return safe
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/((?:[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD))\s*[=:]\s*)["']?[^\s"']+["']?/gi, "$1[redacted]");
}
