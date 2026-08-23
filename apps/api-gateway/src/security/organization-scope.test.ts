import { describe, expect, it } from "vitest";
import { organizationScopeCovers, organizationScopesOverlap } from "./organization-scope.js";

const units = [
  { id: "org", type: "organization" as const },
  { id: "engineering", parentId: "org", type: "department" as const },
  { id: "checkout", parentId: "engineering", type: "project" as const },
  { id: "operations", parentId: "org", type: "department" as const },
] as const;

describe("organization scope hierarchy", () => {
  it("allows an organization binding to cover a descendant source or workflow", () => {
    expect(organizationScopeCovers(units, ["org"], ["checkout"])).toBe(true);
  });

  it("allows a manager scope to cover descendants but not a sibling", () => {
    expect(organizationScopeCovers(units, ["engineering"], ["checkout"])).toBe(true);
    expect(organizationScopeCovers(units, ["engineering"], ["operations"])).toBe(false);
  });

  it("does not allow a child binding to cover its parent or a sibling", () => {
    expect(organizationScopeCovers(units, ["engineering"], ["org"])).toBe(false);
    expect(organizationScopeCovers(units, ["engineering"], ["operations"])).toBe(false);
  });

  it("treats ancestor and descendant scopes as overlapping", () => {
    expect(organizationScopesOverlap(units, ["org"], ["checkout"])).toBe(true);
    expect(organizationScopesOverlap(units, ["engineering"], ["operations"])).toBe(false);
  });

  it("does not let an unknown selected unit pass the wildcard shortcut", () => {
    expect(organizationScopeCovers(units, ["*"], ["missing"])).toBe(false);
  });
});
