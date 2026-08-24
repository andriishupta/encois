import { describe, expect, it } from "vitest";
import { canonicalOrganizationUnitIds } from "./identity-platform.js";

describe("identity platform scope projection", () => {
  it("keeps canonical organization-unit IDs out of presentation metadata", () => {
    expect(
      canonicalOrganizationUnitIds(
        [
          { id: "46669ac6-e526-42df-8db9-95f2469bddb1" },
          { id: "7e883f52-11b9-4a78-9b9c-ae2d1a1c3b4d" },
        ],
        ["46669ac6-e526-42df-8db9-95f2469bddb1", "root", "engineering"],
      ),
    ).toEqual(["46669ac6-e526-42df-8db9-95f2469bddb1"]);
  });
});
