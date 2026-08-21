#!/usr/bin/env bash
# The shell half of "what did this check actually read?" (issue #244).
#
# `backend/scripts/lib/read-size.ts` is the same function for the twenty-four
# tsx checks; this is the two-and-a-bit shell ones, which run in
# `quality:static` with only bash, grep, perl and POSIX awk available. The two
# print the **same grammar**, because the ratchet in
# `backend/test/unit/scripts/check-read-size.test.ts` parses one shape:
#
#   [naming] read: files=3218 sources=manifest-index:65/65
#   [pdfmake-gate] read: files=126 sources=self-reported
#
# See the TypeScript header for why the input size is printed at all. The short
# version: a check's output says what it found and never says what it read, so
# "found nothing" and "read nothing" are the same green — seven times now.
#
# Source it, do not execute it:
#   source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/read-size.sh"

# The module ids the generated manifest index registers, one per line.
#
# The index is a TypeScript file and this is a shell script, so the read is a
# regex over the import lines rather than a load — the ids are the directory
# segment of each `../<id>/manifest.js` specifier, which is the one thing the
# generator cannot emit differently without every module's manifest moving.
# Returns 1 when the file is not there, which its caller turns into exit 2: an
# expectation derived from a missing file is not an expectation.
read_size_registered_modules() {
  local index="$1"
  [ -f "$index" ] || return 1
  perl -ne "print \"\$1\n\" if m{from '\\.\\./([A-Za-z0-9_]+)/manifest\\.js'}" "$index" \
    | sort -u
}

# `covered/expected` for a file list on stdin, against the manifest index.
#
# Expected is every registered module; covered is those the listing produced at
# least one file for. This is #215's predicate: a walk that comes back *short*
# — the module tree half-moved, a glob that stopped matching one subtree — is
# invisible to an emptiness test and visible to this one, without anybody
# choosing a number.
#
# The module root is the index's own grandparent rather than a path written here
# (feature 080, T012): the index lives inside the module tree, so one resolution
# answers both halves and a tree that moves takes the expectation with it. The
# id is matched with POSIX awk's `index()`, which is literal — a `grep -E`
# pattern built from a path would need the caller's separators escaped, and the
# one that got away would match more than it was asked to.
read_size_module_coverage() {
  local index="$1"
  local ids expected covered modules_root
  ids="$(read_size_registered_modules "$index")" || return 1
  modules_root="$(dirname "$(dirname "$index")")"
  # The listing is repository-relative (`git ls-files` emits nothing else), so
  # an index given as an absolute path has to lose the working directory or the
  # two never meet. Both callers `cd` to the repository root first.
  modules_root="${modules_root#"$PWD"/}"
  modules_root="${modules_root#./}"
  expected=$(printf '%s\n' "$ids" | grep -c '[^[:space:]]' || true)
  covered=$(
    awk -v root="$modules_root/" '
      {
        at = index($0, root)
        if (at == 0) next
        rest = substr($0, at + length(root))
        slash = index(rest, "/")
        if (slash > 1) print substr(rest, 1, slash - 1)
      }
    ' \
      | sort -u \
      | grep -Fx -f <(printf '%s\n' "$ids") \
      | grep -c '[^[:space:]]' || true
  )
  printf '%s/%s' "$covered" "$expected"
}

# Print the read line and nothing else — no refusal.
#
# For the one population that is legitimately allowed to be empty: a `--diff`
# run whose merge request touched nothing in scope. Zero there is an answer, not
# a broken listing, and the scripts' own guards already say so; refusing it
# would make a no-op merge request fail the pipeline. Full mode goes through
# `read_size_report`, where zero means the listing broke.
read_size_line() {
  local prefix="$1" files="$2" sites="$3" sources="$4"
  if [ "$sites" = "-" ]; then
    printf '%s read: files=%s sources=%s\n' "$prefix" "$files" "$sources"
  else
    printf '%s read: files=%s sites=%s sources=%s\n' "$prefix" "$files" "$sites" "$sources"
  fi
}

# Print the read line, or refuse and exit 2.
#
#   $1 — prefix, brackets included, e.g. `[naming]`
#   $2 — files opened
#   $3 — sites examined inside them, or `-` where the file is the unit
#   $4 — the `sources=` token: `self-reported`, or `<source>:<covered>/<expected>`
#
# The three refusals mirror the TypeScript half exactly — nothing read, an
# expectation of zero, and a walk shorter than its expectation — so a reader
# learns one set of failures rather than one per language.
read_size_report() {
  local prefix="$1" files="$2" sites="$3" sources="$4"
  if [ "$files" -le 0 ]; then
    echo "$prefix the walk opened no file at all — a finding count over an empty input is not" >&2
    echo "$prefix a clean tree; refusing to report a vacuous pass." >&2
    exit 2
  fi
  if [ "$sources" != "self-reported" ]; then
    local part source covered expected
    for part in ${sources//,/ }; do
      source="${part%%:*}"
      covered="${part#*:}"
      expected="${covered#*/}"
      covered="${covered%%/*}"
      if [ "$expected" -le 0 ]; then
        echo "$prefix the independent derivation \`$source\` expects nothing, so it corroborates" >&2
        echo "$prefix nothing; refusing to report a vacuous pass." >&2
        exit 2
      fi
      if [ "$covered" -lt "$expected" ]; then
        echo "$prefix the walk opened $files file(s) and covered $covered of the $expected unit(s)" >&2
        echo "$prefix \`$source\` derives — it is reading a residue of its population, not the" >&2
        echo "$prefix population; refusing to report a vacuous pass." >&2
        exit 2
      fi
    done
  fi
  read_size_line "$prefix" "$files" "$sites" "$sources"
}
