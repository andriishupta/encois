DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_gateway_retention') THEN
    CREATE ROLE api_gateway_retention
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      INHERIT
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO api_gateway_retention;
GRANT EXECUTE ON FUNCTION public.current_organization_id() TO api_gateway_retention;
GRANT SELECT, DELETE ON "workflow_command_receipts", "workflow_events", "workflow_runs" TO api_gateway_retention;
GRANT SELECT, INSERT ON "audit_events" TO api_gateway_retention;
