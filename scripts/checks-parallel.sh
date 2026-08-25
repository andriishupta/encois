#!/usr/bin/env bash
set -u

declare -a PIDS=()
declare -a LABELS=()

start_check() {
  local label="$1"
  shift
  printf 'Starting %s...\n' "$label"
  "$@" &
  PIDS+=("$!")
  LABELS+=("$label")
}

start_check "Biome" pnpm biome:check
start_check "TypeScript lint/typecheck" pnpm -r lint
start_check "Go checks" pnpm go:check -- --staged

exit_code=0
for index in "${!PIDS[@]}"; do
  if wait "${PIDS[$index]}"; then
    printf '%s passed.\n' "${LABELS[$index]}"
  else
    printf '%s failed.\n' "${LABELS[$index]}" >&2
    exit_code=1
  fi
done

if ((exit_code != 0)); then
  printf '%s\n' 'At least one check failed. No files will be staged.' >&2
fi

exit "$exit_code"
