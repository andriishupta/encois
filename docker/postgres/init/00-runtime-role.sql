DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_gateway') THEN
    CREATE ROLE api_gateway
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS;
  ELSE
    ALTER ROLE api_gateway NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_gateway_runtime') THEN
    CREATE ROLE api_gateway_runtime
      LOGIN
      PASSWORD 'api_gateway'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS
      IN ROLE api_gateway;
  ELSE
    ALTER ROLE api_gateway_runtime
      LOGIN
      PASSWORD 'api_gateway'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS;
    GRANT api_gateway TO api_gateway_runtime;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE encois TO api_gateway_runtime;
