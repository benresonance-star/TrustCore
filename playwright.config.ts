import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.TRUST_E2E_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: externalBaseUrl ?? "http://127.0.0.1:4312",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command:
            "corepack pnpm@10.15.0 --filter @trust-core/control-centre build && corepack pnpm@10.15.0 --filter @trust-core/control-centre exec vite preview --host 127.0.0.1",
          url: "http://127.0.0.1:4312",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
