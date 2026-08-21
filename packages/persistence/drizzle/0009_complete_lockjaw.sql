ALTER TABLE "suggested_workflow_versions" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "suggested_workflow_versions" ADD CONSTRAINT "suggested_workflow_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE "suggested_workflow_versions" AS versions
SET "organization_id" = workflows."organization_id"
FROM "suggested_workflows" AS workflows
WHERE workflows."id" = versions."suggested_workflow_id";--> statement-breakpoint
DROP POLICY suggested_workflow_versions_tenant_isolation ON "suggested_workflow_versions";--> statement-breakpoint
CREATE POLICY suggested_workflow_versions_tenant_isolation ON "suggested_workflow_versions"
  USING (
    (organization_id IS NULL OR organization_id = public.current_organization_id())
    AND EXISTS (
      SELECT 1
      FROM public.suggested_workflows
      WHERE public.suggested_workflows.id = suggested_workflow_id
        AND public.suggested_workflows.organization_id IS NOT DISTINCT FROM organization_id
    )
  )
  WITH CHECK (
    organization_id = public.current_organization_id()
    AND EXISTS (
      SELECT 1
      FROM public.suggested_workflows
      WHERE public.suggested_workflows.id = suggested_workflow_id
        AND public.suggested_workflows.organization_id IS NOT DISTINCT FROM organization_id
    )
  );
