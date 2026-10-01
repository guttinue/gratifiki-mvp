import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("workspace responsive stylesheet", () => {
  it("keeps visually hidden accessibility text out of the document scroll width", () => {
    expect(/\.sr-only\s*\{[^}]*position:\s*fixed/s.test(stylesheet)).toBe(true);
  });

  it("keeps the mobile context chip inside the content width when it wraps", () => {
    expect(/\.context-chip\s*\{[^}]*max-width:\s*calc\(100%\s*-\s*26px\);[^}]*margin-left:\s*26px;/s.test(stylesheet)).toBe(true);
  });

  it("styles the existing entry submit button as a primary action", () => {
    expect(/\.input-row\s+button\s*\{[^}]*background:\s*var\(--blue\);/s.test(stylesheet)).toBe(true);
  });
});
