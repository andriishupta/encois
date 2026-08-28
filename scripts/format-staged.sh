#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
readonly ROOT_DIR
cd "$ROOT_DIR"

declare -a TS_FILES=()
declare -a GO_FILES=()

while IFS= read -r -d '' file; do
  case "$file" in
    apps/api-gateway/*|apps/dashboard/*|apps/e2e/*|packages/contracts/*|packages/database/*)
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

if ((${#TS_FILES[@]} > 0)); then
  for file in "${TS_FILES[@]}"; do
    if ! git diff --quiet -- "$file"; then
      printf 'Refusing to format %s because it also has unstaged changes. Stage the file or separate the changes first.\n' "$file" >&2
      exit 1
    fi
  done
fi

if ((${#GO_FILES[@]} > 0)); then
  for file in "${GO_FILES[@]}"; do
    if ! git diff --quiet -- "$file"; then
      printf 'Refusing to format %s because it also has unstaged changes. Stage the file or separate the changes first.\n' "$file" >&2
      exit 1
    fi
  done
fi

format_typescript() {
  if ((${#TS_FILES[@]} == 0)); then return; fi
  printf 'Formatting %d TypeScript files...\n' "${#TS_FILES[@]}"
  pnpm exec biome check --write --config-path "$ROOT_DIR/biome.json" "${TS_FILES[@]}"
}

format_go() {
  if ((${#GO_FILES[@]} == 0)); then return; fi
  printf 'Formatting %d Go files...\n' "${#GO_FILES[@]}"
  gofmt -w "${GO_FILES[@]}"
}

declare -a FORMAT_PIDS=()
if ((${#TS_FILES[@]} > 0)); then
  format_typescript &
  FORMAT_PIDS+=("$!")
fi
if ((${#GO_FILES[@]} > 0)); then
  format_go &
  FORMAT_PIDS+=("$!")
fi

if ((${#FORMAT_PIDS[@]} > 0)); then
  format_exit_code=0
  for index in "${!FORMAT_PIDS[@]}"; do
    if wait "${FORMAT_PIDS[$index]}"; then
      continue
    fi
    format_exit_code=1
    printf 'Formatter %s failed; waiting for the other formatters.\n' "$index" >&2
  done
  if ((format_exit_code != 0)); then
    printf '%s\n' 'Formatting failed. No files were staged.' >&2
    exit "$format_exit_code"
  fi
fi
