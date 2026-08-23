
const apiBaseUrl = (process.env.LOCAL_API_URL?.trim() || "http://127.0.0.1:8787/api/v1").replace(/\/$/, "");
const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();

if (process.env.NODE_ENV === "production") throw new Error("Local API verification cannot run in production.");
if (!emulatorHost) throw new Error("FIREBASE_AUTH_EMULATOR_HOST is required for local API verification.");

type AuthResponse = { idToken: string };
type Workflow = { workflowId: string; status: string };
type Recommendation = { id: string; recommendationKey: string; status: string };
type PlannerVersion = { id: string; versionHash: string; usageCount: number; firstPlanId: string; lastPlanId: string };

async function signIn(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`http://${emulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!response.ok) throw new Error(`Firebase sign-in failed for ${email}: ${response.status} ${await response.text()}`);
  const body = (await response.json()) as Partial<AuthResponse>;
  if (!body.idToken) throw new Error(`Firebase sign-in returned no ID token for ${email}.`);
  return { idToken: body.idToken };
}

async function apiRequest<T>(
  path: string,
  idToken: string,
  organizationId?: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; data: T | null }> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      accept: "application/json",
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      authorization: `Bearer ${idToken}`,
      ...(organizationId ? { "X-Organization-ID": organizationId } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body = (await response.json().catch(() => null)) as { data?: T } | null;
  return { status: response.status, data: body?.data ?? null };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function verify(): Promise<void> {
  const owner = await signIn("owner@local.test", "local-password-1234");
  const ownerAuth = await apiRequest<{ status: string; organizationId?: string }>("/auth/me", owner.idToken);
  assert(ownerAuth.status === 200 && ownerAuth.data?.status === "active", "Owner authentication did not resolve to active access.");
  const organizationId = ownerAuth.data.organizationId;
  if (!organizationId) throw new Error("Owner authentication did not return an organization.");

  const [workflows, activity, integrations, sources, recommendations, plannerVersions] = await Promise.all([
    apiRequest<Workflow[]>("/workflows", owner.idToken, organizationId),
    apiRequest<unknown[]>("/workflows/activity", owner.idToken, organizationId),
    apiRequest<unknown[]>("/integrations", owner.idToken, organizationId),
    apiRequest<unknown[]>("/sources", owner.idToken, organizationId),
    apiRequest<Recommendation[]>("/investigations/recommendations", owner.idToken, organizationId),
    apiRequest<PlannerVersion[]>("/workflows/planner-versions", owner.idToken, organizationId),
  ]);
  assert(workflows.status === 200 && Array.isArray(workflows.data), "Owner cannot read the Temporal workflow list.");
  assert(activity.status === 200 && Array.isArray(activity.data), "Owner cannot read workflow activity.");
  assert(integrations.status === 200 && Array.isArray(integrations.data) && integrations.data.length >= 3, "Owner cannot see seeded integrations.");
  assert(sources.status === 200 && Array.isArray(sources.data) && sources.data.length >= 4, "Owner cannot see seeded Knowledge Sources.");
  assert(recommendations.status === 200 && Array.isArray(recommendations.data) && recommendations.data.length > 0, "Owner cannot see scoped persisted recommendations.");
  assert(recommendations.data.every((recommendation) => recommendation.id.length > 0 && recommendation.recommendationKey.length > 0 && new Set(["open", "accepted", "dismissed"]).has(recommendation.status)), "Recommendation response contains an invalid recommendation state.");
  assert(plannerVersions.status === 200 && Array.isArray(plannerVersions.data), "Owner cannot read planner version history.");
  assert(plannerVersions.data.every((version) => version.id.length > 0 && version.versionHash.length === 64 && Number.isInteger(version.usageCount) && version.usageCount > 0 && version.firstPlanId.length > 0 && version.lastPlanId.length > 0), "Planner version history contains an invalid fingerprint projection.");

  const firstWorkflow = workflows.data[0];
  if (firstWorkflow) {
    const events = await apiRequest<unknown[]>(`/workflows/${encodeURIComponent(firstWorkflow.workflowId)}/events`, owner.idToken, organizationId);
    assert(events.status === 200 && Array.isArray(events.data), "Owner cannot see workflow events.");
  }

  const onboarding = await signIn("onboarding1@local.test", "local-onboarding-1");
  const onboardingAuth = await apiRequest<{ status: string; permissions?: string[] }>("/auth/me", onboarding.idToken);
  assert(onboardingAuth.status === 200 && onboardingAuth.data?.status === "active", "Onboarding fixture did not become active after invite acceptance.");
  assert(onboardingAuth.data.permissions?.includes("onboarding:manage") === true, "Onboarding fixture lacks onboarding management permission.");
  const invalidOnboardingSelection = await apiRequest<unknown>(
    "/organization/onboarding",
    onboarding.idToken,
    organizationId,
    { method: "PATCH", body: { selectedWorkflows: ["missing-catalog-selection-local"] } },
  );
  assert(invalidOnboardingSelection.status === 400, "Onboarding accepted a workflow selection outside the published catalog.");

  const restricted = await signIn("viewer@local.test", "local-viewer-1234");
  const restrictedAuth = await apiRequest<{ status: string; organizationId?: string }>("/auth/me", restricted.idToken);
  assert(restrictedAuth.status === 200 && restrictedAuth.data?.status === "active" && restrictedAuth.data.organizationId === organizationId, "Viewer authentication did not resolve to the seeded organization.");
  const restrictedWorkflows = await apiRequest<Workflow[]>("/workflows", restricted.idToken, organizationId);
  const restrictedPlannerVersions = await apiRequest<unknown[]>("/workflows/planner-versions", restricted.idToken, organizationId);
  assert(restrictedWorkflows.status === 200 && Array.isArray(restrictedWorkflows.data), "Restricted user cannot read its authorized workflow scope.");
  assert(restrictedPlannerVersions.status === 403, "Restricted user can read planner history without workflows:manage permission.");
  assert(restrictedWorkflows.data.every((workflow) => workflow.workflowId.includes(":automation-test-readiness")), "Viewer received a workflow outside the Checkout fixture scope.");
  const restrictedWorkflow = restrictedWorkflows.data[0];
  if (restrictedWorkflow) {
    const restrictedSignal = await apiRequest<{ accepted: boolean }>(
      `/workflows/${encodeURIComponent(restrictedWorkflow.workflowId)}/signals`,
      restricted.idToken,
      organizationId,
      {
        method: "POST",
        body: {
          contractVersion: "workflow-signal.v1",
          signalName: "blueprint-approval",
          signalId: "local-restricted-permission-check",
          payload: { stepId: "approval", approved: true },
        },
      },
    );
    assert(restrictedSignal.status === 403, "Restricted user was allowed to change a workflow without workflows:run permission.");
  }
  console.log(JSON.stringify({
    ok: true,
    organizationId,
    ownerWorkflowCount: workflows.data.length,
    restrictedWorkflowIds: restrictedWorkflows.data.map((workflow) => workflow.workflowId),
    ownerActivityCount: activity.data.length,
  }, null, 2));
}

await verify();
