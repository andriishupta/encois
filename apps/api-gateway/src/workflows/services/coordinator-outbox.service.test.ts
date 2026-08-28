import { describe, expect, it, vi } from "vitest";
import { dispatchCoordinatorOutbox } from "./coordinator-outbox.service.js";

describe("coordinator outbox dispatcher", () => {
  it("fails closed without a database and does not call the sink", async () => {
    const sink = vi.fn(async () => undefined);

    await expect(
      dispatchCoordinatorOutbox({
        sink,
      }),
    ).resolves.toEqual({
      status: "database-unavailable",
      claimed: 0,
      delivered: 0,
      failed: 0,
    });
    expect(sink).not.toHaveBeenCalled();
  });
});
