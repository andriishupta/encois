import { defineConfig } from "cypress";

const environment = process.env;
const dashboardPath = (environment.E2E_DASHBOARD_PATH ?? "/").trim() || "/";

export default defineConfig({
  e2e: {
    baseUrl: environment.E2E_BASE_URL ?? "http://localhost:5173",
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: "cypress/support/e2e.ts",
    defaultCommandTimeout: 15_000,
    pageLoadTimeout: 30_000,
    requestTimeout: 30_000,
    responseTimeout: 30_000,
    retries: {
      openMode: 0,
      runMode: 1,
    },
    screenshotOnRunFailure: true,
    video: false,
    env: {
      dashboardPath,
      ownerEmail: environment.E2E_OWNER_EMAIL ?? "owner@local.test",
      ownerPassword: environment.E2E_OWNER_PASSWORD ?? "local-password-1234",
    },
  },
});
