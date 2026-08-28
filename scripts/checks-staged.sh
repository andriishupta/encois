#!/usr/bin/env bash
set -u

ROOT_DIR="$(git rev-parse --show-toplevel)"
readonly ROOT_DIR
cd "$ROOT_DIR"

TS_PATHS=(
  "apps/api-gateway"
  "apps/dashboard"
  "apps/e2e"
  "packages/contracts"
  "packages/database"
)

TS_PACKAGES=(
  "@encois/api-gateway"
  "@encois/dashboard"
  "@encois/e2e"
  "@encois/contracts"
  "@encois/database"
)

GO_PATHS=(
  "packages/contracts"
  "apps/agent-gateway"
  "apps/agent-runtime"
)

declare -a PIDS=()
declare -a LABELS=()

has_staged_path() {
  local path="$1"
  if git diff --cached --quiet --diff-filter=ACMR -- "$path"; then
    return 1
  fi
  return 0
}

start_check() {
  local label="$1"
  shift
  printf 'Starting %s...\n' "$label"
  "$@" &
  PIDS+=("$!")
  LABELS+=("$label")
}

checks_started=0

for index in "${!TS_PATHS[@]}"; do
  path="${TS_PATHS[$index]}"
  if has_staged_path "$path"; then
    start_check "TypeScript ${path}" pnpm --filter "${TS_PACKAGES[$index]}" lint
    checks_started=1
  fi
done

go_check_needed=0
for path in "${GO_PATHS[@]}"; do
  if has_staged_path "$path"; then
    go_check_needed=1
    break
  fi
done

if ((go_check_needed == 1)); then
  start_check "Go review" pnpm go:check -- --staged
  checks_started=1
fi

if ((checks_started == 0)); then
  printf '%s\n' 'No staged application or package files; skipping code review.'
  exit 0
fi

exit_code=0
if ((${#PIDS[@]} > 0)); then
  for index in "${!PIDS[@]}"; do
    if wait "${PIDS[$index]}"; then
      printf '%s passed.\n' "${LABELS[$index]}"
    else
      printf '%s failed.\n' "${LABELS[$index]}" >&2
      exit_code=1
    fi
  done
fi

exit "$exit_code"
