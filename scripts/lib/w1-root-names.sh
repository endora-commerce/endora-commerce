#!/usr/bin/env bash
# W1's second gate: a composition root naming the leaving module by its camelCase id.
#
# **Sourced, never executed.** `scripts/extract-paid-module.sh` refuses on any line this prints
# (`specs/134-paid-module-extraction/` research D16 §5, contract W1.1, T125).
#
# ## Why a second gate
#
# The first one greps import **specifiers**: a free package resolving the module. It cannot see a
# root that **registers, contributes or reads a value named after the module** — which is how
# `composeApp` carried five worker flags and a base URL named after paid modules, and how
# `backend/src/composition.ts` handed one paid module's resolver to a free one, with every import
# in the tree clean. A value supplied for a consumer in another repository is the same coupling
# W1 refuses, spelled as a container name instead of a specifier.
#
# ## What it matches, and where
#
# A property key or member access that is `<camelId>` or `<camelId>` followed by an upper-case
# letter (`<camelId>RunWorkers:`, `reads().<camelId>.handle`), in non-comment lines of the two roots —
# `packages/platform/src/**` and `backend/src/composition.ts` — tests excluded.
#
# **Scoped to the roots on purpose.** Widened to every free package, `ksef`'s prefix matches
# `ksefReferenceNumber`, `ksefProcessedAt` and `ksefRouting`, which FR-024 rules out of scope (a
# legal clearing system, not a vendor), and a gate that needs a per-entry exception on its first
# run is the wrong gate. After the fifteen have left, `check:port-dependencies`'
# `platform-name-unread` holds the same line standing, without knowing any module id (T124).
#
# Measured on `ce96b1e94` over the twelve ids then in the tree, it refuses `pim_akeneo`,
# `pim_ergonode`, `pim_pimcore`, `pim_unopim`, `comarch_xl` and `ksef` — every hit a true
# positive — and answers nothing for `infakt` and the five gateways.

# `pim_akeneo` → `pimAkeneo`: the spelling a root gives a value named after the module.
camel_id_of() {
  printf '%s' "$1" | awk -F_ '{
    printf "%s", $1
    for (i = 2; i <= NF; i++) printf "%s", toupper(substr($i, 1, 1)) substr($i, 2)
  }'
}

# Prints every root line naming the module's camelCase id, as `git grep -n` does; nothing when
# none does. Reads the working tree, or the revision given as the second argument. Always exits
# 0 — the caller decides what a non-empty answer means.
w1_root_name_hits() {
  local camel
  camel=$(camel_id_of "$1")
  local -a rev=()
  [ -n "${2:-}" ] && rev=("$2")
  # `git grep -n` prints `<path>:<line>:<text>` (with `<rev>:` in front when given a revision),
  # so a comment is a line whose text starts with `//`, `/*` or a JSDoc `*`.
  { git grep -nE "\\b${camel}([A-Z][A-Za-z0-9]*)?\\b\\s*[:.]|\\.${camel}\\b" "${rev[@]}" \
      -- 'packages/platform/src/*' 'backend/src/composition.ts' ':!*.test.ts' || true; } \
    | { grep -vE ':[0-9]+:\s*(\*|//|/\*)' || true; }
}
