import { expect, test } from "@playwright/test";

test("local page opens in the demonstration state", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Ambiente local de demonstração",
      exact: true,
    }),
  ).toBeVisible();
});
