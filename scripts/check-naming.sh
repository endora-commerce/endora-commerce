#!/usr/bin/env bash
# scripts/check-naming.sh — enforces Principle VI of the constitution (naming conventions).
# Phase 2 task T041 wires this into CI; Phase 10 task T244 fills in the full diff-aware variant.
# For now, static checks against the whole tree.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

fail=0

# Allowed singular exceptions for backend module folders (Principle VI).
allowed_singular="^(auth|example)$"

if [ -d backend/src/modules ]; then
  while IFS= read -r -d '' dir; do
    name="$(basename "$dir")"
    # Skip README and other files; only directories have a name we care about.
    [ -d "$dir" ] || continue
    # Accept plural snake_case OR one of the allowed singular exceptions.
    if [[ ! "$name" =~ ^[a-z][a-z0-9_]*$ ]]; then
      red "✗ Invalid backend module folder casing: backend/src/modules/$name (must be snake_case)"
      fail=1
      continue
    fi
    if [[ "$name" =~ $allowed_singular ]]; then
      continue
    fi
    # A very conservative pluralization check: accepts anything ending in 's' or common
    # plural-but-not-trailing-s forms. We cannot do English pluralization perfectly in bash,
    # but this catches the common offenders (`order/` instead of `orders/`).
    if [[ ! "$name" =~ (s|ies|ches|shes|xes|zes)$ ]]; then
      red "✗ Backend module folder looks singular: backend/src/modules/$name (Principle VI requires plural snake_case; exceptions: auth, example)"
      fail=1
    fi
  done < <(find backend/src/modules -mindepth 1 -maxdepth 1 -type d -print0)
fi

# Table-creation SQL inside migrations should use snake_case table and column names.
# This is a heuristic — runs only against the staged migration files when a migration folder exists.
if find backend/src/modules -path '*/migrations/*.ts' 2>/dev/null | grep -q .; then
  if grep -REn --include='*.ts' "createTable\(['\"][A-Z]" backend/src/modules/*/migrations 2>/dev/null; then
    red "✗ Migration references a non-snake_case table name (Principle VI)."
    fail=1
  fi
fi

# API URL paths — must be kebab-case. Heuristic: scan for `/api/v1/<segment>` patterns in backend routes.
if find backend/src/modules -name 'routes.*.ts' 2>/dev/null | grep -q .; then
  if grep -REn --include='routes.*.ts' "['\"]\/api\/v1\/[^'\"/]*[A-Z_]" backend/src/modules 2>/dev/null; then
    red "✗ API URL segment looks non-kebab-case (Principle VI)."
    fail=1
  fi
fi

if [ "$fail" -eq 0 ]; then
  green "✓ Naming conventions OK"
  exit 0
fi
exit 1
