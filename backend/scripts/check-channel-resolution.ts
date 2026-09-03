/**
 * CI check — Sales-Channel Resolution Unification (feature 053, FR-011).
 * **Repository-scope host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/channel-resolution.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts) — its four signals, its resolver-owned and storefront-surface
 * predicates, and its population walk. This file resolves this repository's
 * module walk roots and its population floor, and carries the rollout
 * allow-list below, which is a statement about *this* tree's debt and does not
 * travel. The forwarding specifier is **bare**, never a path into `dist`.
 *
 * A shrinking ALLOW-LIST carried the not-yet-migrated offenders so the check
 * landed green (report-only) during the rollout; pass `--enforce` once the
 * allow-list is empty to make any violation fail the build.
 *
 * Usage: `tsx scripts/check-channel-resolution.ts [--enforce] [--list]`
 * Exit 0 = clean (or report-only); exit 1 = violations under --enforce, or a
 * stale allow-list entry that no longer has any violation.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  analyzeSource,
  collectChannelSources,
  type Violation,
} from '@endora-commerce/cli/rules/channel-resolution.js';

import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { reportReadSize } from './lib/read-size.js';
import { requireModuleLayout } from './lib/module-roots.js';

export * from '@endora-commerce/cli/rules/channel-resolution.js';

/**
 * Files still permitted to trip a signal during the rollout. Remove an entry
 * in the same change that redirects the file to `getResolvedChannel()`. Paths
 * are relative to `src/` with POSIX separators.
 */
// Feature 053 complete: every storefront surface now reads the resolved channel,
// so the allow-list is empty and the check runs in --enforce mode in CI. Any new
// entry here would be a regression to per-module resolution — don't add one;
// redirect the offending module to `getResolvedChannel()` instead.
//
// Feature 072 (D-42) added signal 3 and kept the list empty: the fix is
// mechanical at every site, and across ~100 settings reads there were only six
// non-uuid literals and four nil-uuid spellings, so there was nothing to drain.
//
// Feature 072 (D-48) added signal 4 and kept it empty for a stronger reason:
// the four sites it exists for were deleted *before* it was written. Widening
// the check first would have flagged code the same change removes, and an
// allow-list entry is how that becomes permanent. If this signal fires on a new
// site, the site is wrong — the system-default channel always exists.
const ALLOW_LIST = new Set<string>([]);

async function main(): Promise<void> {
  const enforce = process.argv.includes('--enforce');
  const listMode = process.argv.includes('--list');
  // Both roots, derived (feature 080, T040a).
  const layout = await requireModuleLayout('[channel-resolution]');
  const files = layout.sourceRoots.flatMap((root) => collectChannelSources(root));

  const all: Violation[] = [];
  const scanned: string[] = [];
  for (const file of files) {
    const relPath = layout.keyOf(file);
    scanned.push(relPath);
    all.push(...analyzeSource(readFileSync(file, 'utf8'), relPath));
  }

  // Scanning the whole of `src/` is deliberate (see the header) — but it made
  // the emptiness guard blind, because `src/` minus `src/modules` is still 105
  // files and a scan of those reports `violations=0` (issue #215). The floor is
  // per registered module, derived from the manifest index.
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[channel-resolution]',
    manifestIndexPath: layout.manifestIndexPath,
    files,
    moduleIdOf: layout.moduleIdOfPath,
  });

  const offendingFiles = new Set(all.map((v) => v.file));
  const blocking = all.filter((v) => !ALLOW_LIST.has(v.file));
  const allowed = all.filter((v) => ALLOW_LIST.has(v.file));
  // Stale allow-list entries: listed but no longer violating → must be removed.
  const stale = [...ALLOW_LIST].filter((f) => !offendingFiles.has(f));

  if (listMode) {
    for (const v of all) {
      const tag = ALLOW_LIST.has(v.file) ? 'ALLOWED ' : 'BLOCKING';
      console.log(`${tag} ${v.file}:${v.line}  [${v.kind}] ${v.detail}`);
    }
    console.log('');
  }

  // What was read, beside what was found (issue #244): this check printed five
  // finding counts and no input size at all, so `violations=0` said nothing
  // about whether the scan happened.
  reportReadSize({ prefix: '[channel-resolution]', files: scanned.length, coverage: [coverage] });
  console.log(
    `[channel-resolution] violations=${all.length} blocking=${blocking.length} ` +
      `allow-listed=${allowed.length} allow-list-size=${ALLOW_LIST.size} stale-allow=${stale.length} ` +
      `mode=${enforce ? 'enforce' : 'report-only'}`,
  );

  if (blocking.length > 0) {
    console.error('\nSales-channel resolution violations:');
    for (const v of blocking) console.error(`  - ${v.file}:${v.line}  [${v.kind}] ${v.detail}`);
  }
  if (stale.length > 0) {
    console.error('\nStale allow-list entries (no longer violate — delete them from ALLOW_LIST):');
    for (const f of stale) console.error(`  - ${f}`);
  }

  // Stale entries always fail (keeps the list honest). Blocking violations fail
  // only under --enforce so the rollout can proceed report-only.
  const fail = stale.length > 0 || (enforce && blocking.length > 0);
  process.exit(fail ? 1 : 0);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
