#!/usr/bin/env bash
# scripts/check-language.sh — enforces Principle VIII of the constitution (English working language).
#
# Scans the repository (excluding specs/ and the i18n translation catalogs that are explicitly
# allowed to contain other languages) for characters that only appear in non-English alphabets.
# Polish diacritics are the most likely contaminant in this project.
#
# Modes:
#   --diff   scan only files changed against $BASE_REF (defaults to origin/main),
#            and additionally scan commit-message bodies in BASE_REF..HEAD.
#   (none)   full-tree scan; commit-message scan still applies if BASE_REF is set.

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

# Where non-English content is permitted per Principle VIII "scope exception — end-customer content":
#   - storefront/public/locales/**          — i18n translation catalogs
#   - storefront/messages/**                — alternative i18n layout
#   - backend/src/modules/*/email-templates/locales/**
#   - backend/test/helpers/seed-*.ts        — seed fixtures simulating end-customer
#                                              content (Polish addresses + product i18n)
#   - specs/**                              — feature specs (drafted bilingually,
#                                              archived as-is)
#   - vendor / build outputs
exceptions=(
  ':(exclude)specs/**'
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
  ':(exclude)pnpm-lock.yaml'
  ':(exclude)package-lock.json'
)

if [[ "$mode" == "diff" ]] && git rev-parse --verify --quiet "$base_ref" >/dev/null; then
  mapfile -t tracked < <(
    git diff --name-only --diff-filter=ACMR "$base_ref"...HEAD -- "${exceptions[@]}" 2>/dev/null || true
  )
else
  mapfile -t tracked < <(
    git ls-files --cached --others --exclude-standard -- "${exceptions[@]}" 2>/dev/null || true
  )
fi

# Polish diacritics + the common other-language diacritics we may encounter.
# Proper-noun exceptions (e.g. "Comarch Optima", "enova365") are ASCII-only,
# so flagging *any* of these is correct.
pattern='[ąĄćĆęĘłŁńŃóÓśŚźŹżŻ]'

fail=0

# 1. File contents.
if [ "${#tracked[@]}" -gt 0 ]; then
  for f in "${tracked[@]}"; do
    [ -f "$f" ] || continue
    if file -b --mime "$f" 2>/dev/null | grep -q 'charset=binary'; then
      continue
    fi
    if LC_ALL=C.UTF-8 grep -nP "$pattern" "$f" >/dev/null 2>&1; then
      red "✗ Non-English characters in $f:"
      LC_ALL=C.UTF-8 grep -nP "$pattern" "$f" | sed 's/^/    /'
      fail=1
    fi
  done
fi

# 2. Commit-message bodies of new commits in this PR — only if BASE_REF resolves
#    (works in both --diff invocations and any full-tree run executed with
#    BASE_REF set explicitly).
if git rev-parse --verify --quiet "$base_ref" >/dev/null; then
  mapfile -t commits < <(git log --format=%H "$base_ref..HEAD" 2>/dev/null || true)
  for sha in "${commits[@]}"; do
    msg="$(git log -n 1 --format='%s%n%b' "$sha")"
    if printf '%s' "$msg" | LC_ALL=C.UTF-8 grep -nP "$pattern" >/dev/null 2>&1; then
      red "✗ Non-English characters in commit $sha:"
      printf '%s\n' "$msg" | LC_ALL=C.UTF-8 grep -nP "$pattern" | sed 's/^/    /'
      fail=1
    fi
  done
fi

if [ "$fail" -eq 0 ]; then
  green "✓ Working language OK ($mode mode)"
  exit 0
fi
exit 1
