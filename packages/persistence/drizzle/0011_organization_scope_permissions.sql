-- Organization permission administration uses membership_scopes as the
-- durable source of direct grants. Removal is tenant-scoped and Gateway
-- authorization-controlled before this privilege can be exercised.
GRANT DELETE ON "membership_scopes" TO api_gateway;
