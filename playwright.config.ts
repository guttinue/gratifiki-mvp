import { defineConfig, devices } from "@playwright/test";
import { validateOwnedTarget, type OwnedTarget } from "./scripts/verification/runtime.ts";

const owned = process.env.VERIFICATION_OWNED_TARGET;
if (owned !== undefined) validateOwnedTarget(JSON.parse(owned) as OwnedTarget);
const port = Number(process.env.E2E_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid E2E port");
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL,
    trace: owned ? "off" : "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run ${owned ? 'preview' : 'dev'} -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
