#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
readonly ROOT_DIR
cd "$ROOT_DIR"

declare -a TS_FILES=()
declare -a GO_FILES=()

while IFS= read -r -d '' file; do
  case "$file" in
    apps/api-gateway/*|apps/dashboard/*|apps/e2e/*|packages/contracts/*|packages/persistence/*)
      case "$file" in
        *.ts|*.tsx|*.mts|*.cts) TS_FILES+=("$file") ;;
      esac
      ;;
  esac

  case "$file" in
    packages/contracts/*.go|packages/contracts/**/*.go|apps/agent-gateway/*.go|apps/agent-gateway/**/*.go|apps/agent-runtime/*.go|apps/agent-runtime/**/*.go)
      GO_FILES+=("$file")
      ;;
  esac
done < <(git diff --cached --name-only --diff-filter=ACMR -z)

for file in "${TS_FILES[@]}" "${GO_FILES[@]}"; do
  if ! git diff --quiet -- "$file"; then
    printf 'Refusing to format %s because it also has unstaged changes. Stage the file or separate the changes first.\n' "$file" >&2
    exit 1
  fi
done

for file in "${TS_FILES[@]}"; do
  printf 'Biome format %s\n' "$file"
  pnpm exec biome check --write --config-path "$ROOT_DIR/biome.json" "$file"
  git add -- "$file"
done

for file in "${GO_FILES[@]}"; do
  printf 'gofmt %s\n' "$file"
  gofmt -w "$file"
  git add -- "$file"
done
