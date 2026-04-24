#!/usr/bin/env bash
# scripts/check-language.sh — enforces Principle VIII of the constitution (English working language).
#
# Scans the repository (excluding specs/ and the i18n translation catalogs under storefront/ that
# are explicitly allowed to contain other languages) for characters that only appear in non-English
# alphabets. Polish diacritics are the most likely contaminant in this project.
#
# Phase 2 task T042 wires this into CI; Phase 10 task T245 upgrades it to scan only the PR diff.
# For now, full-tree scan so the initial scaffolding stays clean.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

# Where non-English content is permitted per Principle VIII "scope exception — end-customer content":
# - storefront/public/locales/** — i18n translation catalogs (when they exist)
# - storefront/messages/** — alternative i18n layout
# - backend/src/modules/*/email-templates/locales/** — localized email copy
# - specs/** — the feature 001 Polish draft is in history; the English commit overwrote the content
#   but ships alongside archival specs in future features. We skip specs/ entirely.
# - node_modules/, .pnpm-store/, .git/, dist/, build/, .next/, .docusaurus/ — vendor/build output

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
  ':(exclude)scripts/check-language.sh'
  ':(exclude)pnpm-lock.yaml'
  ':(exclude)package-lock.json'
)

# Use git to resolve the file list honoring .gitignore.
mapfile -t tracked < <(git ls-files --cached --others --exclude-standard -- "${exceptions[@]}" 2>/dev/null || true)

if [ "${#tracked[@]}" -eq 0 ]; then
  green "✓ Nothing to scan (empty working tree or git unavailable)"
  exit 0
fi

# Polish diacritics + a handful of other-language diacritics we may see in third-party proper nouns.
# Proper-noun exceptions (Principle VIII) — e.g. "Comarch Optima", "Subiekt GT", "enova365",
# "Symfonia" — are ASCII-only, so simple Unicode scanning is safe.
pattern='[ąĄćĆęĘłŁńŃóÓśŚźŹżŻ]'

fail=0
for f in "${tracked[@]}"; do
  [ -f "$f" ] || continue
  # Skip binary files.
  if file -b --mime "$f" 2>/dev/null | grep -q 'charset=binary'; then
    continue
  fi
  if LC_ALL=C.UTF-8 grep -nP "$pattern" "$f" >/dev/null 2>&1; then
    red "✗ Non-English characters in $f:"
    LC_ALL=C.UTF-8 grep -nP "$pattern" "$f" | sed 's/^/    /'
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  green "✓ Working language OK — no stray non-English characters"
  exit 0
fi
exit 1
