import { closeSync, constants, fstatSync, ftruncateSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** The owned root/marker is verified by the caller; also verify every child
 * before replacing staged content. cpSync preserves repository symlinks. */
export function writeStagedSql(ownedRoot: string, destination: string, sql: string): void {
  const root = resolve(ownedRoot);
  const target = resolve(destination);
  const child = relative(join(root, "supabase/tests/database"), target);
  if (!child || isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`) || !child.endsWith(".sql")) {
    throw new Error("Invalid staged SQL destination");
  }
  function checkPath() {
    if (realpathSync(root) !== root || !lstatSync(root).isDirectory()) throw new Error("Invalid staged SQL root");
    let current = root;
    const components = relative(root, target).split(sep);
    for (let index = 0; index < components.length; index++) {
      current = join(current, components[index]);
      const stat = lstatSync(current);
      const last = index === components.length - 1;
      if (stat.isSymbolicLink() || (last ? !stat.isFile() : !stat.isDirectory()) || realpathSync(current) !== current) {
        throw new Error("Invalid staged SQL path: symbolic link or non-regular component");
      }
    }
    return lstatSync(target);
  }
  const expected = checkPath();
  // No truncation until the descriptor and still-canonical path are verified.
  // O_NOFOLLOW also rejects a final-component symlink substituted after lstat.
  const fd = openSync(target, constants.O_WRONLY | constants.O_NOFOLLOW);
  try {
    const current = checkPath();
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== expected.dev || opened.ino !== expected.ino ||
        opened.dev !== current.dev || opened.ino !== current.ino) throw new Error("Invalid staged SQL file identity");
    ftruncateSync(fd, 0);
    writeFileSync(fd, sql);
  } finally {
    closeSync(fd);
  }
}

/** Only the test suite's narrow, unquoted \ir support-file convention is accepted. */
export function inlineSqlSupport(testPath: string, supportRoot: string): string {
  const root = realpathSync(supportRoot);
  const active = new Set<string>();
  function expand(path: string): string {
    const actual = realpathSync(path);
    if (active.has(actual)) throw new Error("Invalid SQL support reference: cycle");
    active.add(actual);
    const result = readFileSync(actual, "utf8").split("\n").map((line) => {
      if (!/^\s*\\(?:ir|include_relative|i|include)\b/.test(line)) return line;
      const match = /^\s*\\ir\s+((?:\.\.\/support\/)?[A-Za-z0-9_-]+\.(?:psql|sql))\s*$/.exec(line);
      if (!match) throw new Error("Invalid SQL support reference: syntax");
      let included: string;
      try { included = realpathSync(resolve(dirname(actual), match[1])); }
      catch { throw new Error("Invalid SQL support reference: missing file"); }
      const child = relative(root, included);
      if (!child || isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`)) {
        throw new Error("Invalid SQL support reference: outside support directory");
      }
      return expand(included);
    }).join("\n");
    active.delete(actual);
    return result;
  }
  return expand(testPath);
}
