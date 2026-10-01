import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { assertLocalE2eConfiguration, entryIds } from "./e2eSupport";

test.use({ trace: "off" });
test.describe.configure({ mode: "serial" });

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? "";
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const technicalEmail = process.env.DEMO_TECHNICAL_EMAIL ?? "";
const technicalPassword = process.env.DEMO_TECHNICAL_PASSWORD ?? "";
const camEmail = process.env.DEMO_CAM_EMAIL ?? "";
const camPassword = process.env.DEMO_CAM_PASSWORD ?? "";

async function signIn(page: Page, email: string, password: string, profile: "technical" | "cam") {
  assertLocalE2eConfiguration(profile);
  await page.goto("/");
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Visão geral" })).toBeVisible();
}

async function waitForHistoryReady(page: Page) {
  await expect(page.getByText("Carregando os eventos autorizados…", { exact: true })).toHaveCount(0);
}

async function readDashboardMetrics(page: Page) {
  await expect(page.getByRole("status")).toHaveCount(0);
  const metricGrid = page.getByLabel("Métricas dos registros autorizados");
  if (await metricGrid.count() === 0) {
    await expect(page.getByRole("heading", { level: 1, name: "Visão geral" })).toBeVisible();
    return { entries: 0, results: 0, pending: 0, events: 0 };
  }

  async function metricValue(label: string) {
    const cards = metricGrid.locator(".metric-card");
    const labels = (await cards.locator(".metric-label").allTextContents()).map((text) => text.trim());
    const cardIndex = labels.findIndex((text) => text === label);
    expect(cardIndex).toBeGreaterThanOrEqual(0);
    const value = await cards.nth(cardIndex).locator(".metric-value").textContent();
    return Number(value);
  }

  return {
    entries: await metricValue("Entradas"),
    results: await metricValue("Resultados persistidos"),
    pending: await metricValue("Pendentes"),
    events: await metricValue("Eventos de auditoria"),
  };
}

async function assertEntryDetail(page: Page, entryId: string, input: string, result: string) {
  const detail = page.getByRole("region", { name: `Detalhe da entrada ${entryId}` });
  await expect(detail).toBeVisible();
  await expect(detail.locator(".detail-facts").getByText(input, { exact: true })).toBeVisible();
  await expect(detail.locator(".memory-facts").getByText(input, { exact: true })).toBeVisible();
  await expect(detail.getByText("DEMO-2026-09", { exact: true })).toBeVisible();
  await expect(detail.getByText("DEMO-01", { exact: true })).toBeVisible();
  await expect(detail.getByText("DEMO-ESCOPO-01", { exact: true })).toBeVisible();
  await expect(detail.locator(".status-badge")).toHaveText("Pendente");
  await expect(detail.locator(".result-memory")).toHaveCount(1);
  await expect(detail.locator(".result-number code")).toContainText(result);
  await expect(detail.locator(".memory-facts div").filter({ hasText: "Versão da regra" }).locator("dd")).toHaveText("1");
  await expect(detail.locator(".memory-facts div").filter({ hasText: "Fator persistido" }).locator("dd code")).toHaveText(/^0\.8(?:0+)?$/);
}

test("area técnica submits 10 and zero, then reads persisted details, history, and relative metrics", async ({ page }) => {
  await signIn(page, technicalEmail, technicalPassword, "technical");
  const baseline = await readDashboardMetrics(page);

  for (const [index, { submittedValue, expectedPersistedInput, output }] of [
    { submittedValue: "10", expectedPersistedInput: "10.0000", output: "8" },
    { submittedValue: "0", expectedPersistedInput: "0.0000", output: "0" },
  ].entries()) {
    await page.getByRole("link", { name: "Entradas" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Entradas" })).toBeVisible();
    const previousIds = await entryIds(page);

    await page.getByLabel("Valor para o indicador").fill(submittedValue);
    await page.getByRole("button", { name: "Registrar entrada" }).click();
    await expect(page.locator(".entry-card .success-message")).toContainText(`Resultado sintético persistido: ${output}`);

    const rows = page.locator('table[aria-label="Entradas autorizadas do contexto"] tbody tr[data-entry-id]');
    await expect(rows).toHaveCount(previousIds.length + 1);
    const newEntryId = (await entryIds(page)).find((id) => !previousIds.includes(id));
    expect(newEntryId).toBeTruthy();
    const entryId = newEntryId as string;
    const persistedInputCell = page.locator(`table[aria-label="Entradas autorizadas do contexto"] tbody tr[data-entry-id="${entryId}"] td`).nth(1);
    await expect(persistedInputCell).toHaveText(expectedPersistedInput);

    const entrySearch = page.getByRole("searchbox", { name: "Buscar por identificador ou valor" });
    await entrySearch.fill(entryId);
    await expect(rows).toHaveCount(1);
    await expect(page.locator(`table[aria-label="Entradas autorizadas do contexto"] tbody tr[data-entry-id="${entryId}"]`)).toHaveCount(1);
    await page.getByRole("button", { name: `Ver detalhe da entrada ${entryId}` }).click();
    await assertEntryDetail(page, entryId, expectedPersistedInput, output);
    await entrySearch.fill("");

    await page.getByRole("link", { name: "Histórico e auditoria" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Histórico e auditoria" })).toBeVisible();
    const eventRow = page.locator(`table[aria-label="Eventos de auditoria autorizados"] tbody tr[data-entry-id="${entryId}"]`);
    await waitForHistoryReady(page);
    await expect(eventRow).toHaveCount(1);
    await expect(eventRow).toContainText("Entrada enviada");
    await page.getByRole("button", { name: `Ver detalhe da entrada ${entryId}` }).click();
    await assertEntryDetail(page, entryId, expectedPersistedInput, output);
    await expect(page.getByRole("region", { name: `Detalhe da entrada ${entryId}` })).toContainText("demo.entry.submitted");

    await page.reload();
    await expect(page).toHaveURL(/#history$/);
    await expect(page.getByRole("heading", { level: 1, name: "Histórico e auditoria" })).toBeVisible();
    await waitForHistoryReady(page);
    await expect(page.locator(`table[aria-label="Eventos de auditoria autorizados"] tbody tr[data-entry-id="${entryId}"]`)).toHaveCount(1);
    await page.getByRole("button", { name: `Ver detalhe da entrada ${entryId}` }).click();
    await assertEntryDetail(page, entryId, expectedPersistedInput, output);
    await expect(page.getByRole("region", { name: `Detalhe da entrada ${entryId}` })).toContainText("demo.entry.submitted");

    await page.getByRole("link", { name: "Visão geral" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Visão geral" })).toBeVisible();
    await expect.poll(() => readDashboardMetrics(page)).toEqual({
      entries: baseline.entries + index + 1,
      results: baseline.results + index + 1,
      pending: baseline.pending + index + 1,
      events: baseline.events + index + 1,
    });
  }
});

test("CAM can read the dashboard but cannot submit in the UI or through the RPC", async ({ page }) => {
  await signIn(page, camEmail, camPassword, "cam");
  await page.getByRole("link", { name: "Entradas" }).click();

  await expect(page.getByText(/Perfil CAM · somente leitura/i)).toBeVisible();
  await expect(page.getByLabel("Valor para o indicador")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Registrar entrada" })).toHaveCount(0);
  for (const writeAction of [/aprovar/i, /devolver/i, /corrigir/i, /fechar/i, /exportar/i]) {
    await expect(page.getByRole("button", { name: writeAction })).toHaveCount(0);
  }

  const camClient = createClient(supabaseUrl, publishableKey);
  const signInResult = await camClient.auth.signInWithPassword({ email: camEmail, password: camPassword });
  expect(signInResult.error).toBeNull();
  const denied = await camClient.rpc("submit_demo_entry", {
    p_competencia_id: "c0de0000-0000-4000-8000-000000000001",
    p_indicador_id: "c0de0000-0000-4000-8000-000000000002",
    p_escopo_id: "c0de0000-0000-4000-8000-000000000003",
    p_valor_texto: "10",
    p_operation_id: crypto.randomUUID(),
  });

  expect(denied.error?.code).toBe("42501");
});

test("client-side numeric guards reject invalid values without calling the submit RPC", async ({ page }) => {
  await signIn(page, technicalEmail, technicalPassword, "technical");
  await page.getByRole("link", { name: "Entradas" }).click();

  let rpcCalls = 0;
  await page.route("**/rest/v1/rpc/submit_demo_entry", async (route) => {
    rpcCalls += 1;
    await route.continue();
  });

  for (const invalidValue of ["", "-1", "NaN", "Infinity", "dez", "1e3", "1,5", "1.23456", "100000000"]) {
    const valueInput = page.getByLabel("Valor para o indicador");
    await valueInput.fill(invalidValue);
    await page.getByRole("button", { name: "Registrar entrada" }).click();
    await expect(valueInput).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("alert")).toContainText("Informe um número entre 0 e 99999999.9999");
    await expect(page.locator(".entry-card .success-message")).toHaveCount(0);
  }

  expect(rpcCalls).toBe(0);
  await page.unroute("**/rest/v1/rpc/submit_demo_entry");
});

test("server-side validation still rejects an invalid direct RPC request", async ({ page }) => {
  await signIn(page, technicalEmail, technicalPassword, "technical");

  const technicalClient = createClient(supabaseUrl, publishableKey);
  const signInResult = await technicalClient.auth.signInWithPassword({ email: technicalEmail, password: technicalPassword });
  expect(signInResult.error).toBeNull();
  const rejected = await technicalClient.rpc("submit_demo_entry", {
    p_competencia_id: "c0de0000-0000-4000-8000-000000000001",
    p_indicador_id: "c0de0000-0000-4000-8000-000000000002",
    p_escopo_id: "c0de0000-0000-4000-8000-000000000003",
    p_valor_texto: "1e3",
    p_operation_id: crypto.randomUUID(),
  });

  expect(rejected.error?.code).toBe("22023");
});

test("an expired-session response never appears as a successful entry", async ({ page }) => {
  await signIn(page, technicalEmail, technicalPassword, "technical");
  await page.getByRole("link", { name: "Entradas" }).click();
  await page.route("**/rest/v1/rpc/submit_demo_entry", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ code: "PGRST301", message: "JWT expired" }),
    });
  });

  await page.getByLabel("Valor para o indicador").fill("10");
  await page.getByRole("button", { name: "Registrar entrada" }).click();

  await expect(page.getByRole("alert")).toContainText(/sessão.*expir/i);
  await expect(page.locator(".entry-card .success-message")).toHaveCount(0);
});

test("lost response retry after navigation and reload reuses one operation and one persisted record", async ({ page }) => {
  await signIn(page, technicalEmail, technicalPassword, "technical");
  await page.getByRole("link", { name: "Entradas" }).click();
  const initialIds = await entryIds(page);
  let calls = 0;
  type SubmitPayload = {
    p_competencia_id: string;
    p_indicador_id: string;
    p_escopo_id: string;
    p_valor_texto: string;
    p_operation_id: string;
  };
  let firstPayload: SubmitPayload | undefined;
  let retryPayload: SubmitPayload | undefined;
  let persisted: { entryId: string; resultId: string } | undefined;
  let retryResult: { entryId: string; resultId: string } | undefined;

  await page.route("**/rest/v1/rpc/submit_demo_entry", async (route) => {
    calls += 1;
    const payload = route.request().postDataJSON() as SubmitPayload;
    const response = await route.fetch();
    const result = (await response.json()) as { entryId: string; resultId: string };

    if (calls === 1) {
      firstPayload = payload;
      persisted = result;
      await route.abort();
      return;
    }

    retryPayload = payload;
    retryResult = result;
    await route.fulfill({ response });
  });

  const valueInput = page.getByLabel("Valor para o indicador");
  await valueInput.fill("10");
  await page.getByRole("button", { name: "Registrar entrada" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(valueInput).toBeDisabled();
  await expect(valueInput).toHaveValue("10");
  expect(persisted?.entryId).toBeTruthy();

  await page.getByRole("link", { name: "Histórico e auditoria" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Histórico e auditoria" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/#history$/);
  await waitForHistoryReady(page);
  const historyRow = page.locator(`table[aria-label="Eventos de auditoria autorizados"] tbody tr[data-entry-id="${persisted?.entryId}"]`);
  await expect(historyRow).toHaveCount(1);
  await expect(historyRow).toContainText("Entrada enviada");

  await page.getByRole("link", { name: "Entradas" }).click();
  const restoredInput = page.getByLabel("Valor para o indicador");
  await expect(restoredInput).toBeDisabled();
  await expect(restoredInput).toHaveValue("10");
  await expect(page.getByRole("button", { name: "Repetir mesma operação" })).toBeVisible();
  await entryIds(page);
  await expect(page.locator('table[aria-label="Entradas autorizadas do contexto"] tbody tr[data-entry-id]')).toHaveCount(initialIds.length + 1);
  const entryRow = page.locator(`table[aria-label="Entradas autorizadas do contexto"] tbody tr[data-entry-id="${persisted?.entryId}"]`);
  await expect(entryRow).toHaveCount(1);
  await page.getByRole("button", { name: `Ver detalhe da entrada ${persisted?.entryId}` }).click();
  await expect(page.getByRole("region", { name: `Detalhe da entrada ${persisted?.entryId}` }).locator(".result-memory")).toHaveCount(1);

  await page.getByRole("button", { name: "Repetir mesma operação" }).click();
  await expect(page.locator(".entry-card .success-message")).toContainText("Resultado sintético persistido: 8");

  expect(calls).toBe(2);
  expect(firstPayload?.p_operation_id).toBeTruthy();
  expect(retryPayload).toEqual(firstPayload);
  expect(retryPayload?.p_operation_id).toBe(firstPayload?.p_operation_id);
  expect(firstPayload?.p_valor_texto).toBe("10");
  expect(retryPayload?.p_valor_texto).toBe(firstPayload?.p_valor_texto);
  expect(retryResult?.entryId).toBe(persisted?.entryId);
  expect(retryResult?.resultId).toBe(persisted?.resultId);
  await expect(entryRow).toHaveCount(1);
  const entryDetailButton = page.getByRole("button", { name: new RegExp(`(?:Ver|Ocultar) detalhe da entrada ${persisted?.entryId}`) });
  if (await entryDetailButton.getAttribute("aria-expanded") !== "true") await entryDetailButton.click();
  await expect(page.getByRole("region", { name: `Detalhe da entrada ${persisted?.entryId}` }).locator(".result-memory")).toHaveCount(1);

  await page.getByRole("link", { name: "Histórico e auditoria" }).click();
  await waitForHistoryReady(page);
  await expect(page.locator(`table[aria-label="Eventos de auditoria autorizados"] tbody tr[data-entry-id="${persisted?.entryId}"]`)).toHaveCount(1);
});
