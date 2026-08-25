#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
readonly ROOT_DIR

GO_MODULES=(
  "packages/contracts"
  "apps/agent-gateway"
  "apps/agent-runtime"
)

for module in "${GO_MODULES[@]}"; do
  module_dir="$ROOT_DIR/$module"
  printf 'gofmt %s\n' "$module"
  (
    cd "$module_dir"
    find . -type f -name '*.go' -not -path './vendor/*' -exec gofmt -w {} +
  )
done
