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
# diacritic on the same line.
#
# CITED TERMS ARE NOT PROSE. An English comment or doc page routinely has
# to quote Polish data — a UI label, a currency rendering, an expected
# test string, a product name. Principle VIII constrains the prose, not
# the citation, so before testing a line we blank out:
#   * fenced code blocks and inline `code` spans;
#   * double-quoted "…" and typographic „…" / “…” segments;
#   * markdown emphasis (*…*, **…**, _…_) — docs only, the conventional
#     way to set a foreign-language term in English prose;
#   * the Polish proper nouns listed in `proper_nouns` below.
# Whatever survives is genuine prose, and a diacritic there is a real
# violation. Cite the term (backticks, quotes, or emphasis in docs) and
# the line passes.
#
# A file that is intrinsically bilingual — the EN→PL translation
# glossary is the only current case — opts out with the marker
#   check-language: allow-non-english
# on any line, followed by the reason. Use it sparingly; prefer citing.
#
# Modes:
#   --diff   scan only files changed against $BASE_REF (defaults to origin/master).
#   (none)   full-tree scan over every tracked file in scope.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/lib/read-size.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/read-size.sh"

# Where the expected population comes from in full mode (issue #244).
manifest_index="backend/src/modules/_lifecycle/manifest-index.generated.ts"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

mode="full"
if [[ "${1:-}" == "--diff" ]]; then
  mode="diff"
fi

base_ref="${BASE_REF:-origin/master}"

# The file list comes from git, and the prose filter needs perl. Without either,
# the loops below simply find nothing and the script exits 0 having checked
# NOTHING — a false green is worse than no check, so bail loudly instead.
if ! command -v git >/dev/null 2>&1 || ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  red "✗ check-language needs git and a git work tree (the file list comes from git ls-files)."
  exit 2
fi
if ! command -v perl >/dev/null 2>&1; then
  red "✗ check-language needs perl (it blanks cited terms before testing the prose)."
  exit 2
fi

# Polish diacritics + the common other-language diacritics that may slip
# into source-code comments or `/docs/` pages by accident.
pattern='[ąĄćĆęĘłŁńŃóÓśŚźŹżŻ]'

# Polish proper nouns that stay Polish in English prose: state
# institutions, official registries, and the Polish names of shipped
# features. There is no English form of these — translating them would
# make the comment wrong, not more English. Keep the list short; a UI
# label or a sample value is a citation, not a proper noun, and belongs
# in backticks instead.
proper_nouns=(
  'Ministerstwo Finansów'      # the Polish ministry of finance (VAT whitelist source)
  'Biała lista'                # "Biała lista podatników VAT" — the official registry
  'Metoda Płatności'           # feature 034
  'Szybkie Zamówienia'         # feature 039
)

# The opt-out marker for intrinsically bilingual files.
optout_marker='check-language: allow-non-english'

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

# ──────────────────────────────────────────────────────────────────────────
# Citation blanking. Reads a file on stdin, writes it back with every
# cited segment replaced by a space, one output line per input line so
# grep -n still reports the file's real line numbers.
#   $1 — "docs" or "source"
#   $@ — the proper-noun list
# ──────────────────────────────────────────────────────────────────────────
strip_citations() {
  perl -CSDA -e '
    my $kind  = shift @ARGV;
    my @nouns = @ARGV;
    my $fenced = 0;
    while (my $line = <STDIN>) {
      # Fenced code blocks (docs only) are data wholesale.
      if ($kind eq "docs" && $line =~ /^\s*(?:```|~~~)/) {
        $fenced = !$fenced;
        print "\n";
        next;
      }
      if ($fenced) { print "\n"; next; }

      $line =~ s/\Q$_\E/ /g for @nouns;
      $line =~ s/`[^`\n]*`/ /g;                                   # inline code
      $line =~ s/"[^"\n]*"/ /g;                                   # "…"
      $line =~ s/\x{201E}[^\x{201C}\x{201D}\n]*[\x{201C}\x{201D}]/ /g;  # „…" / „…"
      $line =~ s/\x{201C}[^\x{201D}\n]*\x{201D}/ /g;              # “…”

      if ($kind eq "docs") {
        $line =~ s/\*\*[^*\n]+\*\*/ /g;                           # **bold**
        $line =~ s/\*[^*\n]+\*/ /g;                               # *italic*
        # _emphasis_, but never a snake_case identifier: require the
        # delimiters to sit on a word boundary.
        $line =~ s/(?<![\w`])_[^_\n]+_(?![\w`])/ /g;
      }
      print $line;
    }
  ' -- "$@"
}

# Reports every line of $1 whose *prose* matches the grep -P pattern $2.
# Returns 0 when the file is clean, 1 when it is not.
report_violations() {
  local file="$1" kind="$2" line_pattern="$3" label="$4"
  local -a hits

  if grep -qF "$optout_marker" "$file" 2>/dev/null; then
    return 0
  fi

  mapfile -t hits < <(
    strip_citations "$kind" "${proper_nouns[@]}" < "$file" \
      | LC_ALL=C.UTF-8 grep -nP "$line_pattern" 2>/dev/null \
      | cut -d: -f1 || true
  )

  [ "${#hits[@]}" -gt 0 ] || return 0

  red "✗ $label $file:"
  for n in "${hits[@]}"; do
    printf '    %s:%s\n' "$n" "$(sed -n "${n}p" "$file")"
  done
  return 1
}

# Which listing is actually in use. `--diff` degrades to a full scan when the
# base ref is not fetched (GitLab clones shallow), and the two answer the
# "is an empty list legitimate?" question differently — see the guards below.
if [[ "$mode" == "diff" ]] && git rev-parse --verify --quiet "$base_ref" >/dev/null; then
  listing="diff"
else
  listing="full"
fi

if [[ "$listing" == "diff" ]]; then
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
    report_violations "$f" source "$cp" "Non-English comment in source file" || fail=1
  done
fi

# --- Docs-site scope ------------------------------------------------------
# Scan docs/docs/**/*.{md,mdx} for the same diacritic regex. Specs and
# other project markdown stay out of scope.

docs_globs=(
  'docs/docs/**/*.md'
  'docs/docs/**/*.mdx'
)

if [[ "$listing" == "diff" ]]; then
  mapfile -t docs_files < <(
    git diff --name-only --diff-filter=ACMR "$base_ref"...HEAD -- "${docs_globs[@]}" 2>/dev/null || true
  )
else
  mapfile -t docs_files < <(
    git ls-files --cached --others --exclude-standard -- "${docs_globs[@]}" 2>/dev/null || true
  )
fi

# In full-tree mode both lists are the whole repository's worth of files, so an
# empty one means the listing broke (a moved root, a glob that stopped matching,
# a `git ls-files` that answered nothing) and every file went unread. In --diff
# mode an empty list is the ordinary "this MR touched none of them".
if [[ "$listing" == "full" ]] && { [ "${#tracked[@]}" -eq 0 ] || [ "${#docs_files[@]}" -eq 0 ]; }; then
  red "✗ check-language listed no source files (${#tracked[@]}) or no docs pages (${#docs_files[@]}) — refusing to report a vacuous pass."
  exit 2
fi

# What was read, beside what was found (issue #244). `files` is both lists —
# the in-scope source files and the docs pages — because the two scans are one
# run and a green tick covers both. In full mode the source list is corroborated
# against the generated manifest index: every registered module must contribute
# at least one file, which is #215's predicate and strictly stronger than the
# emptiness test above. In --diff mode the population is the merge request, so
# there is no expectation to derive.
if [[ "$listing" == "full" ]]; then
  if ! language_coverage="$(printf '%s\n' "${tracked[@]}" \
    | read_size_module_coverage "$manifest_index")"; then
    red "✗ check-language could not read the manifest index at $manifest_index — the"
    red "  expected population is derived from it. Refusing to report a vacuous pass."
    exit 2
  fi
  read_size_report '[language]' "$(( ${#tracked[@]} + ${#docs_files[@]} ))" - \
    "manifest-index:$language_coverage"
else
  # A --diff run's population is the merge request, so there is nothing to
  # derive an expectation from and an empty one is the ordinary "this merge
  # request touched nothing in scope" — the line is printed, the zero is not
  # refused.
  read_size_line '[language]' "$(( ${#tracked[@]} + ${#docs_files[@]} ))" - self-reported
fi

if [ "${#docs_files[@]}" -gt 0 ]; then
  for f in "${docs_files[@]}"; do
    [ -f "$f" ] || continue
    report_violations "$f" docs "$pattern" "Non-English characters in docs file" || fail=1
  done
fi

if [ "$fail" -eq 0 ]; then
  green "✓ Working language OK ($mode mode) — source-code comments + /docs/ (Principle VIII v3.0.0)"
  exit 0
fi
exit 1
