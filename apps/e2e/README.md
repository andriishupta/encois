# Encois browser E2E

This is the isolated Cypress application for real browser flows through the
Dashboard. It does not start Docker, Compose, the Dashboard, the API, Temporal,
or Go services. Prepare the application environment separately, then run this
package against the configured URL.

The first flow covers:

1. local owner sign-in through the Firebase Auth Emulator;
2. Dashboard rendering;
3. creation of a `Jira Project Tasks` workflow;
4. selecting the `Customer Success` unit scope;
5. previewing and creating the Blueprint;
6. starting the workflow from the Dashboard;
7. waiting for `Completed` and `Output available`.

Start the local application stack separately, for example:

```bash
pnpm run local
```

Then use the Cypress runner visually:

```bash
pnpm --filter @encois/e2e exec cypress install
pnpm --filter @encois/e2e e2e:open
```

For headless execution:

```bash
pnpm --filter @encois/e2e e2e
```

Package checks:

`build` is a validation-only build for this test package: Cypress specs are
executed by Cypress and do not produce a browser bundle.

```bash
pnpm --filter @encois/e2e build
pnpm --filter @encois/e2e typecheck
pnpm --filter @encois/e2e lint
pnpm --filter @encois/e2e format
pnpm --filter @encois/e2e format:check
```

The defaults target the local Watch mock stack:

```text
E2E_BASE_URL=http://localhost:5173
E2E_DASHBOARD_PATH=/
E2E_OWNER_EMAIL=owner@local.test
E2E_OWNER_PASSWORD=local-password-1234
```

Override them for CI or another prepared environment. `E2E_DASHBOARD_PATH`
supports deployments mounted below a path such as `/dashboard/`.
