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

  it("turns the academic side menu into a top bar that scrolls inside itself below 768px", () => {
    const narrow = /@media \(max-width: 767px\)\s*\{(.*?)\n\}/s.exec(stylesheet)?.[1] ?? "";
    expect(/\.academic-app\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s.test(narrow)).toBe(true);
    expect(/\.academic-app \.academic-nav\s*\{[^}]*flex-direction:\s*row;[^}]*overflow-x:\s*auto/s.test(narrow)).toBe(true);
  });

  const academic = /\n\.academic-app\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? "";

  it("declares the V3 tokens inside .academic-app, not on :root", () => {
    for (const token of ["--page:", "--ink:", "--line:", "--blue-soft:", "--success-soft:", "--danger:", "--mono:"]) expect(academic).toContain(token);
    expect(/^:root\s*\{[^}]*--(surface-muted|line-strong|success-soft)/m.test(stylesheet)).toBe(false);
  });

  it("uses only the system font stack", () => {
    expect(stylesheet).not.toMatch(/@import|fonts\.googleapis|@font-face/);
    expect(readFileSync(resolve(process.cwd(), "index.html"), "utf8")).not.toMatch(/fonts\.googleapis/);
  });

  it("colors each situation badge from the tokens", () => {
    expect(/\.v3-st-devolvida\s*\{[^}]*var\(--danger/s.test(stylesheet)).toBe(true);
    expect(/\.v3-st-validada\s*\{[^}]*var\(--success/s.test(stylesheet)).toBe(true);
    expect(/\.academic-app button\.primary\s*\{[^}]*background:\s*var\(--blue\)/s.test(stylesheet)).toBe(true);
  });
});
