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

  // V4 breakpoint: the menu collapses below 900px (was 767px), with a backdrop while open.
  const mediaBlock = (width: number, marker: string) =>
    [...stylesheet.matchAll(new RegExp(`@media \\(max-width: ${width}px\\)\\s*\\{(.*?)\\n\\}`, "gs"))].map((m) => m[1]).find((block) => block.includes(marker)) ?? "";
  it("hides the closed side menu below 900px and shows it when open", () => {
    const narrow = mediaBlock(900, ".academic-side");
    expect(/\.academic-side\s*\{[^}]*visibility:\s*hidden/s.test(narrow)).toBe(true);
    expect(/\.academic-side\[data-open="true"\]\s*\{[^}]*visibility:\s*visible/s.test(narrow)).toBe(true);
    expect(/\.academic-scrim:not\(\[hidden\]\)\s*\{[^}]*position:\s*fixed/s.test(narrow)).toBe(true);
    expect(stylesheet).not.toContain("@media (max-width: 767px)");
  });

  it("hides the header labels below 760px", () => {
    const narrow = mediaBlock(760, ".academic-label");
    expect(/\.academic-top \.academic-label[^{]*\{[^}]*clip/s.test(narrow)).toBe(true);
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

  it("scrolls the tab bar instead of shrinking tabs over each other", () => {
    expect(/\.v3-tabs button\s*\{[^}]*flex:\s*none/s.test(stylesheet)).toBe(true);
  });

  it("keeps whole words in V3 table cells, which scroll inside their container", () => {
    expect(/\.v3-table\s*\{[^}]*overflow-wrap:\s*normal/s.test(stylesheet)).toBe(true);
  });

  const rule = (selector: string) => new RegExp(selector.replace(/[.[\]()]/g, "\\$&") + "\\s*\\{([^}]*)\\}").exec(stylesheet)?.[1] ?? "";
  it("colors each situation badge from the tokens", () => {
    expect(rule(".v3-st-devolvida")).toContain("var(--bad");
    expect(rule(".v3-st-validada")).toContain("var(--ok");
    expect(rule(".v3-st-em_revisao")).toContain("var(--vio");
  });

  // The global table rule sets min-width: 690px; a card table that keeps it overflows a 375px page.
  it("frees the V4 and fill tables from the global table min-width", () => {
    expect(/\.academic-app \.v4-tbl table\s*\{[^}]*min-width:\s*0/s.test(stylesheet)).toBe(true);
    expect(/\.academic-app \.fill-tbl table\s*\{[^}]*min-width:\s*0/s.test(stylesheet)).toBe(true);
  });

  // 320px at 200% zoom leaves 160 CSS px: a fixed grid minimum would push the page sideways.
  it("lets the unit cards shrink below their column minimum", () => {
    expect(/\.academic-app \.cards\s*\{[^}]*minmax\(min\(240px, 100%\), 1fr\)/s.test(stylesheet)).toBe(true);
  });

  it("turns V4 tables into cards below 760px", () => {
    const narrow = [...stylesheet.matchAll(/@media \(max-width: 760px\)\s*\{(.*?)\n\}/gs)].map((m) => m[1]).find((block) => block.includes(".v4-tbl")) ?? "";
    expect(/\.v4-tbl thead\s*\{[^}]*clip/s.test(narrow)).toBe(true);
    expect(/\.v4-tbl tr\s*\{[^}]*display:\s*grid/s.test(narrow)).toBe(true);
    expect(/\.v4-tbl td\[data-label\]::before\s*\{[^}]*content:\s*attr\(data-label\)/s.test(narrow)).toBe(true);
  });

  it("stacks the fill tabs, sub-grid and send bar below 760px (M-04)", () => {
    const blocks = [...stylesheet.matchAll(/@media \(max-width: (\d+)px\)\s*\{(.*?)\n\}/gs)];
    const owner = (rule: RegExp) => blocks.filter((m) => rule.test(m[2])).map((m) => m[1]);
    expect(owner(/\.unit-tabs \[role="tab"\]\s*\{[^}]*flex:\s*1 1 100%/)).toEqual(["760"]);
    expect(owner(/\.sub-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/)).toEqual(["760"]);
    expect(owner(/\.fill-bar button\s*\{[^}]*flex:\s*1 1 100%/)).toEqual(["760"]);
  });
});
