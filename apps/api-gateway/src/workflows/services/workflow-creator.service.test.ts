import { describe, expect, it } from "vitest";
import { assertWorkflowProviderBindingsReady } from "./workflow-creator.service.js";

describe("workflow provider bindings", () => {
  it("allows creation when all required slots are resolved", () => {
    expect(() =>
      assertWorkflowProviderBindingsReady([
        {
          slotKey: "code",
          required: true,
          status: "ready",
          provider: "github",
          capabilities: ["code.read"],
        },
        {
          slotKey: "chat",
          required: false,
          status: "missing",
          capabilities: ["messages.read"],
        },
      ]),
    ).not.toThrow();
  });

  it("blocks submission when a required slot is missing", () => {
    expect(() =>
      assertWorkflowProviderBindingsReady([
        {
          slotKey: "code",
          required: true,
          status: "missing",
          capabilities: ["code.read"],
        },
      ]),
    ).toThrowError(
      "Configure a matching Source in the selected scope for the required code capability before creating this workflow.",
    );
  });
});
