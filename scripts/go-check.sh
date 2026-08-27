#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
readonly ROOT_DIR

GO_MODULES=(
  "packages/contracts"
  "apps/agent-gateway"
  "apps/agent-runtime"
)

STAGED_ONLY=false
for argument in "$@"; do
  if [[ "$argument" == "--staged" ]]; then
    STAGED_ONLY=true
    break
  fi
done

declare -a CHECK_MODULES=()

if [[ "$STAGED_ONLY" == true ]]; then
  while IFS= read -r -d '' file; do
    for module in "${GO_MODULES[@]}"; do
      case "$file" in
        "$module"/*)
          CHECK_MODULES+=("$module")
          break
          ;;
      esac
    done
  done < <(git -C "$ROOT_DIR" diff --cached --name-only --diff-filter=ACMR -z -- \
    "packages/contracts" "apps/agent-gateway" "apps/agent-runtime")

  if ((${#CHECK_MODULES[@]} == 0)); then
    printf '%s\n' 'No staged Go files; skipping Go review.'
    exit 0
  fi

  # The Go contracts package is imported by both Go applications.
  for file in "${CHECK_MODULES[@]}"; do
    if [[ "$file" == "packages/contracts" ]]; then
      CHECK_MODULES+=("apps/agent-gateway" "apps/agent-runtime")
      break
    fi
  done
else
  CHECK_MODULES=("${GO_MODULES[@]}")
fi

declare -a UNIQUE_MODULES=()
for module in "${CHECK_MODULES[@]}"; do
  already_added=false
  for existing_module in "${UNIQUE_MODULES[@]}"; do
    if [[ "$existing_module" == "$module" ]]; then
      already_added=true
      break
    fi
  done
  if [[ "$already_added" == false ]]; then
    UNIQUE_MODULES+=("$module")
  fi
done

run_module_checks() {
  local module="$1"
  module_dir="$ROOT_DIR/$module"
  printf 'Go checks %s\n' "$module"
  (
    cd "$module_dir"
    if [[ "$STAGED_ONLY" == false ]]; then
      unformatted="$(find . -type f -name '*.go' -not -path './vendor/*' -exec gofmt -l {} +)"
      if [[ -n "$unformatted" ]]; then
        printf 'Unformatted Go files in %s:\n%s\n' "$module" "$unformatted" >&2
        exit 1
      fi
    fi
    go vet ./...
  )
}

declare -a PIDS=()
for module in "${UNIQUE_MODULES[@]}"; do
  run_module_checks "$module" &
  PIDS+=("$!")
done

exit_code=0
for pid in "${PIDS[@]}"; do
  if ! wait "$pid"; then
    exit_code=1
  fi
done

exit "$exit_code"
