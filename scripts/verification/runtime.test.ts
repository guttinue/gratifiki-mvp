// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:net";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createOwnedEnvironment, redactOutput, validateOwnedTarget, type OwnedTarget } from "./runtime.ts";
import { resolveConfig } from "vite";
import { runVerification } from "./run.ts";

const owned: OwnedTarget[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const target of owned.splice(0)) rmSync(target.workdir, { recursive: true, force: true });
});

describe("owned verification boundaries", () => {
  it("rejects_persistent_and_remote_targets", () => {
    expect(() => validateOwnedTarget({ projectId: "gratifiki-mvp", workdir: process.cwd(), url: "https://example.invalid", marker: "" })).toThrow();
  });

  it("creates an isolated public-only project with reserved ports and no credentials in its DTO", async () => {
    const target = await createOwnedEnvironment();
    owned.push(target);
    expect(() => validateOwnedTarget(target)).not.toThrow();
    expect(target.url).toBe("http://127.0.0.1:55421");
    // Supabase 2.118 truncates long local IDs; stay below that boundary for exact cleanup.
    expect(target.projectId.length).toBeLessThanOrEqual(36);
    expect(Object.keys(target).sort()).toEqual(["marker", "projectId", "url", "workdir"]);
    const config = readFileSync(join(target.workdir, "supabase/config.toml"), "utf8");
    expect(config).toContain('port = 55422');
    expect(config).toContain('shadow_port = 55420');
    expect(config).toMatch(/\[auth\]\n(?:[^[]*\n)*?enable_signup = false/);
  });

  it("rejects a forged marker", async () => {
    const target = await createOwnedEnvironment();
    owned.push(target);
    expect(() => validateOwnedTarget({ ...target, marker: "forged" })).toThrow();
  });

  it("rejects a directory outside its created temporary root", async () => {
    const target = await createOwnedEnvironment();
    owned.push(target);
    expect(() => validateOwnedTarget({ ...target, workdir: process.cwd() })).toThrow();
    expect(() => validateOwnedTarget({ ...target, workdir: join(target.workdir, "supabase") })).toThrow();
  });

  it("rejects a different endpoint even if it is loopback", async () => {
    const target = await createOwnedEnvironment();
    owned.push(target);
    expect(() => validateOwnedTarget({ ...target, url: "http://127.0.0.1:54321" })).toThrow();
  });

  it("rejects changed database configuration before any operation", async () => {
    const target = await createOwnedEnvironment();
    owned.push(target);
    const path = join(target.workdir, "supabase/config.toml");
    writeFileSync(path, readFileSync(path, "utf8").replace("port = 55422", "port = 54322"));
    expect(() => validateOwnedTarget(target)).toThrow();
  });

  it("fails when a reserved port is occupied without stopping its listener", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    try {
      await expect(createOwnedEnvironment(address.port)).rejects.toThrow(/port/i);
      expect(server.listening).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("redacts private values and connection strings without hiding test counts", () => {
    expect(redactOutput("password=synthetic-secret postgres://postgres:private@127.0.0.1:55422/postgres\n14 passed", ["synthetic-secret"]))
      .toBe("password=[redacted] [redacted]\n14 passed");
    expect(redactOutput('SERVICE_ROLE_KEY="unknown-secret"\nBearer eyJhbGciOiJIUzI1NiJ9.payload.signature', []))
      .not.toMatch(/unknown-secret|eyJhbGci/);
  });

  it("does not read the app's .env.local during owned Vite verification", async () => {
    const target = await createOwnedEnvironment();
    owned.push(target);
    const fakeApp = join(target.workdir, "app");
    mkdirSync(fakeApp);
    writeFileSync(join(fakeApp, ".env.local"), "VITE_USER_PRIVATE_SENTINEL=must-not-be-read\n");
    writeFileSync(join(target.workdir, ".env.verification"), "VITE_OWNED_SYNTHETIC=owned-test-value\n");
    vi.stubEnv("VERIFICATION_OWNED_TARGET", JSON.stringify(target));
    const config = await resolveConfig({ root: fakeApp, configFile: join(process.cwd(), "vite.config.ts"), mode: "verification" }, "serve");
    expect(config.env.VITE_USER_PRIVATE_SENTINEL).toBeUndefined();
    expect(config.env.VITE_OWNED_SYNTHETIC).toBe("owned-test-value");
  });

  it("rejects unknown fixtures before creating infrastructure", async () => {
    await expect(runVerification({ suite: "all", fixture: "unknown" as "academic" })).rejects.toThrow(/Unknown verification fixture/);
  });

  it("fails closed when Vite receives a malformed owned verification target", async () => {
    const target = await createOwnedEnvironment();
    owned.push(target);
    vi.stubEnv("VERIFICATION_OWNED_TARGET", "null");
    const rejected = await resolveConfig({ root: target.workdir, configFile: join(process.cwd(), "vite.config.ts"), logLevel: "silent" }, "serve").then(() => false, () => true);
    expect(rejected).toBe(true);
  });

  it("rejects files outside the requested test suite before creating infrastructure", async () => {
    await expect(runVerification({ suite: "db", fixture: "legacy", file: "package.json" })).rejects.toThrow(/selected local suite/);
  });
});
