#!/usr/bin/env bash
set -euo pipefail

declare -a FILES_TO_STAGE=()

while IFS= read -r -d '' file; do
  case "$file" in
    apps/api-gateway/*|apps/dashboard/*|apps/e2e/*|packages/contracts/*|packages/database/*)
      case "$file" in
        *.ts|*.tsx|*.mts|*.cts) FILES_TO_STAGE+=("$file") ;;
      esac
      ;;
    packages/contracts/*.go|packages/contracts/**/*.go|apps/agent-gateway/*.go|apps/agent-gateway/**/*.go|apps/agent-runtime/*.go|apps/agent-runtime/**/*.go)
      FILES_TO_STAGE+=("$file")
      ;;
  esac
done < <(git diff --cached --name-only --diff-filter=ACMR -z)

if ((${#FILES_TO_STAGE[@]} > 0)); then
  printf 'Staging %d formatted files...\n' "${#FILES_TO_STAGE[@]}"
  git add -- "${FILES_TO_STAGE[@]}"
fi
