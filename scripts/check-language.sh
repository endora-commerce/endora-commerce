#!/usr/bin/env bash
# scripts/check-language.sh — enforces Principle VIII of the constitution
# (English working language).
#
# Constitution v2.0.0 narrowed Principle VIII: only **source code**
# (in-code identifiers + inline comments + non-user-facing string literals)
# must be English. Documentation, planning artifacts, governance documents,
# commit messages, PR descriptions, and code-review comments MAY be in any
# language. This script reflects that scope.
#
# Scanned file extensions:
#   .ts .tsx .js .jsx .cjs .mjs .cts .mts   — TypeScript / JavaScript
#   .css .scss                              — stylesheets
#   .html                                   — HTML templates
#   .sh                                     — shell scripts
# Everything else (Markdown, YAML, JSON, SQL, Dockerfile, plain text,
# images, lockfiles, …) is OUT OF SCOPE.
#
# Modes:
#   --diff   scan only files changed against $BASE_REF (defaults to origin/main).
#   (none)   full-tree scan over every tracked source file.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

mode="full"
if [[ "${1:-}" == "--diff" ]]; then
  mode="diff"
fi

base_ref="${BASE_REF:-origin/main}"

# Where source files MAY contain non-English content per Principle VIII's
# end-customer-content carve-out:
#   - storefront/public/locales/**           — i18n catalogs
#   - storefront/messages/**                 — alternative i18n layout
#   - backend/src/modules/*/email-templates/locales/**
#   - backend/test/helpers/seed-*.ts         — fixtures simulating customer
#                                               content (Polish addresses, etc.)
exceptions=(
  ':(exclude)node_modules/**'
  ':(exclude).pnpm-store/**'
  ':(exclude).git/**'
  ':(exclude)dist/**'
  ':(exclude)build/**'
  ':(exclude).next/**'
  ':(exclude).docusaurus/**'
  ':(exclude)storefront/public/locales/**'
  ':(exclude)storefront/messages/**'
  ':(exclude)backend/src/modules/*/email-templates/locales/**'
  ':(exclude)backend/test/helpers/seed-*.ts'
  ':(exclude)scripts/check-language.sh'
)

# Source-code extensions in scope per the v2.0.0 principle.
include_globs=(
  '*.ts' '*.tsx' '*.cts' '*.mts'
  '*.js' '*.jsx' '*.cjs' '*.mjs'
  '*.css' '*.scss'
  '*.html'
  '*.sh'
)

if [[ "$mode" == "diff" ]] && git rev-parse --verify --quiet "$base_ref" >/dev/null; then
  mapfile -t candidate_files < <(
    git diff --name-only --diff-filter=ACMR "$base_ref"...HEAD -- "${exceptions[@]}" 2>/dev/null || true
  )
else
  mapfile -t candidate_files < <(
    git ls-files --cached --others --exclude-standard -- "${exceptions[@]}" 2>/dev/null || true
  )
fi

# Filter to in-scope source-code extensions only.
tracked=()
for f in "${candidate_files[@]}"; do
  for glob in "${include_globs[@]}"; do
    # Bash glob match against the trailing path segment.
    if [[ "$f" == $glob || "$f" == */$glob ]]; then
      tracked+=("$f")
      break
    fi
  done
done

# Polish diacritics + the common other-language diacritics that may slip
# into source code by accident. Proper-noun carve-out (Comarch Optima,
# enova365, …) is ASCII-only, so flagging any of these is correct.
pattern='[ąĄćĆęĘłŁńŃóÓśŚźŹżŻ]'

fail=0

if [ "${#tracked[@]}" -gt 0 ]; then
  for f in "${tracked[@]}"; do
    [ -f "$f" ] || continue
    if file -b --mime "$f" 2>/dev/null | grep -q 'charset=binary'; then
      continue
    fi
    if LC_ALL=C.UTF-8 grep -nP "$pattern" "$f" >/dev/null 2>&1; then
      red "✗ Non-English characters in source file $f:"
      LC_ALL=C.UTF-8 grep -nP "$pattern" "$f" | sed 's/^/    /'
      fail=1
    fi
  done
fi

if [ "$fail" -eq 0 ]; then
  green "✓ Working language OK ($mode mode) — source-code scope only per Constitution Principle VIII v2.0.0"
  exit 0
fi
exit 1
