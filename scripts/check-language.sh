#!/usr/bin/env bash
# scripts/check-language.sh — enforces Principle VIII of the constitution
# (English working language).
#
# Constitution v3.0.0 narrows Principle VIII to exactly two scopes:
#   1. Inline comments and docstrings inside source files.
#   2. Every page authored under the `/docs/` Docusaurus site
#      (`docs/docs/**/*.{md,mdx}`).
#
# Identifiers, file/folder names, DB tables and columns, API field names,
# URL path segments, string literals (including localised user copy,
# logs, error codes, route definitions, migration SQL), specs, plans,
# tasks, the root README, governance docs, commit messages, and PR
# prose are NOT constrained by this principle and are not scanned.
#
# Source-comment scope is a per-language heuristic: for each in-scope
# file extension we grep for lines that contain a comment marker (`//`,
# `/* … */`, `*` continuation, `<!-- … -->`, `#` for shell) AND a Polish
# diacritic on the same line. The heuristic is tolerant of pathological
# multi-line block comments that contain a diacritic on a line with no
# marker, but it never falsely flags plain string literals or
# identifiers — those have no comment marker.
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

# Polish diacritics + the common other-language diacritics that may slip
# into source-code comments or `/docs/` pages by accident. Proper-noun
# carve-out (Comarch Optima, enova365, …) is ASCII-only, so flagging any
# of these is correct.
pattern='[ąĄćĆęĘłŁńŃóÓśŚźŹżŻ]'

# Build-artifact + tooling exclusions. Migrations/seeds/locales are NOT
# excluded any more — under v3.0.0 their string literals are out of
# scope automatically (no comment marker) and their comments MUST still
# be English like every other source file.
exceptions=(
  ':(exclude)node_modules/**'
  ':(exclude).pnpm-store/**'
  ':(exclude).git/**'
  ':(exclude)dist/**'
  ':(exclude)build/**'
  ':(exclude).next/**'
  ':(exclude).docusaurus/**'
  ':(exclude)scripts/check-language.sh'
)

# Source-code extensions in scope for the comment scan.
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
    if [[ "$f" == $glob || "$f" == */$glob ]]; then
      tracked+=("$f")
      break
    fi
  done
done

# Per-extension comment-line regex. Each pattern matches only lines that
# carry a comment marker AND contain a diacritic, so plain string
# literals and identifiers are silently ignored.
#   .ts/.tsx/.js/.jsx/.cjs/.mjs/.cts/.mts/.css/.scss:
#       `// …` (line or trailing), `/* …`, ` * …` (JSDoc/TSDoc continuation)
#   .html:
#       `<!-- …` and `… -->`
#   .sh:
#       `# …` (excluding the `#!` shebang on the very first line)
comment_pattern_for() {
  case "$1" in
    *.ts|*.tsx|*.cts|*.mts|*.js|*.jsx|*.cjs|*.mjs|*.css|*.scss)
      printf '%s' '(//|/\*|^\s*\*(?!/))[^\n]*'"$pattern"
      ;;
    *.html)
      printf '%s' '(<!--[^\n]*'"$pattern"'|'"$pattern"'[^\n]*-->)'
      ;;
    *.sh)
      printf '%s' '^\s*#(?!!)[^\n]*'"$pattern"
      ;;
    *)
      printf ''
      ;;
  esac
}

fail=0

if [ "${#tracked[@]}" -gt 0 ]; then
  for f in "${tracked[@]}"; do
    [ -f "$f" ] || continue
    if file -b --mime "$f" 2>/dev/null | grep -q 'charset=binary'; then
      continue
    fi
    cp="$(comment_pattern_for "$f")"
    [ -z "$cp" ] && continue
    if LC_ALL=C.UTF-8 grep -nP "$cp" "$f" >/dev/null 2>&1; then
      red "✗ Non-English comment in source file $f:"
      LC_ALL=C.UTF-8 grep -nP "$cp" "$f" | sed 's/^/    /'
      fail=1
    fi
  done
fi

# --- Docs-site scope ------------------------------------------------------
# Scan docs/docs/**/*.{md,mdx} for the same diacritic regex. Specs and
# other project markdown stay out of scope.

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
  green "✓ Working language OK ($mode mode) — source-code comments + /docs/ (Principle VIII v3.0.0)"
  exit 0
fi
exit 1
