function appRoute(path = ""): string {
  const configuredPath = String(Cypress.env("dashboardPath") ?? "/").replace(
    /\/+$/u,
    "",
  );
  const normalizedPath = path.replace(/^\/+/, "");

  if (!normalizedPath) return `${configuredPath}/`;
  return `${configuredPath}/${normalizedPath}`;
}

describe("Dashboard workflow success flow", () => {
  it("logs in as the owner, creates a Customer Success workflow, runs it, and reaches a successful result", () => {
    const workflowName = `Cypress Customer Success ${Date.now()}`;
    const ownerEmail = String(Cypress.env("ownerEmail"));
    const ownerPassword = String(Cypress.env("ownerPassword"));

    cy.viewport(1280, 800);
    cy.visit(appRoute("login"));
    cy.get('[data-testid="local-auth-email"]')
      .should("be.visible")
      .type(ownerEmail);
    cy.get('[data-testid="local-auth-password"]')
      .should("be.visible")
      .type(ownerPassword, { log: false });
    cy.get('[data-testid="local-auth-submit"]').click();

    cy.location("pathname").should("eq", appRoute());
    cy.get('[data-testid="dashboard-page"]').should("be.visible");
    cy.get('[data-testid="dashboard-run-workflow"]').click();

    cy.location("pathname").should("eq", appRoute("workflows"));
    cy.get('[data-testid="workflows-page"]').should("be.visible");
    cy.get('[data-testid="workflows-new"]').click();

    cy.location("pathname").should("eq", appRoute("workflows/new"));
    cy.get('[data-testid="workflow-source-template"]').click();
    cy.get('[data-testid="workflow-template-jira-project-tasks"]', {
      timeout: 30_000,
    }).click();

    cy.get('[data-testid="workflow-name"]').type(workflowName);
    cy.get('[data-testid="workflow-execution-scope"]')
      .find("option")
      .contains("Customer Success")
      .then(($option) => {
        const value = $option.val();
        expect(value, "Customer Success scope option").to.be.a("string");
        cy.get('[data-testid="workflow-execution-scope"]').select(
          String(value),
        );
      });

    cy.get('[data-testid="workflow-preview-blueprint"]').click();
    cy.get('[data-testid="workflow-review-stage"]').should("be.visible");
    cy.get('[data-testid="workflow-create-blueprint"]').click();
    cy.get('[data-testid="workflow-blueprint-created"]', {
      timeout: 30_000,
    })
      .should("be.visible")
      .parent()
      .parent()
      .find("button")
      .contains("Open Workflow")
      .click();

    cy.location("pathname", { timeout: 30_000 }).should(
      "match",
      new RegExp(`${appRoute("workflows")}/[^/]+$`),
    );
    cy.get('[data-testid="workflow-run-status"]', {
      timeout: 120_000,
    }).should("contain.text", "Completed");
    cy.get('[data-testid="workflow-output-title"]').should(
      "contain.text",
      "Output available",
    );
  });
});
