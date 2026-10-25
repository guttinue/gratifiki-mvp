import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { validateOwnedTarget, type OwnedTarget } from "./scripts/verification/runtime.ts";

const ownedValue = process.env.VERIFICATION_OWNED_TARGET;
const owned = ownedValue !== undefined
  ? JSON.parse(ownedValue) as OwnedTarget
  : undefined;
if (ownedValue !== undefined) validateOwnedTarget(owned as OwnedTarget);

export default defineConfig({
  envDir: owned?.workdir,
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'supabase', test: /node_modules\/@supabase\//, priority: 20 },
            { name: 'react', test: /node_modules\/(?:react|react-dom|scheduler)\//, priority: 10 },
          ],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
  },
});
