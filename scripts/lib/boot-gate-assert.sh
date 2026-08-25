#!/usr/bin/env bash
# The boot gate's judgement, separated from its plumbing (feature 080, D-165 step F).
#
# `scripts/boot-gate.sh` builds an image, migrates a throwaway database, boots
# the container and collects three observations: the boot log, the HTTP status
# of the health endpoint, and the body of `/api/v1/storefront/module-presence`.
# Everything below turns those three into findings, and touches neither docker
# nor the network — which is what lets `backend/test/unit/ci/boot-gate.test.ts`
# spawn each function over fixture text and prove that every finding this gate
# claims to make can actually be made. A gate that has never been red is a gate
# nobody has tested.
#
# Every function prints zero or more `<kind>: <sentence>` lines on stdout and
# returns 0. The caller counts the lines; a run with none is green.
#
# The two silences D-165.3 reproduced are the reason each finding exists:
#
#   * 45 of 45 modules install no translations while the boot reports
#     `installed=0 skipped=21 failed=0`. Nothing throws, because
#     `loadModuleBundles` reads an absent bundles directory as "this module
#     ships no translatable strings". The count that gives it away is not
#     `installed` alone — it is that `installed + skipped` no longer accounts
#     for every module the platform composed.
#   * Every overlay module vanishes, with no error at all.
#
# Deliberately POSIX-ish bash with no `jq`, no `curl` and no node: the gate runs
# on `docker:27`, an alpine image whose whole toolbox is busybox plus the docker
# client, and a gate that needs a package installed before it can judge is a
# gate that reports "could not run" on the day it matters.

# ---------------------------------------------------------------------------
# Reading the two observations
# ---------------------------------------------------------------------------

# boot_gate_module_ids <presence-json-file>
#
# Every module id the running platform enumerates, one per line, in the order
# the body lists them. The body is a flat
# `{"modules":[{"id":"x","present":true},…]}` produced by a Zod-validated
# contract, so a field-order-independent parser would be answering a question
# nothing asks; `grep -o` over that exact shape is both sufficient and
# impossible to half-read — a body that is not that shape yields nothing, and
# every caller treats "nothing" as exit 2 rather than as agreement.
boot_gate_module_ids() {
  grep -o '"id":"[^"]*"' "$1" 2>/dev/null | sed 's/^"id":"//; s/"$//'
}

# boot_gate_present_module_ids <presence-json-file>
#
# The ids whose `present` is true. Presence is the conjunction of the two axes
# of Principle XVII, so a module that is composed but switched off is listed
# and is *not* here — which is the distinction the overlay finding needs: an
# overlay module that vanished is missing from the enumeration entirely, while
# one an operator switched off is enumerated and absent, and those are not the
# same defect.
boot_gate_present_module_ids() {
  grep -o '"id":"[^"]*","present":true' "$1" 2>/dev/null | sed 's/^"id":"//; s/","present":true$//'
}

# boot_gate_reconcile_line <boot-log-file>
#
# The last `[i18n] reconcile complete — installed=N skipped=M failed=K` line, with
# the log's ANSI colouring stripped. Last rather than first: the admin reload
# route runs the same reconcile, and a gate that read the first line would be
# answering about a boot that a later run has already superseded.
boot_gate_reconcile_line() {
  sed 's/\x1b\[[0-9;]*m//g' "$1" 2>/dev/null | grep '\[i18n\] reconcile complete' | tail -1
}

# boot_gate_reconcile_field <line> <installed|skipped|failed>
boot_gate_reconcile_field() {
  printf '%s\n' "$1" | grep -o "$2=[0-9]*" | tail -1 | sed "s/^$2=//"
}

# ---------------------------------------------------------------------------
# The findings
# ---------------------------------------------------------------------------

# boot_gate_health_findings <status-code>
boot_gate_health_findings() {
  local status=$1
  if [ "$status" != "200" ]; then
    printf 'unhealthy: the built image booted but %s answered HTTP %s. The compiled application is not serving requests, so nothing below this line was measured on a running platform.\n' \
      "${BOOT_GATE_HEALTH_PATH:-/api/v1/_health}" "$status"
  fi
}

# boot_gate_translation_findings <boot-log-file> <composed-module-count>
#
# `composed-module-count` is the number of modules the running platform
# enumerates — an independent source for the same population the reconciler
# walked, which is what makes the arithmetic below a reconciliation rather than
# the boot agreeing with itself.
boot_gate_translation_findings() {
  local log=$1 modules=$2
  local line installed skipped failed accounted

  line=$(boot_gate_reconcile_line "$log")
  if [ -z "$line" ]; then
    printf 'no-reconcile-line: the boot log carries no "[i18n] reconcile complete" line at all. The i18n reconciler did not run, so no module installed any translation and the platform is serving raw i18n keys.\n'
    return 0
  fi

  installed=$(boot_gate_reconcile_field "$line" installed)
  skipped=$(boot_gate_reconcile_field "$line" skipped)
  failed=$(boot_gate_reconcile_field "$line" failed)
  if [ -z "$installed" ] || [ -z "$skipped" ] || [ -z "$failed" ]; then
    printf 'no-reconcile-line: the boot log has a reconcile line this gate cannot read: %s\n' "$line"
    return 0
  fi

  if [ "$failed" -gt 0 ]; then
    printf 'translation-failures: %s module(s) failed to load their translation bundles (%s). Each failure is named in the boot log with the directory it was read from.\n' \
      "$failed" "$line"
  fi

  if [ "$installed" -eq 0 ]; then
    printf 'no-translations-installed: the boot installed translations for no module at all (%s). This is D-165.3'"'"'s first silence: tsc copies no JSON, and an absent bundles directory reads as "this module ships no translatable strings", so the count is green and every string renders as its raw key.\n' \
      "$line"
    return 0
  fi

  # The reconciler puts every module it walks into exactly one of the three
  # counts — except the one case this gate exists for: a module that declares
  # bundles the built tree does not carry installs nothing, throws nothing, and
  # lands in none of them. So the arithmetic is the finding, and it is what
  # `installed > 0` alone cannot see: with every `i18n` directory dropped from
  # the built tree, the six modules that are packages carry theirs inside
  # `node_modules` and still install, leaving a cheerful non-zero count over a
  # platform whose other 39 modules serve raw keys.
  accounted=$((installed + skipped + failed))
  if [ "$accounted" -ne "$modules" ]; then
    printf 'unaccounted-modules: the boot installed translations for %s module(s), skipped %s and failed %s, which accounts for %s of the %s modules the running platform composes. The %s left over declare translation bundles the built tree does not carry — `scripts/copy-runtime-assets.ts` is what puts them there and audits its own output against the registered manifests.\n' \
      "$installed" "$skipped" "$failed" "$accounted" "$modules" "$((modules - accounted))"
  fi
}

# boot_gate_overlay_findings <presence-json-file> <expected-id>...
#
# The expected ids are derived by the caller from the deployment's own
# `modules/` directory, never written down here: a deployment that grows a
# second overlay module is covered by existing, and D-100 refuses the copy.
boot_gate_overlay_findings() {
  local presence=$1
  shift
  local composed present id total
  composed=$(boot_gate_module_ids "$presence")
  present=$(boot_gate_present_module_ids "$presence")
  total=$(printf '%s\n' "$composed" | grep -c '[^[:space:]]')

  for id in "$@"; do
    if ! printf '%s\n' "$composed" | grep -qx "$id"; then
      printf 'overlay-missing: the deployment declares overlay module "%s" and the running platform does not compose it — it enumerates %s modules and that is not one of them. This is D-165.3'"'"'s second silence: the overlay vanishes from the compiled application with no error and no warning.\n' \
        "$id" "$total"
      continue
    fi
    if ! printf '%s\n' "$present" | grep -qx "$id"; then
      printf 'overlay-not-present: the running platform composes overlay module "%s" but reports it as absent. That is the operator axis of Principle XVII rather than a vanished overlay, and a deployment whose reference module is switched off cannot answer the question this gate asks.\n' \
        "$id"
    fi
  done
}
