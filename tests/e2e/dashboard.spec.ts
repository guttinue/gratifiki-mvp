import { expect, test, type Page } from "@playwright/test";
import { assertLocalE2eConfiguration, entryIds } from "./e2eSupport";

test.use({ trace: "off" });
test.describe.configure({ mode: "serial" });

const technicalEmail = process.env.DEMO_TECHNICAL_EMAIL ?? "";
const technicalPassword = process.env.DEMO_TECHNICAL_PASSWORD ?? "";

async function signIn(page: Page) {
  assertLocalE2eConfiguration("technical");
  await page.goto("/");
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await page.getByLabel("E-mail").fill(technicalEmail);
  await page.getByLabel("Senha").fill(technicalPassword);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Visão geral" })).toBeVisible();
}

async function assertNoHorizontalPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.pageWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
}

test("hash navigation supports fallback, back and forward while search filters can be cleared", async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { window.location.hash = "#unknown-destination"; });
  await expect(page).toHaveURL(/#overview$/);
  await expect(page.getByRole("heading", { level: 1, name: "Visão geral" })).toBeVisible();

  await page.getByRole("link", { name: "Entradas" }).click();
  await expect(page).toHaveURL(/#entries$/);
  const previousIds = await entryIds(page);
  const search = page.getByRole("searchbox", { name: "Buscar por identificador ou valor" });
  await search.fill(`sem-correspondencia-${crypto.randomUUID()}`);
  await expect(page.getByText("Nenhuma entrada corresponde aos filtros aplicados.", { exact: true })).toBeVisible();
  await search.fill("");

  const entryTableRows = page.locator('table[aria-label="Entradas autorizadas do contexto"] tbody tr[data-entry-id]');
  if (previousIds.length) {
    await expect(entryTableRows).toHaveCount(previousIds.length);
  } else {
    await expect(page.getByText("Nenhuma entrada disponível neste contexto autorizado.", { exact: true })).toBeVisible();
  }

  await page.getByRole("link", { name: "Histórico e auditoria" }).click();
  await expect(page).toHaveURL(/#history$/);
  await expect(page.getByRole("heading", { level: 1, name: "Histórico e auditoria" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#entries$/);
  await expect(page.getByRole("heading", { level: 1, name: "Entradas" })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/#history$/);
  await expect(page.getByRole("heading", { level: 1, name: "Histórico e auditoria" })).toBeVisible();
});

test("login, all three pages, and persisted details fit desktop and narrow mobile viewports", async ({ page }) => {
  assertLocalE2eConfiguration("technical");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Acesse o piloto local" })).toBeVisible();
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await expect(page.getByLabel("Senha")).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    await assertNoHorizontalPageOverflow(page);
  }

  await signIn(page);
  await page.getByRole("link", { name: "Entradas" }).click();
  const previousIds = await entryIds(page);
  await page.getByLabel("Valor para o indicador").fill("2");
  await page.getByRole("button", { name: "Registrar entrada" }).click();
  await expect(page.getByRole("status")).toContainText("Resultado sintético persistido: 1,6");
  await expect(page.locator('table[aria-label="Entradas autorizadas do contexto"] tbody tr[data-entry-id]')).toHaveCount(previousIds.length + 1);
  const entryId = (await entryIds(page)).find((id) => !previousIds.includes(id));
  expect(entryId).toBeTruthy();

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("link", { name: "Visão geral" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Visão geral" })).toBeVisible();
    await assertNoHorizontalPageOverflow(page);

    await page.getByRole("link", { name: "Entradas" }).click();
    await expect(page.locator(`table[aria-label="Entradas autorizadas do contexto"] tbody tr[data-entry-id="${entryId}"]`)).toHaveCount(1);
    const entryDetail = page.getByRole("region", { name: `Detalhe da entrada ${entryId}` });
    if (await entryDetail.count() === 0) {
      await page.getByRole("button", { name: `Ver detalhe da entrada ${entryId}` }).click();
    }
    await expect(entryDetail).toBeVisible();
    await assertNoHorizontalPageOverflow(page);

    await page.getByRole("link", { name: "Histórico e auditoria" }).click();
    const eventRow = page.locator(`table[aria-label="Eventos de auditoria autorizados"] tbody tr[data-entry-id="${entryId}"]`);
    await expect(eventRow).toHaveCount(1);
    await expect(eventRow).toContainText("Entrada enviada");
    await page.getByRole("button", { name: `Ver detalhe da entrada ${entryId}` }).click();
    await expect(page.getByRole("region", { name: `Detalhe da entrada ${entryId}` })).toBeVisible();
    await expect(page.getByRole("region", { name: `Detalhe da entrada ${entryId}` })).toContainText("demo.entry.submitted");
    await assertNoHorizontalPageOverflow(page);
  }
});

test("a failed entries query is reported clearly and is not shown as confirmed zero", async ({ page }) => {
  assertLocalE2eConfiguration("technical");
  await page.route(/\/rest\/v1\/entradas\?/, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: "XX000", message: "synthetic read failure" }),
    });
  });
  await signIn(page);

  await expect(page.getByRole("alert")).toContainText("Não foi possível carregar os registros autorizados");
  await expect(page.getByLabel("Métricas dos registros autorizados")).toHaveCount(0);
});

test("a delayed read response cannot restore workspace data after logout", async ({ page }) => {
  assertLocalE2eConfiguration("technical");
  await page.goto("/");
  await expect(page.getByLabel("E-mail")).toBeVisible();

  let notifyReadStarted!: () => void;
  const readStarted = new Promise<void>((resolve) => { notifyReadStarted = resolve; });
  let releaseRead!: () => void;
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  await page.route(/\/rest\/v1\/entradas\?/, async (route) => {
    const response = await route.fetch();
    notifyReadStarted();
    await readGate;
    await route.fulfill({ response });
  });

  await page.getByLabel("E-mail").fill(technicalEmail);
  await page.getByLabel("Senha").fill(technicalPassword);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Visão geral" })).toBeVisible();
  await readStarted;

  try {
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Acesse o piloto local" })).toBeVisible();
    releaseRead();
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await expect(page.getByRole("navigation", { name: "Navegação principal" })).toHaveCount(0);
    await expect(page.getByText("DEMO-ESCOPO-01", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Acesse o piloto local" })).toBeVisible();
  } finally {
    releaseRead();
    await page.unroute(/\/rest\/v1\/entradas\?/);
  }
});

test("a delayed submit keeps its value while navigating and returns to the same operation", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Entradas" }).click();
  const previousIds = await entryIds(page);
  let notifySubmitStarted!: () => void;
  const submitStarted = new Promise<void>((resolve) => { notifySubmitStarted = resolve; });
  let releaseSubmit!: () => void;
  const submitGate = new Promise<void>((resolve) => { releaseSubmit = resolve; });
  await page.route("**/rest/v1/rpc/submit_demo_entry", async (route) => {
    const response = await route.fetch();
    notifySubmitStarted();
    await submitGate;
    await route.fulfill({ response });
  });

  try {
    await page.getByLabel("Valor para o indicador").fill("3");
    await page.getByRole("button", { name: "Registrar entrada" }).click();
    await submitStarted;
    await page.getByRole("link", { name: "Histórico e auditoria" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Histórico e auditoria" })).toBeVisible();
    await expect(page.locator("#demo-value")).toHaveValue("3");
    await expect(page.locator("#demo-value")).toBeDisabled();
    await page.getByRole("link", { name: "Entradas" }).click();
    await expect(page.getByLabel("Valor para o indicador")).toHaveValue("3");
    releaseSubmit();
    await expect(page.locator(".entry-card .success-message")).toContainText("Resultado sintético persistido: 2,4");
    await expect(page.locator('table[aria-label="Entradas autorizadas do contexto"] tbody tr[data-entry-id]')).toHaveCount(previousIds.length + 1);
  } finally {
    releaseSubmit();
    await page.unroute("**/rest/v1/rpc/submit_demo_entry");
  }
});
