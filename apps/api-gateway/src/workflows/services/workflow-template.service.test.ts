import { describe, expect, it } from "vitest";
import { parseWorkflowTemplateQuery } from "./workflow-template.service.js";

describe("workflow template query parsing", () => {
  it("normalizes keyword searches and clamps the default result limit", () => {
    expect(
      parseWorkflowTemplateQuery({ query: " GitHub, Jira, release-readiness ", category: " Engineering " }),
    ).toEqual({
      terms: ["github", "jira", "release-readiness"],
      category: "engineering",
      limit: 50,
    });
  });

  it("caps callers at fifty results", () => {
    expect(parseWorkflowTemplateQuery({ limit: 100 }).limit).toBe(50);
    expect(parseWorkflowTemplateQuery({ limit: 0 }).limit).toBe(1);
  });
});
