import { describe, expect, it } from "vitest";
import { organizationUnitIdsForPrincipal, unsupportedNotificationDeliveryRequested } from "./notifications.service.js";

describe("notifications service scope normalization", () => {
  it("keeps only canonical organization-unit UUIDs for UUID-backed queries", () => {
    expect(organizationUnitIdsForPrincipal({
      actorId: "actor",
      organizationId: "organization",
      scope: ["46669ac6-e526-42df-8db9-95f2469bddb1", "root", "engineering"],
    })).toEqual(["46669ac6-e526-42df-8db9-95f2469bddb1"]);
  });

  it("does not turn a slug-only fixture scope into an invalid SQL IN list", () => {
    expect(organizationUnitIdsForPrincipal({ actorId: "actor", organizationId: "organization", scope: ["root"] })).toEqual([]);
  });

  it("marks delivery channels without adapters as unavailable", () => {
    expect(unsupportedNotificationDeliveryRequested({ emailEnabled: false, pushEnabled: false, workflowUpdates: true, evidenceReady: true, weeklyDigest: false })).toBe(false);
    expect(unsupportedNotificationDeliveryRequested({ emailEnabled: true, pushEnabled: false, workflowUpdates: true, evidenceReady: true, weeklyDigest: false })).toBe(true);
    expect(unsupportedNotificationDeliveryRequested({ emailEnabled: false, pushEnabled: false, workflowUpdates: true, evidenceReady: true, weeklyDigest: true })).toBe(true);
  });
});
