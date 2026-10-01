import { expect, test } from "@playwright/test";
import { assertLocalE2eConfiguration } from "./e2eSupport";

test.use({ trace: "off" });

test("local login page opens in the demonstration state", async ({ page }) => {
  assertLocalE2eConfiguration();
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Acesse o piloto local", exact: true })).toBeVisible();
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await expect(page.getByLabel("Senha")).toBeVisible();

  for (const protectedHash of ["#entries", "#history"]) {
    await page.goto(`/${protectedHash}`);

    await expect(page.getByRole("heading", { level: 1, name: "Acesse o piloto local", exact: true })).toBeVisible();
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await expect(page.getByLabel("Senha")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Navegação principal" })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Entradas autorizadas do contexto" })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Eventos de auditoria autorizados" })).toHaveCount(0);
    await expect(page.getByLabel("Métricas dos registros autorizados")).toHaveCount(0);
    await expect(page.getByLabel("Valor para o indicador")).toHaveCount(0);
    await expect(page.getByText("DEMO-ESCOPO-01", { exact: true })).toHaveCount(0);
  }
});
