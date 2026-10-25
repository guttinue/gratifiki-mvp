// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inlineSqlSupport, writeStagedSql } from "./sqlSupport.ts";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "gratifiki-sql-support-"));
  roots.push(root);
  mkdirSync(join(root, "support"));
  mkdirSync(join(root, "database"));
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("owned SQL support expansion", () => {
  it("expands shared helper in memory without changing source", () => {
    const root = fixture();
    const path = join(root, "database/test.sql");
    writeFileSync(path, "begin;\n\\ir ../support/helper.psql\nrollback;\n");
    writeFileSync(join(root, "support/helper.psql"), "select 42;\n");
    expect(inlineSqlSupport(path, join(root, "support"))).toBe("begin;\nselect 42;\n\nrollback;\n");
    expect(readFileSync(path, "utf8")).toBe("begin;\n\\ir ../support/helper.psql\nrollback;\n");
  });
  it.each(["../../outside.psql", "../support/../outside.psql", "../support/secrets.env", "../support/helper.psql trailing", "'/tmp/helper.psql'"])("rejects unsafe or malformed include %s", (reference) => {
    const root = fixture();
    const path = join(root, "database/test.sql");
    writeFileSync(path, `\\ir ${reference}\n`);
    expect(() => inlineSqlSupport(path, join(root, "support"))).toThrow("Invalid SQL support reference");
  });
  it("rejects symlink escape before reading it", () => {
    const root = fixture();
    writeFileSync(join(root, "outside.psql"), "sensitive");
    symlinkSync(join(root, "outside.psql"), join(root, "support/escape.psql"));
    writeFileSync(join(root, "database/test.sql"), "\\ir ../support/escape.psql\n");
    expect(() => inlineSqlSupport(join(root, "database/test.sql"), join(root, "support"))).toThrow("Invalid SQL support reference");
  });
  it("rejects include cycles", () => {
    const root = fixture();
    writeFileSync(join(root, "database/test.sql"), "\\ir ../support/a.psql\n");
    writeFileSync(join(root, "support/a.psql"), "\\ir a.psql\n");
    expect(() => inlineSqlSupport(join(root, "database/test.sql"), join(root, "support"))).toThrow("Invalid SQL support reference");
  });
});

describe("owned staged SQL writes", () => {
  function stagedFixture() {
    const root = realpathSync(fixture());
    const owned = join(root, "owned");
    mkdirSync(owned);
    const outside = join(root, "database/test.sql");
    writeFileSync(outside, "synthetic source sentinel");
    return { root, owned, outside };
  }

  it("rewrites an existing regular staged test without modifying its source", () => {
    const { owned, outside } = stagedFixture();
    mkdirSync(join(owned, "supabase/tests/database"), { recursive: true });
    const destination = join(owned, "supabase/tests/database/test.sql");
    writeFileSync(destination, "original staged SQL");
    writeStagedSql(owned, destination, "expanded SQL");
    expect(readFileSync(destination, "utf8")).toBe("expanded SQL");
    expect(readFileSync(outside, "utf8")).toBe("synthetic source sentinel");
  });

  it("rejects a staged file symlink without changing the outside source sentinel", () => {
    const { owned, outside } = stagedFixture();
    mkdirSync(join(owned, "supabase/tests/database"), { recursive: true });
    const destination = join(owned, "supabase/tests/database/test.sql");
    symlinkSync(outside, destination);
    let failure: unknown;
    try { writeStagedSql(owned, destination, "must not escape"); } catch (error) { failure = error; }
    expect(readFileSync(outside, "utf8")).toBe("synthetic source sentinel");
    expect(failure).toBeInstanceOf(Error);
  });

  it.each(["supabase", "supabase/tests", "supabase/tests/database"])("rejects a staged parent symlink at %s without changing the outside sentinel", (parent) => {
    const { root, owned } = stagedFixture();
    const destination = join(owned, "supabase/tests/database/test.sql");
    const target = join(root, "outside-parent");
    const suffix = "supabase/tests/database".slice(parent.length).replace(/^\//, "");
    mkdirSync(join(target, suffix), { recursive: true });
    const sentinel = join(target, suffix, "test.sql");
    writeFileSync(sentinel, "outside target sentinel");
    const components = parent.split("/");
    mkdirSync(join(owned, ...components.slice(0, -1)), { recursive: true });
    symlinkSync(target, join(owned, parent));
    let failure: unknown;
    try { writeStagedSql(owned, destination, "must not escape"); } catch (error) { failure = error; }
    expect(readFileSync(sentinel, "utf8")).toBe("outside target sentinel");
    expect(failure).toBeInstanceOf(Error);
  });

  it("rejects a destination outside owned database tests before writing", () => {
    const { owned, outside } = stagedFixture();
    let failure: unknown;
    try { writeStagedSql(owned, outside, "must not escape"); } catch (error) { failure = error; }
    expect(readFileSync(outside, "utf8")).toBe("synthetic source sentinel");
    expect(failure).toBeInstanceOf(Error);
  });
});
