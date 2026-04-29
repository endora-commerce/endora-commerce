#!/usr/bin/env bash
# scripts/check-language.sh — enforces Principle VIII of the constitution
# (English working language).
#
# Constitution v2.0.0 narrowed Principle VIII: only **source code**
# (in-code identifiers + inline comments + non-user-facing string literals)
# must be English. Specs, plans, governance documents, commit messages,
# and PR descriptions MAY be in any language.
#
# Constitution v2.1.0 carved out a separate rule for the documentation
# site: every page under `docs/docs/**/*.md` MUST be in English so the
# generated docs read consistently regardless of the contributor's
# native language. This script enforces both scopes.
#
# Scanned file extensions (source-code scope, Polish-diacritics regex):
#   .ts .tsx .js .jsx .cjs .mjs .cts .mts   — TypeScript / JavaScript
#   .css .scss                              — stylesheets
#   .html                                   — HTML templates
#   .sh                                     — shell scripts
# Everything else (YAML, JSON, SQL, Dockerfile, plain text, images,
# lockfiles, ...) is OUT OF SCOPE for the source-code rule.
#
# Docs-site scope (Constitution v2.1.0, T154):
#   docs/docs/**/*.md and docs/docs/**/*.mdx — same Polish-diacritics
#   regex; documentation MUST be English. Spec markdown
#   (specs/**/*.md), READMEs, and other project markdown stay
#   out-of-scope per v2.0.0.
#
# Modes:
#   --diff   scan only files changed against $BASE_REF (defaults to origin/master).
#   (none)   full-tree scan over every tracked file in scope.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

mode="full"
if [[ "${1:-}" == "--diff" ]]; then
  mode="diff"
fi

base_ref="${BASE_REF:-origin/master}"

# Where source files MAY contain non-English content per Principle VIII's
# end-customer-content carve-out:
#   - storefront/public/locales/**           — i18n catalogs
#   - storefront/messages/**                 — alternative i18n layout
#   - backend/src/modules/*/email-templates/locales/**
#   - backend/test/helpers/seed-*.ts         — fixtures simulating customer
#                                               content (Polish addresses, etc.)
#   - backend/src/modules/*/migrations/**    — shipped seed rows often
#                                               include pl-PL multilingual
#                                               labels for customer-facing
#                                               content (jsonb name/description)
#   - backend/src/modules/*/seeds/**         — dev seed scripts for the same
#                                               reason
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
  ':(exclude)backend/src/modules/*/migrations/**'
  ':(exclude)backend/src/modules/*/seeds/**'
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

# --- Docs-site scope (Constitution v2.1.0, T154) ---------------------------
# Scan docs/docs/**/*.{md,mdx} for the same Polish diacritics. Specs and
# other project markdown stay out-of-scope.

docs_globs=(
  'docs/docs/**/*.md'
  'docs/docs/**/*.mdx'
)

if [[ "$mode" == "diff" ]] && git rev-parse --verify --quiet "$base_ref" >/dev/null; then
  mapfile -t docs_files < <(
    git diff --name-only --diff-filter=ACMR "$base_ref"...HEAD -- "${docs_globs[@]}" 2>/dev/null || true
  )
else
  mapfile -t docs_files < <(
    git ls-files --cached --others --exclude-standard -- "${docs_globs[@]}" 2>/dev/null || true
  )
fi

if [ "${#docs_files[@]}" -gt 0 ]; then
  for f in "${docs_files[@]}"; do
    [ -f "$f" ] || continue
    if LC_ALL=C.UTF-8 grep -nP "$pattern" "$f" >/dev/null 2>&1; then
      red "✗ Non-English characters in docs file $f:"
      LC_ALL=C.UTF-8 grep -nP "$pattern" "$f" | sed 's/^/    /'
      fail=1
    fi
  done
fi

if [ "$fail" -eq 0 ]; then
  green "✓ Working language OK ($mode mode) — source-code (Principle VIII v2.0.0) + /docs/ (v2.1.0)"
  exit 0
fi
exit 1
