import { describe, expect, it } from "vitest";
import {
  parseRuntimeWorkflowResult,
  workflowEventProjection,
} from "./workflow.service.js";

describe("workflow event projections", () => {
  it("normalizes evidence provenance and trace metadata into typed projections", () => {
    const event = workflowEventProjection({
      id: "event-1",
      eventType: "activity_completed",
      status: "completed",
      activityName: "ExecuteBlueprintStep",
      agentRunId: "agent-run-1",
      evidenceRef: "evidence://release/1",
      metadata: {
        evidenceRefs: ["evidence://release/2"],
        provenance: {
          source: "jira",
          sourceRecordId: "JIRA-1",
          observedAt: "2026-08-22T10:00:00.000Z",
          ingestedAt: "2026-08-22T10:01:00.000Z",
          transformationVersion: "jira-normalizer.v1",
        },
        freshness: {
          source: "jira",
          observedAt: "2026-08-22T10:00:00.000Z",
          status: "fresh",
        },
        confidence: 0.92,
        provider: "jira",
        model: "gemini-3.5",
        durationMs: 840,
        attempt: 2,
        redacted: true,
      },
      occurredAt: new Date("2026-08-22T10:02:00.000Z"),
      organizationId: "org-1",
      workflowRunId: "run-1",
    } as never);

    expect(event.evidence).toHaveLength(2);
    expect(event.evidence?.[0]).toMatchObject({
      reference: "evidence://release/1",
      confidence: 0.92,
      provenance: { sourceRecordId: "JIRA-1" },
    });
    expect(event.trace).toMatchObject({
      provider: "jira",
      model: "gemini-3.5",
      durationMs: 840,
      attempt: 2,
      redacted: true,
    });
  });

  it("accepts only typed Temporal step results and preserves evidence metadata", () => {
    const result = parseRuntimeWorkflowResult({
      contractVersion: "blueprint-workflow-result.v1",
      status: "completed",
      steps: [
        {
          stepId: "collect",
          status: "completed",
          evidenceRefs: ["github://acme/checkout"],
          provenance: {
            source: "github",
            sourceRecordId: "acme/checkout",
            observedAt: "2026-08-22T10:00:00.000Z",
          },
          freshness: [
            {
              source: "github",
              observedAt: "2026-08-22T10:00:00.000Z",
              status: "fresh",
            },
          ],
          confidence: 0.88,
          trace: {
            provider: "github",
            durationMs: 420,
            attempt: 1,
            outcome: "completed",
            redacted: true,
          },
        },
      ],
    });
    expect(result?.steps[0]?.trace).toMatchObject({
      provider: "github",
      durationMs: 420,
      attempt: 1,
      outcome: "completed",
      redacted: true,
    });

    expect(result?.steps[0]).toMatchObject({
      stepId: "collect",
      evidenceRefs: ["github://acme/checkout"],
      provenance: { source: "github", sourceRecordId: "acme/checkout" },
      confidence: 0.88,
      freshness: [{ source: "github", status: "fresh" }],
    });
    expect(
      parseRuntimeWorkflowResult({
        contractVersion: "blueprint-workflow-result.v1",
        status: "completed",
        steps: [{ status: "completed" }],
      }),
    ).toBeUndefined();
    expect(
      parseRuntimeWorkflowResult({
        contractVersion: "blueprint-workflow-result.v1",
        status: "completed",
        steps: [{ stepId: "collect", status: "completed", confidence: 1.01 }],
      }),
    ).toBeUndefined();
    expect(
      parseRuntimeWorkflowResult({
        contractVersion: "blueprint-workflow-result.v1",
        status: "completed",
        steps: [
          { stepId: "collect", status: "completed", trace: { attempt: 0 } },
        ],
      }),
    ).toBeUndefined();
    expect(
      parseRuntimeWorkflowResult({
        contractVersion: "other.v1",
        status: "completed",
        steps: [],
      }),
    ).toBeUndefined();
  });
});
