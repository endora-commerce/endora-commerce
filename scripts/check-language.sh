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
# shellcheck source=scripts/lib/module-root.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/module-root.sh"

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

# Where the expected population comes from in full mode (issue #244), and where
# this run's own source is — **resolved, not spelled**. This script used to
# write `backend/src/modules/_lifecycle/manifest-index.generated.ts` here while
# its sibling `check-naming.sh` resolved the same file (feature 080, T012), so a
# moved module tree left it refusing to run for a layout change it should
# follow. They are one job and one pair of modes; they derive the root the same
# way, and both prune a checkout nested inside this one — see
# `lib/module-root.sh` for why the discriminator is the `.git` entry and what it
# cannot see.
module_root_resolve_nested_checkouts
index_status=0
manifest_index="$(module_root_manifest_index)" || index_status=$?
if [ "$index_status" -ne 0 ]; then
  case "$index_status" in
    2)
      red "✗ check-language found more than one generated manifest index:"
      printf '%s\n' "$manifest_index" | sed 's/^/    /'
      red "  Each names a different module tree, so the expected population would be one"
      red "  tree's while the listing is the repository's. Refusing to guess."
      ;;
    *)
      red "✗ check-language found no generated manifest index in this repository, so it"
      red "  cannot derive the population its listing is reconciled against."
      red "  Refusing to report a vacuous pass."
      ;;
  esac
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
# The prose scan, batched (issue #247).
#
# One perl process reads the whole listing off stdin and reports every
# violating line in it. It used to be six processes *per source file* —
# `file` and `grep` to decide binary, `grep -F` for the opt-out marker, `perl`
# to blank the citations, `grep -P` for what survived, `cut` for the line
# number — plus a `sed` per hit to re-read the raw line, over a listing of
# four thousand. Some twenty-five thousand spawns for 30 MB of text: 48 s
# measured, of which the reading is 0.03 s. `quality:static` paid it on every
# merge request and every push to `master` and nobody was timing it; the read-
# size ratchet (!764) only made it visible. Batched, the same scan is 1.0 s.
#
# The rules are the same rules — the differential proof is byte-for-byte over
# a 46-file carve-out fixture and over this whole tree with the diacritic
# class widened to 19 079 findings — moved inside the one process that was
# already doing the hard part.
#
# The scanner reads:
#   argv — kind ("docs" or "source"), the diacritic class, the opt-out
#          marker, then the proper-noun list;
#   stdin — the file paths, one per line.
# It prints the same report the shell used to and exits 1 when it found
# anything, 0 when it did not.
# ──────────────────────────────────────────────────────────────────────────
prose_scanner='
  my ($kind, $diacritics, $marker, @nouns) = @ARGV;
  # Paths arrive as bytes and are opened as bytes; the prose is decoded per
  # file, so a path is never re-encoded on its way to open().
  binmode(STDIN, ":raw");
  binmode(STDOUT, ":encoding(UTF-8)");

  my $label = $kind eq "docs"
    ? "Non-English characters in docs file"
    : "Non-English comment in source file";

  # Per-extension comment-line regex — the same patterns the shell used to
  # hand to `grep -P`, which is PCRE, so they are perl patterns already. Each
  # matches only a line that carries a comment marker AND a diacritic, so a
  # plain string literal or identifier is silently ignored.
  my $script_like = qr/(?:\/\/|\/\*|^\s*\*(?!\/))[^\n]*$diacritics/;
  my $html_like   = qr/(?:<!--[^\n]*$diacritics|$diacritics[^\n]*-->)/;
  my $shell_like  = qr/^\s*#(?!!)[^\n]*$diacritics/;
  # A docs page is prose throughout, so its pattern is the class itself — which
  # is also the pre-filter below, and the reason the docs scan pays for that
  # filter nothing at all.
  my $has_diacritic = qr/$diacritics/;

  sub pattern_for {
    my ($path) = @_;
    return $has_diacritic if $kind eq "docs";
    return $script_like
      if $path =~ /\.(?:ts|tsx|cts|mts|js|jsx|cjs|mjs|css|scss)$/;
    return $html_like  if $path =~ /\.html$/;
    return $shell_like if $path =~ /\.sh$/;
    return undef;
  }

  my $found = 0;
  while (my $path = <STDIN>) {
    chomp $path;
    next unless length $path;
    next unless -f $path;
    my $re = pattern_for($path);
    next unless defined $re;

    open(my $fh, "<:raw", $path) or next;
    my $raw = do { local $/; <$fh> };
    close $fh;
    next unless defined $raw;

    # A binary file among the source extensions is not prose. This replaces
    # the `file --mime | grep charset=binary` pair, on the byte that made
    # `file` say so; the docs scan never had the test and does not gain one.
    next if $kind ne "docs" && index($raw, "\0") >= 0;
    # The documented opt-out, matched anywhere in the file, on the raw bytes
    # exactly as `grep -qF` matched it.
    next if index($raw, $marker) >= 0;

    # Undecodable bytes are not UTF-8 prose, and the diacritic class cannot
    # match them: `grep -P` under LC_ALL=C.UTF-8 found nothing in such a file
    # either, so skipping it keeps the old answer.
    my $text = $raw;
    next unless utf8::decode($text);

    # Every pattern below ends in the diacritic class, and the blanking only
    # ever *removes* text — so a file, and later a line, that holds no
    # diacritic at all cannot produce a hit whatever else it contains. Asking
    # once per file is what keeps the scan off the 99% of this tree that is
    # plain ASCII; without it the substitutions alone run several million
    # times and cost ten seconds.
    next unless $text =~ $has_diacritic;

    # Split on the line terminator rather than opening an in-memory file
    # handle. Perl refuses to map a string holding a code point above 0xFF
    # into one, and the diacritics this check looks for are mostly above it:
    # `\N{U+0142}` is 0x142. A handle would fail to open on exactly the files
    # worth reading, and skipping them would look like a clean tree — the
    # differential run against the previous implementation caught it.
    my $lineno = 0;
    my $fenced = 0;
    my @hits;
    for my $line (split /(?<=\n)/, $text) {
      $lineno++;
      # The reported text is the raw line, terminator stripped and nothing
      # else — `sed -n "${n}p"` did exactly this, a CR on a CRLF line
      # included, and the differential proof is byte-for-byte.
      my $original = $line;
      $original =~ s/\n\z//;

      # Fenced code blocks (docs only) are data wholesale.
      if ($kind eq "docs" && $line =~ /^\s*(?:```|~~~)/) {
        $fenced = !$fenced;
        next;
      }
      next if $fenced;
      # The per-line half of the same argument. It has to sit *after* the fence
      # toggle, which every line has to be offered, and before the blanking,
      # which is the expensive part.
      next unless $line =~ $has_diacritic;

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

      push @hits, [$lineno, $original] if $line =~ $re;
    }

    next unless @hits;
    $found = 1;
    print "\033[31m\x{2717} $label $path:\033[0m\n";
    printf("    %s:%s\n", $_->[0], $_->[1]) for @hits;
  }
  exit($found ? 1 : 0);
'

# Runs the scanner over a file list. $1 is the kind, the rest are the paths.
# Returns 0 when every one of them is clean, 1 when any is not.
scan_prose() {
  local kind="$1"
  shift
  [ "$#" -gt 0 ] || return 0
  printf '%s\n' "$@" \
    | perl -CA -e "$prose_scanner" -- "$kind" "$pattern" "$optout_marker" "${proper_nouns[@]}"
}

# Which listing is actually in use. `--diff` degrades to a full scan when the
# base ref is not fetched (GitLab clones shallow), and the two answer the
# "is an empty list legitimate?" question differently — see the guards below.
if [[ "$mode" == "diff" ]] && git rev-parse --verify --quiet "$base_ref" >/dev/null; then
  listing="diff"
else
  listing="full"
fi

# A nested checkout's sources are another commit's, and a finding in one is
# reported against a path no merge request on this branch can change. `git
# ls-files --others` answers for a nested work tree with a single directory
# entry while its gitfile resolves, and file by file once the gitdir has been
# swept — so this filter is the difference between a few phantom entries in the
# count and a whole second tree scanned as if it were ours. It reads as
# unnecessary on the machine it was written on, where an untracked
# `.git/info/exclude` rule already hides `.claude/worktrees`; that rule is
# local, no clone carries it, and it covers one path name rather than the
# property.
if [[ "$listing" == "diff" ]]; then
  mapfile -t candidate_files < <(
    git diff --name-only --diff-filter=ACMR "$base_ref"...HEAD -- "${exceptions[@]}" 2>/dev/null \
      | module_root_drop_nested_checkouts || true
  )
else
  mapfile -t candidate_files < <(
    git ls-files --cached --others --exclude-standard -- "${exceptions[@]}" 2>/dev/null \
      | module_root_drop_nested_checkouts || true
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

fail=0

if [ "${#tracked[@]}" -gt 0 ]; then
  scan_prose source "${tracked[@]}" || fail=1
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
    git diff --name-only --diff-filter=ACMR "$base_ref"...HEAD -- "${docs_globs[@]}" 2>/dev/null \
      | module_root_drop_nested_checkouts || true
  )
else
  mapfile -t docs_files < <(
    git ls-files --cached --others --exclude-standard -- "${docs_globs[@]}" 2>/dev/null \
      | module_root_drop_nested_checkouts || true
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
  scan_prose docs "${docs_files[@]}" || fail=1
fi

if [ "$fail" -eq 0 ]; then
  green "✓ Working language OK ($mode mode) — source-code comments + /docs/ (Principle VIII v3.0.0)"
  exit 0
fi
exit 1
