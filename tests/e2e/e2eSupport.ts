import { expect, type Page } from "@playwright/test";
import { validateOwnedTarget, type OwnedTarget } from "../../scripts/verification/runtime.ts";
import type { Role } from "../../src/features/pilot/types";

type DemoProfile = "technical" | "cam";

export function academicCredential(profile: Role | 'southTechnical' | 'southReviewer' | 'partialCam') {
  assertLocalE2eConfiguration();
  const email = process.env[`ACADEMIC_${profile.toUpperCase()}_EMAIL`];
  const password = process.env[`ACADEMIC_${profile.toUpperCase()}_PASSWORD`];
  if (!email || !password) throw new Error('Academic E2E requires the owned academic fixture');
  return { email, password };
}

export function assertLocalE2eConfiguration(...profiles: DemoProfile[]) {
  if (process.env.VERIFICATION_OWNED_TARGET !== undefined) {
    const owned = JSON.parse(process.env.VERIFICATION_OWNED_TARGET) as OwnedTarget;
    validateOwnedTarget(owned);
    if (process.env.VITE_SUPABASE_URL !== owned.url) throw new Error("E2E target does not match the owned project");
  }
  let target: URL;
  try {
    target = new URL(process.env.VITE_SUPABASE_URL ?? "");
  } catch {
    throw new Error("E2E exige VITE_SUPABASE_URL apontando para a instância Supabase local.");
  }

  const hostname = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLoopback = hostname === "localhost" || hostname === "::1" || hostname === "127.0.0.1";
  if (target.protocol !== "http:" || !isLoopback || target.username || target.password) {
    throw new Error("E2E interrompido: autenticação e gravações só são permitidas contra Supabase em loopback.");
  }

  const required = profiles.length ? ["VITE_SUPABASE_PUBLISHABLE_KEY"] : [];
  if (profiles.includes("technical")) required.push("DEMO_TECHNICAL_EMAIL", "DEMO_TECHNICAL_PASSWORD");
  if (profiles.includes("cam")) required.push("DEMO_CAM_EMAIL", "DEMO_CAM_PASSWORD");
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`E2E exige configuração local para: ${missing.join(", ")}.`);
  }
}

export async function entryIds(page: Page) {
  await expect(page.getByText("Carregando as entradas autorizadas…", { exact: true })).toHaveCount(0);
  return page.locator('table[aria-label="Entradas autorizadas do contexto"] tbody tr[data-entry-id]').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-entry-id")).filter((id): id is string => id !== null),
  );
}
