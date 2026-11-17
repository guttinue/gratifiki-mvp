import { existsSync, readFileSync } from "node:fs";
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

  it("hides the closed side menu below 768px and shows it when open", () => {
    const narrow = /@media \(max-width: 767px\)\s*\{(.*?)\n\}/s.exec(stylesheet)?.[1] ?? "";
    expect(/\.academic-side\s*\{[^}]*visibility:\s*hidden/s.test(narrow)).toBe(true);
    expect(/\.academic-side\[data-open="true"\]\s*\{[^}]*visibility:\s*visible/s.test(narrow)).toBe(true);
  });

  it("pads scrolling under the sticky header", () => {
    expect(stylesheet).toContain("scroll-padding-top");
  });

  const academic = /\n\.academic-app\s*\{([^}]*)\}/.exec(stylesheet)?.[1] ?? "";

  const fontFiles = ["Geist-Variable.woff2", "GeistMono-Variable.woff2", "inter-latin-wght-normal.woff2"];
  it("self-hosts the V4 fonts with their OFL licenses and no third-party URL", () => {
    const faces = [...stylesheet.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(faces.map((f) => /font-family:\s*"([^"]+)"/.exec(f)?.[1]).sort()).toEqual(["Geist", "Geist Mono", "Inter"]);
    for (const face of faces) expect(face).toMatch(/src:\s*url\("\/fonts\/[\w-]+\.woff2"\)\s*format\("woff2"\)/);
    for (const face of faces) expect(face).toContain("font-display: swap");
    expect(stylesheet).not.toMatch(/url\(\s*["']?https?:|@import|fonts\.(googleapis|gstatic)\.com/);
    expect(readFileSync(resolve(process.cwd(), "index.html"), "utf8")).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    for (const file of [...fontFiles, "OFL-Geist.txt", "OFL-Inter.txt"]) expect(existsSync(resolve(process.cwd(), "public/fonts", file))).toBe(true);
    for (const license of ["OFL-Geist.txt", "OFL-Inter.txt"]) expect(readFileSync(resolve(process.cwd(), "public/fonts", license), "utf8")).toContain("SIL Open Font License");
  });

  it("declares the V4 tokens inside .academic-app, not on :root", () => {
    for (const token of ["--bg: #f7f7f7", "--ink: #171717", "--muted: #525252", "--field: #8f8f8f", "--focus: #0070e0", "--primary: #171717", "--ok:", "--bad-bg:", "--card:", "--ui:", '--mono: "Geist Mono"']) expect(academic).toContain(token);
    expect(/^:root\s*\{[^}]*--(surface-muted|line-strong|success-soft|ok-bg|chip)/m.test(stylesheet)).toBe(false);
  });

  it("paints the one primary action dark", () => {
    expect(/\.academic-app button\.primary\s*\{[^}]*background:\s*var\(--primary\)/s.test(stylesheet)).toBe(true);
  });

  it("colors each situation badge from the tokens", () => {
    expect(/\.v3-st-devolvida\s*\{[^}]*var\(--danger/s.test(stylesheet)).toBe(true);
    expect(/\.v3-st-validada\s*\{[^}]*var\(--success/s.test(stylesheet)).toBe(true);
  });

  it("scrolls the tab bar instead of shrinking tabs over each other", () => {
    expect(/\.v3-tabs button\s*\{[^}]*flex:\s*none/s.test(stylesheet)).toBe(true);
  });

  it("keeps whole words in V3 table cells, which scroll inside their container", () => {
    expect(/\.v3-table\s*\{[^}]*overflow-wrap:\s*normal/s.test(stylesheet)).toBe(true);
  });
});
