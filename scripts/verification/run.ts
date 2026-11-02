import { spawn } from "node:child_process";
import { cpSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createDemoUsers } from "../create-demo-users.ts";
import { bootstrapAcademicDemo } from "../bootstrap/academicDemo.ts";
import { academicRoles, secondaryCredentials, type AcademicCredentials } from "../bootstrap/academicFixtures.ts";
import { assertPortAvailable, createOwnedEnvironment, redactOutput, repositoryRoot, validateOwnedTarget } from "./runtime.ts";
import { inlineSqlSupport, writeStagedSql } from "./sqlSupport.ts";
import { runSuiteBatch, type VerificationRequest } from './suites.ts';
import { runClosureConcurrency } from './concurrency.ts';
import { runAdminConcurrency } from './adminConcurrency.ts';
import { verifyBootstrapAfterClosure } from './bootstrapAfterClosure.ts';


// Do not inherit app credentials, SUPABASE_ACCESS_TOKEN, NODE_OPTIONS or env-file options.
function cleanEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { CI: "1", SUPABASE_TELEMETRY_DISABLED: "true" };
  for (const name of ["PATH", "HOME", "TMPDIR", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "LANG", "SystemRoot"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}

export async function runVerification(request: VerificationRequest) {
  if (!["db", "e2e", "all"].includes(request.suite)) throw new Error("Unknown verification suite");
  if (!["legacy", "academic"].includes(request.fixture)) throw new Error("Unknown verification fixture");
  const files=readdirSync(join(repositoryRoot,'tests/e2e')).filter(name=>name.endsWith('.spec.ts')).sort().map(name=>join('tests/e2e',name));
  const result=await runSuiteBatch(request,files,runSingleVerification);
  if(result.projects)process.stdout.write(`Owned suite batch: ${JSON.stringify(result.projects)}\n`);
  return result;
}
async function runSingleVerification(request: VerificationRequest): Promise<{ exitCode: number; projectId: string }> {
  if (!["db", "e2e", "all"].includes(request.suite)) throw new Error("Unknown verification suite");
  if (!["legacy", "academic"].includes(request.fixture)) throw new Error("Unknown verification fixture");
  let testFile: string | undefined;
  if (request.file) {
    if (request.suite === "all") throw new Error("--file requires a single db or e2e suite");
    const testRoot = realpathSync(join(repositoryRoot, request.suite === "db" ? "supabase/tests/database" : "tests/e2e"));
    testFile = realpathSync(resolve(repositoryRoot, request.file));
    const child = relative(testRoot, testFile);
    if (isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`) || !child) throw new Error("Test file must belong to the selected local suite");
  }
  if (request.suite !== "db") await assertPortAvailable(4175);
  const target = await createOwnedEnvironment();
  const env = cleanEnvironment();
  const secrets: string[] = [];
  const cli = join(repositoryRoot, "node_modules/supabase/dist/supabase.js");
  let started = false;
  let interrupted = false;
  let activeChild: ReturnType<typeof spawn> | undefined;
  const interrupt = () => { interrupted = true; activeChild?.kill("SIGTERM"); };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  async function command(binary: string, args: string[], options: { input?: string; hidden?: boolean; cleanup?: boolean } = {}) {
    validateOwnedTarget(target);
    if (interrupted && !options.cleanup) throw new Error("Verification interrupted");
    return await new Promise<{ exitCode: number; stdout: string }>((resolveCommand, reject) => {
      const child = spawn(binary, args, { cwd: repositoryRoot, env, stdio: ["pipe", "pipe", "pipe"] });
      activeChild = child;
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", () => reject(new Error("Could not launch verification command")));
      child.once("close", (code) => {
        activeChild = undefined;
        if (!options.hidden) {
          process.stdout.write(redactOutput(stdout, secrets));
          process.stderr.write(redactOutput(stderr, secrets));
        }
        resolveCommand({ exitCode: code ?? 1, stdout });
      });
      child.stdin.on("error", () => { /* command exit is reported via close */ });
      child.stdin.end(options.input);
    });
  }
  const supabase = (args: string[], hidden = false, cleanup = false) => command(process.execPath, [cli, ...args, "--workdir", target.workdir], { hidden, cleanup });
  let exitCode = 1;
  let cleanupError: Error | undefined;
  let failure: unknown;
  try {
    process.stdout.write(`Owned verification project: ${target.projectId}\nStarting disposable local services…\n`);
    started = true; // A partially failed start still belongs to this invocation.
    if ((await supabase(["start", "--exclude", "studio,mailpit,logflare,vector,supavisor,edge-runtime,realtime,storage-api,imgproxy,postgres-meta"], true)).exitCode) {
      throw new Error("Disposable Supabase start failed (private startup output suppressed)");
    }
    cpSync(join(target.workdir, "inputs/migrations"), join(target.workdir, "supabase/migrations"), { recursive: true });
    if ((await supabase(["migration", "up", "--local"])).exitCode) throw new Error("Owned migrations failed");
    const database = `supabase_db_${target.projectId}`;
    if ((await command("docker", ["exec", "-i", database, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
      input: readFileSync(join(target.workdir, "supabase/seed.sql"), "utf8"),
    })).exitCode) throw new Error("Owned synthetic seed failed");
    let serviceStatus: Record<string,string> | undefined;
    let academicCredentials:AcademicCredentials|undefined;
    let academicActors:unknown;
    if (request.fixture === 'academic' || request.suite !== 'db') {
      const result = await supabase(["status", "--output", "json"], true);
      if (result.exitCode) throw new Error("Could not read disposable service credentials");
      serviceStatus = JSON.parse(result.stdout) as Record<string,string>;
      for (const value of Object.values(serviceStatus)) if (typeof value === 'string') secrets.push(value);
      if (serviceStatus.API_URL!==target.url || !serviceStatus.SERVICE_ROLE_KEY || !serviceStatus.ANON_KEY) throw new Error('Disposable service identity mismatch');
    }
    if (request.fixture === 'academic' && serviceStatus) {
      const credentials = Object.fromEntries(academicRoles.map(role=>[role,{email:`${role}@academic-verification.invalid`,password:randomUUID()}])) as AcademicCredentials;
      academicCredentials=credentials;
      secrets.push(...[...Object.values(credentials),...Object.values(secondaryCredentials(credentials))].flatMap(c=>[c.email,c.password]));
      const admin = createClient(target.url, serviceStatus.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
      const first = await bootstrapAcademicDemo(admin,credentials);
      const second = await bootstrapAcademicDemo(admin,credentials);
      if (JSON.stringify(first)!==JSON.stringify(second)) throw new Error('Owned academic bootstrap identity mismatch');
      academicActors=first;
      for (const [role,credential] of Object.entries(credentials)) {
        env[`ACADEMIC_${role.toUpperCase()}_EMAIL`]=credential.email;
        env[`ACADEMIC_${role.toUpperCase()}_PASSWORD`]=credential.password;
      }
      for (const [name,credential] of Object.entries(secondaryCredentials(credentials))) {
        env[`ACADEMIC_${name.toUpperCase()}_EMAIL`]=credential.email;
        env[`ACADEMIC_${name.toUpperCase()}_PASSWORD`]=credential.password;
      }
    }
    if (request.suite === "db" || request.suite === "all") {
      // The CLI mounts SQL tests individually, not their sibling support files.
      // Expand only validated support references, only into this run's owned copies.
      const sourceTests = join(repositoryRoot, "supabase/tests/database");
      const selected = testFile ? [relative(sourceTests, testFile)] : readdirSync(sourceTests).filter((name) => name.endsWith(".sql"));
      for (const name of selected) {
        validateOwnedTarget(target);
        writeStagedSql(target.workdir, join(target.workdir, "supabase/tests/database", name), inlineSqlSupport(join(sourceTests, name), join(repositoryRoot, "supabase/tests/support")));
      }
      const files = testFile ? [join(target.workdir, relative(repositoryRoot, testFile))] : [];
      exitCode = (await supabase(["test", "db", "--local", ...files])).exitCode;
      if(exitCode===0&&request.fixture==='academic'&&academicCredentials&&serviceStatus&&(!testFile||testFile.endsWith('/11_academic_closure.test.sql'))){
        const status=serviceStatus,credentials=academicCredentials;
        await runClosureConcurrency(target,status.ANON_KEY,credentials,()=>verifyBootstrapAfterClosure(target,status.SERVICE_ROLE_KEY,credentials,academicActors));
      }
      if(exitCode===0&&request.fixture==='academic'&&academicCredentials&&serviceStatus&&(!testFile||testFile.endsWith('/16_academic_regression.test.sql')))await runAdminConcurrency(target,serviceStatus.ANON_KEY,academicCredentials);
    }
    if (request.suite === "e2e" || (request.suite === "all" && exitCode === 0)) {
      const status = serviceStatus;
      if (!status) throw new Error('Could not read disposable service credentials');
      const credentials = {
        technical: { email: "technical@verification.invalid", password: randomUUID() },
        cam: { email: "cam@verification.invalid", password: randomUUID() },
      };
      secrets.push(...Object.values(credentials).flatMap(({ email, password }) => [email, password]));
      await createDemoUsers(createClient(target.url, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }), credentials);
      Object.assign(env, {
        VITE_SUPABASE_URL: target.url, VITE_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY, VITE_RUNTIME_MODE: 'local',
        DEMO_TECHNICAL_EMAIL: credentials.technical.email, DEMO_TECHNICAL_PASSWORD: credentials.technical.password,
        DEMO_CAM_EMAIL: credentials.cam.email, DEMO_CAM_PASSWORD: credentials.cam.password,
        VERIFICATION_OWNED_TARGET: JSON.stringify(target), E2E_PORT: "4175",
      });
      // Compile only with this project's public URL/key after owned envDir is
      // set; preview tests the real production lazy/vendor chunks, not TSX dev.
      if ((await command(process.execPath, [join(repositoryRoot, 'node_modules/vite/bin/vite.js'), 'build'])).exitCode) throw Error('Owned production build failed');
      const result = await command(process.execPath, [join(repositoryRoot, "node_modules/@playwright/test/cli.js"), "test", "--workers=1", ...(testFile ? [testFile] : [])]);
      exitCode = result.exitCode;
    }
  } catch (error) {
    failure = error;
  } finally {
    try {
      validateOwnedTarget(target);
      if (started && (await supabase(["stop", "--project-id", target.projectId, "--no-backup"], true, true)).exitCode) {
        cleanupError = new Error(`Owned cleanup failed; temporary project preserved: ${target.projectId}`);
      }
      for (const resource of ["container", "volume", "network"]) {
        const remaining = await command("docker", [resource, "ls", "--quiet", ...(resource === "container" ? ["--all"] : []), "--filter", `label=com.supabase.cli.project=${target.projectId}`], { hidden: true, cleanup: true });
        if (remaining.exitCode || remaining.stdout.trim()) cleanupError = new Error(`Owned cleanup incomplete; temporary project preserved: ${target.projectId}`);
      }
      if (!cleanupError) {
        rmSync(target.workdir, { recursive: true, force: true });
        process.stdout.write(`Removed only owned disposable project: ${target.projectId}\n`);
      }
    } finally {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
    }
  }
  if (cleanupError) throw cleanupError;
  if (failure) throw failure;
  return { exitCode, projectId: target.projectId };
}

async function main() {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!["--suite", "--file", "--fixture"].includes(args[index]) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Use --suite db|e2e|all [--file path] --fixture legacy|academic");
    options[args[index]] = args[index + 1];
  }
  process.exitCode = (await runVerification({ suite: options["--suite"] as VerificationRequest["suite"], fixture: options["--fixture"] as VerificationRequest["fixture"], file: options["--file"] })).exitCode;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch((error: unknown) => {
    // Upstream exceptions can contain requests/credentials; only our own fixed messages are safe.
    process.stderr.write(`Verification failed: ${error instanceof Error && /^(Unknown verification|Academic fixture|--file|Test file|Use --suite|Verification port|Invalid verification|Disposable Supabase|Owned |Could not |Disposable service|Verification interrupted|Refused target)/.test(error.message) ? error.message : "private diagnostic suppressed"}\n`);
    process.exitCode = 1;
  });
}
