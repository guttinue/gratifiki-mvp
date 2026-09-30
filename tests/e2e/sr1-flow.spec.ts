import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

test.use({ trace: "off" });
test.describe.configure({ mode: "serial" });

const localUrl = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321";
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
const technicalEmail = process.env.DEMO_TECHNICAL_EMAIL ?? "";
const technicalPassword = process.env.DEMO_TECHNICAL_PASSWORD ?? "";
const camEmail = process.env.DEMO_CAM_EMAIL ?? "";
const camPassword = process.env.DEMO_CAM_PASSWORD ?? "";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/");
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Entrada do indicador" })).toBeVisible();
}

test("area técnica submits a synthetic value and reloads persisted result memory", async ({ page }) => {
  await signIn(page, technicalEmail, technicalPassword);
  const history = page.getByRole("region", { name: "Histórico do piloto" });
  await expect(history).toHaveAttribute("aria-busy", "false");
  const previousEntryIds = await history.locator("article").evaluateAll((articles) =>
    articles.map((article) => article.getAttribute("data-entry-id")),
  );

  const pilotContext = page.getByLabel("Contexto sintético autorizado");
  await expect(pilotContext.getByText("DEMO-2026-09", { exact: true })).toBeVisible();
  await expect(pilotContext.getByText("DEMO-01", { exact: true })).toBeVisible();
  await expect(page.getByText(/demonstração sintética/i)).toBeVisible();
  await page.getByLabel("Valor para o indicador").fill("10");
  await page.getByRole("button", { name: "Registrar entrada" }).click();

  await expect(page.getByRole("status")).toContainText("Resultado sintético persistido: 8");
  await expect(history.getByRole("article")).toHaveCount(previousEntryIds.length + 1);
  const savedEntryIds = await history.locator("article").evaluateAll((articles) =>
    articles.map((article) => article.getAttribute("data-entry-id")),
  );
  const submittedEntryId = savedEntryIds.find((entryId) => !previousEntryIds.includes(entryId));
  expect(submittedEntryId).toBeTruthy();
  const persistedArticle = page.locator(`[data-entry-id="${submittedEntryId}"]`);
  await expect(persistedArticle).toHaveAttribute("aria-label", /entrada de 10.*resultado persistido de 8/i);
  await expect(persistedArticle).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Entrada do indicador" })).toBeVisible();
  await expect(page.locator(`[data-entry-id="${submittedEntryId}"]`)).toBeVisible();
});

test("CAM cannot submit in the UI or through the entry RPC", async ({ page }) => {
  await signIn(page, camEmail, camPassword);

  await expect(page.getByText(/perfil CAM.*não envia/i)).toBeVisible();
  await expect(page.getByLabel("Valor para o indicador")).toHaveCount(0);

  const camClient = createClient(localUrl, publishableKey);
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

test("server validation rejects empty and non-numeric values without a success state", async ({ page }) => {
  await signIn(page, technicalEmail, technicalPassword);
  const history = page.getByRole("region", { name: "Histórico do piloto" });
  await expect(history).toHaveAttribute("aria-busy", "false");
  const savedResultCount = await history.getByRole("article").count();

  for (const invalidValue of ["", "dez"]) {
    await page.getByLabel("Valor para o indicador").fill(invalidValue);
    await page.getByRole("button", { name: "Registrar entrada" }).click();
    await expect(page.getByRole("alert")).toContainText(/servidor rejeitou o valor/i);
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(history.getByRole("article")).toHaveCount(savedResultCount);
  }
});

test("an expired-session response is not shown as a successful entry", async ({ page }) => {
  await signIn(page, technicalEmail, technicalPassword);
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
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("retry after a lost response and reload reuses its operation ID without duplication", async ({ page }) => {
  await signIn(page, technicalEmail, technicalPassword);
  const history = page.getByRole("region", { name: "Histórico do piloto" });
  await expect(history).toHaveAttribute("aria-busy", "false");
  const previousEntryCount = await history.getByRole("article").count();

  let calls = 0;
  let firstPayload: { p_operation_id: string; p_valor_texto: string } | undefined;
  let retryPayload: { p_operation_id: string; p_valor_texto: string } | undefined;
  let firstResult: { entryId: string; resultId: string } | undefined;
  let retryResult: { entryId: string; resultId: string } | undefined;

  await page.route("**/rest/v1/rpc/submit_demo_entry", async (route) => {
    calls += 1;
    const payload = route.request().postDataJSON() as {
      p_operation_id: string;
      p_valor_texto: string;
    };
    const response = await route.fetch();
    const result = (await response.json()) as { entryId: string; resultId: string };

    if (calls === 1) {
      firstPayload = payload;
      firstResult = result;
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

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Entrada do indicador" })).toBeVisible();
  const restoredValueInput = page.getByLabel("Valor para o indicador");
  await expect(restoredValueInput).toBeDisabled();
  await expect(restoredValueInput).toHaveValue("10");
  await expect(page.getByRole("button", { name: "Repetir mesma operação" })).toBeVisible();
  await expect(history).toHaveAttribute("aria-busy", "false");
  await expect(history.getByRole("article")).toHaveCount(previousEntryCount + 1);
  await expect(page.locator(`[data-entry-id="${firstResult?.entryId}"]`)).toHaveCount(1);

  await page.getByRole("button", { name: "Repetir mesma operação" }).click();
  await expect(page.getByRole("status")).toContainText("Resultado sintético persistido: 8");

  expect(firstPayload?.p_operation_id).toBeTruthy();
  expect(retryPayload?.p_operation_id).toBe(firstPayload?.p_operation_id);
  expect(firstPayload?.p_valor_texto).toBe("10");
  expect(retryPayload?.p_valor_texto).toBe(firstPayload?.p_valor_texto);
  expect(retryResult?.entryId).toBe(firstResult?.entryId);
  expect(retryResult?.resultId).toBe(firstResult?.resultId);
  await expect(page.locator(`[data-entry-id="${firstResult?.entryId}"]`)).toHaveCount(1);
  await expect(history.getByRole("article")).toHaveCount(previousEntryCount + 1);
});
