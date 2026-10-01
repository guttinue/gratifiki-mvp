import { expect, test } from "@playwright/test";
import { assertLocalE2eConfiguration } from "./e2eSupport";

test.use({ trace: "off" });

test("local login page opens in the demonstration state", async ({ page }) => {
  assertLocalE2eConfiguration();
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Acesse o piloto local", exact: true })).toBeVisible();
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await expect(page.getByLabel("Senha")).toBeVisible();
});
