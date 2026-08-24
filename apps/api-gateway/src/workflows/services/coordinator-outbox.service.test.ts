import { describe, expect, it, vi } from "vitest";
import { dispatchCoordinatorOutbox } from "./coordinator-outbox.service.js";

describe("coordinator outbox dispatcher", () => {
  it("fails closed without persistence and does not call the sink", async () => {
    const sink = vi.fn(async () => undefined);

    await expect(
      dispatchCoordinatorOutbox({
        organizationId: "org-1",
        sink,
      }),
    ).resolves.toEqual({
      status: "persistence-unavailable",
      claimed: 0,
      delivered: 0,
      failed: 0,
    });
    expect(sink).not.toHaveBeenCalled();
  });
});
