#!/usr/bin/env bash

set -euo pipefail

if ! command -v temporal >/dev/null 2>&1; then
  echo "temporal CLI is required; install it before running smoke:release:local" >&2
  exit 1
fi

smoke_tmp_dir="$(mktemp -d)"
temporal_pid=""
gateway_pid=""
runtime_pid=""

cleanup() {
  set +e
  for pid in "$runtime_pid" "$gateway_pid" "$temporal_pid"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$smoke_tmp_dir"
}
trap cleanup EXIT INT TERM

wait_for_port() {
  local host="$1"
  local port="$2"
  local deadline=$((SECONDS + 30))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then
      exec 3>&-
      exec 3<&-
      return 0
    fi
    sleep 1
  done
  echo "timed out waiting for $host:$port" >&2
  return 1
}

wait_for_http() {
  local url="$1"
  local deadline=$((SECONDS + 30))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl --fail --silent "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "timed out waiting for $url" >&2
  return 1
}

assert_http_status() {
  local expected="$1"
  shift
  local actual
  actual="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$@")"
  if [ "$actual" != "$expected" ]; then
    echo "expected HTTP $expected, got HTTP $actual for $*" >&2
    return 1
  fi
}

temporal server start-dev --headless --log-level error >"$smoke_tmp_dir/temporal.log" 2>&1 &
temporal_pid=$!
wait_for_port 127.0.0.1 7233

(
  cd apps/agent-gateway
  AGENT_GATEWAY_HTTP_ADDR=:8080 \
  AGENT_GATEWAY_POLICY_VERSION=policy-read-only-fixture-v1 \
  AGENT_GATEWAY_DATA_MODE=mock \
  AGENT_GATEWAY_SERVICE_TOKEN=local-agent-runtime-token \
  go run ./cmd/agent-gateway
) >"$smoke_tmp_dir/agent-gateway.log" 2>&1 &
gateway_pid=$!
wait_for_http http://127.0.0.1:8080/health/ready

# Verify the private boundary before starting the positive execution path.
assert_http_status 401 \
  --request GET \
  http://127.0.0.1:8080/v1/tools
assert_http_status 403 \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer local-agent-runtime-token' \
  --data '{"contractVersion":"tool-request.v1","requestId":"smoke-denied","workflowId":"workflow:smoke-org:denied","organizationId":"smoke-org","actorId":"smoke-user","policyVersion":"policy-read-only-fixture-v1","scope":{"ids":["team-smoke"]},"tool":"unknown.tool","arguments":{}}' \
  http://127.0.0.1:8080/v1/tools/invoke

(
  cd apps/agent-runtime
  AGENT_RUNTIME_HTTP_ADDR=:8090 \
  TEMPORAL_HOST_PORT=127.0.0.1:7233 \
  TEMPORAL_NAMESPACE=default \
  TEMPORAL_TASK_QUEUE=encois-agent-runtime \
  AGENT_AI_MODE=mock \
  AGENT_MEMORY_MODE=mock \
  AGENT_GATEWAY_URL=http://127.0.0.1:8080 \
  AGENT_GATEWAY_SERVICE_TOKEN=local-agent-runtime-token \
  go run ./cmd/agent-runtime
) >"$smoke_tmp_dir/agent-runtime.log" 2>&1 &
runtime_pid=$!
wait_for_http http://127.0.0.1:8090/health/ready

TEMPORAL_ADDRESS=127.0.0.1:7233 \
TEMPORAL_NAMESPACE=default \
TEMPORAL_TASK_QUEUE=encois-agent-runtime \
AGENT_GATEWAY_SERVICE_TOKEN=local-agent-runtime-token \
pnpm smoke:release

TEMPORAL_ADDRESS=127.0.0.1:7233 \
TEMPORAL_NAMESPACE=default \
TEMPORAL_TASK_QUEUE=encois-agent-runtime \
AGENT_GATEWAY_SERVICE_TOKEN=local-agent-runtime-token \
pnpm smoke:approval
