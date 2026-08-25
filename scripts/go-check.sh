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

for module in "${GO_MODULES[@]}"; do
  module_dir="$ROOT_DIR/$module"
  printf 'Go checks %s\n' "$module"
  (
    cd "$module_dir"
    if [[ "$STAGED_ONLY" == true ]]; then
      unformatted=""
      while IFS= read -r -d '' file; do
        case "$file" in
          "$module"/*.go|"$module"/**/*.go)
            if [[ -f "$ROOT_DIR/$file" ]]; then
              file_unformatted="$(gofmt -l "$ROOT_DIR/$file")"
              if [[ -n "$file_unformatted" ]]; then
                unformatted+="${file_unformatted}"$'\n'
              fi
            fi
            ;;
        esac
      done < <(git -C "$ROOT_DIR" diff --cached --name-only --diff-filter=ACMR -z -- "$module")
    else
      unformatted="$(find . -type f -name '*.go' -not -path './vendor/*' -exec gofmt -l {} +)"
    fi
    if [[ -n "$unformatted" ]]; then
      printf 'Unformatted Go files in %s:\n%s\n' "$module" "$unformatted" >&2
      exit 1
    fi
    go vet ./...
    go test ./...
  )
done
