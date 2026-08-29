#!/usr/bin/env bash

set -euo pipefail

if ! command -v temporal >/dev/null 2>&1; then
  echo "temporal CLI is required; install it before running scripts/smoke-release-local.sh" >&2
  exit 1
fi

smoke_tmp_dir="$(mktemp -d)"
temporal_pid=""
gateway_pid=""
runtime_pid=""
temporal_port="${ENCOIS_SMOKE_TEMPORAL_PORT:-7234}"
temporal_address="127.0.0.1:${temporal_port}"
temporal_ui_port=$((temporal_port + 1000))
gateway_port="${ENCOIS_SMOKE_AGENT_GATEWAY_PORT:-8081}"
gateway_address="http://127.0.0.1:${gateway_port}"
runtime_port="${ENCOIS_SMOKE_AGENT_RUNTIME_PORT:-8091}"
runtime_address="http://127.0.0.1:${runtime_port}"

cleanup() {
  local status=$?
  set +e
  if [ "$status" -ne 0 ]; then
    for log in temporal agent-gateway agent-runtime; do
      if [ -f "$smoke_tmp_dir/$log.log" ]; then
        echo "--- $log smoke log ---" >&2
        tail -n 200 "$smoke_tmp_dir/$log.log" >&2
      fi
    done
  fi
  for pid in "$runtime_pid" "$gateway_pid" "$temporal_pid"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$smoke_tmp_dir"
  return "$status"
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

(cd apps/agent-gateway && go build -o "$smoke_tmp_dir/agent-gateway" ./cmd/agent-gateway)
(cd apps/agent-runtime && go build -o "$smoke_tmp_dir/agent-runtime" ./cmd/agent-runtime)

temporal server start-dev --headless --log-level error --namespace encois --ip 127.0.0.1 --port "$temporal_port" --ui-port "$temporal_ui_port" >"$smoke_tmp_dir/temporal.log" 2>&1 &
temporal_pid=$!
wait_for_port 127.0.0.1 "$temporal_port"

AGENT_GATEWAY_HTTP_ADDR=":${gateway_port}" \
  AGENT_GATEWAY_POLICY_VERSION=policy-read-only-fixture-v1 \
  AGENT_GATEWAY_DATA_MODE=mock \
  AGENT_GATEWAY_STORAGE_MODE=memory \
  AGENT_GATEWAY_CAPABILITY_SECRET=local-execution-capability-secret \
  AGENT_GATEWAY_SERVICE_TOKEN=local-agent-runtime-token \
  "$smoke_tmp_dir/agent-gateway" >"$smoke_tmp_dir/agent-gateway.log" 2>&1 &
gateway_pid=$!
wait_for_http "${gateway_address}/health/ready"

# Verify the private boundary before starting the positive execution path.
assert_http_status 401 \
  --request GET \
  "${gateway_address}/v1/tools"
assert_http_status 403 \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer local-agent-runtime-token' \
  --data '{"contractVersion":"tool-request.v1","requestId":"smoke-denied","workflowId":"workflow:smoke-org:denied","organizationId":"smoke-org","actorId":"smoke-user","policyVersion":"policy-read-only-fixture-v1","scope":{"ids":["team-smoke"]},"capability":"invalid","blueprintId":"smoke-denied-blueprint","blueprintVersion":"1.0.0","allowedTools":["unknown.tool"],"tool":"unknown.tool","arguments":{}}' \
  "${gateway_address}/v1/tools/invoke"

AGENT_RUNTIME_HTTP_ADDR=":${runtime_port}" \
  TEMPORAL_HOST_PORT="$temporal_address" \
  TEMPORAL_NAMESPACE=encois \
  TEMPORAL_TASK_QUEUE=encois-agent-runtime \
  AGENT_AI_MODE=mock \
  AGENT_SOURCE_MODE=mock \
  AGENT_MEMORY_MODE=mock \
  AGENT_GATEWAY_URL="${gateway_address}" \
  AGENT_GATEWAY_SERVICE_TOKEN=local-agent-runtime-token \
  "$smoke_tmp_dir/agent-runtime" >"$smoke_tmp_dir/agent-runtime.log" 2>&1 &
runtime_pid=$!
wait_for_http "${runtime_address}/health/ready"

TEMPORAL_ADDRESS="$temporal_address" \
TEMPORAL_NAMESPACE=encois \
TEMPORAL_TASK_QUEUE=encois-agent-runtime \
AGENT_GATEWAY_SERVICE_TOKEN=local-agent-runtime-token \
AGENT_GATEWAY_POLICY_VERSION=policy-read-only-fixture-v1 \
pnpm --filter @encois/api-gateway exec tsx ../../scripts/smoke-release-flow.ts

TEMPORAL_ADDRESS="$temporal_address" \
TEMPORAL_NAMESPACE=encois \
TEMPORAL_TASK_QUEUE=encois-agent-runtime \
AGENT_GATEWAY_SERVICE_TOKEN=local-agent-runtime-token \
AGENT_GATEWAY_POLICY_VERSION=policy-read-only-fixture-v1 \
pnpm --filter @encois/api-gateway exec tsx ../../scripts/smoke-approval-flow.ts
