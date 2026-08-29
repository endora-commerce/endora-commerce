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

# The module ids used to be read here, off the index's import specifiers. They
# are read in `lib/module-root.sh` instead (feature 080, T040a), off the entry
# array, because a specifier is relative today and becomes a bare package name
# the moment a module ships as one — and because that file already has to
# resolve each module's directory, so two readers of the same artefact would be
# two answers waiting to disagree.

# `covered/expected` for a file list on stdin, against the module directories.
#
# Expected is every module directory the caller resolved; covered is those the
# listing produced at least one file under. This is #215's predicate: a walk
# that comes back *short* — the module tree half-moved, a glob that stopped
# matching one subtree — is invisible to an emptiness test and visible to this
# one, without anybody choosing a number.
#
# **It takes the directories rather than deriving a root from the index**
# (feature 080, T040a). It used to take the index and read its grandparent,
# which is one root; a module that has become a package is under no root of the
# application's, so a listing full of its files would have counted for nothing
# and the reconciliation would have reported the very shortfall it exists to
# refuse. `module_root_module_directories` is the one derivation, and passing its
# answer here is what keeps the two from disagreeing.
#
# Containment is matched with POSIX awk's `index()`, which is literal — a
# `grep -E` pattern built from a path would need the caller's separators
# escaped, and the one that got away would match more than it was asked to.
read_size_module_coverage() {
  local directories="$1"
  local expected covered
  [ -n "$directories" ] || return 1
  expected=$(printf '%s\n' "$directories" | grep -c '[^[:space:]]' || true)
  [ "$expected" -gt 0 ] || return 1
  covered=$(
    awk -v dirs="$directories" '
      BEGIN { total = split(dirs, dir, "\n") }
      {
        for (i = 1; i <= total; i++) {
          if (length(dir[i]) > 0 && index($0, dir[i] "/") == 1) { seen[dir[i]] = 1; break }
        }
      }
      END { for (d in seen) print d }
    ' \
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
