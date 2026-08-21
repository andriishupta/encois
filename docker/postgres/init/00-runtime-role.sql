DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_gateway') THEN
    CREATE ROLE api_gateway
      LOGIN
      PASSWORD 'api_gateway'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS;
  ELSE
    ALTER ROLE api_gateway LOGIN PASSWORD 'api_gateway';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE encois TO api_gateway;
