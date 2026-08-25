import { describe, expect, it } from "vitest";
import { isNavigationItemActive } from "./navigation";

describe("isNavigationItemActive", () => {
  it("does not keep the Workflows list active on Blueprint pages", () => {
    expect(isNavigationItemActive("/workflows/blueprints", "/workflows")).toBe(
      false,
    );
    expect(
      isNavigationItemActive("/workflows/blueprints", "/workflows/blueprints"),
    ).toBe(true);
    expect(
      isNavigationItemActive(
        "/workflows/blueprints/v1",
        "/workflows/blueprints",
      ),
    ).toBe(true);
  });

  it("maps workflow execution detail pages to Runs", () => {
    expect(
      isNavigationItemActive("/workflows/run-123", "/workflows/runs"),
    ).toBe(true);
    expect(isNavigationItemActive("/workflows/new", "/workflows/runs")).toBe(
      false,
    );
    expect(isNavigationItemActive("/workflows/new", "/workflows")).toBe(true);
    expect(
      isNavigationItemActive("/workflows/blueprints", "/workflows/runs"),
    ).toBe(false);
    expect(isNavigationItemActive("/memory/workflow", "/workflows/runs")).toBe(
      false,
    );
    expect(
      isNavigationItemActive("/memory/workflow", "/memory/workflow"),
    ).toBe(true);
  });

  it("keeps nested organization source and integration pages active under their list item", () => {
    expect(
      isNavigationItemActive(
        "/memory/sources/source-123",
        "/memory/sources",
      ),
    ).toBe(true);
    expect(
      isNavigationItemActive(
        "/organization/integrations/github",
        "/organization/integrations",
      ),
    ).toBe(true);
  });

  it("keeps Activity isolated from Dashboard and other workspace routes", () => {
    expect(isNavigationItemActive("/activity", "/activity")).toBe(true);
    expect(isNavigationItemActive("/activity", "/")).toBe(false);
    expect(isNavigationItemActive("/workflows/runs", "/activity")).toBe(false);
  });

  it("activates the standalone Settings documentation route", () => {
    expect(
      isNavigationItemActive(
        "/settings/documentation",
        "/settings/documentation",
      ),
    ).toBe(true);
    expect(
      isNavigationItemActive("/settings/workspace", "/settings/documentation"),
    ).toBe(false);
  });
});
