// E2E config — boots Vite and drives the real UI against the mock adapter
// (`/?agent=mock`), so no agent CLI, credentials, or bridge are needed.
// Run with: bun run e2e
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5177",
  },
  webServer: {
    command: "bun run dev -- --port 5177 --strictPort",
    url: "http://localhost:5177",
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
  },
});
