/**
 * CI check — English is the default language of a module's own prose
 * (`specs/094-translation-boundary/contracts/default-language-prose-check.md`,
 * the owner ruling of 2026-09-01). **Repository-scope host** over the relocated
 * analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/default-language-prose.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts) — its three findings, its Polish detector, its exemptions and its
 * population walk. This file resolves this repository's module walk roots, its
 * population floor and the directory its ledger shards live in: a shard is a
 * statement about *this* tree's debt and does not travel. The forwarding
 * specifier is **bare**, never a path into `dist`.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readFileSync } from 'node:fs';

import { LANGUAGE_FALLBACK, SUPPORTED_LANGUAGES } from '@endora-commerce/contracts';
import {
  checkDefaultLanguageProse,
  collectProseSources as walk,
  DETECTED_LANGUAGES,
  loadLedgerShards,
  primarySubtag,
  REMEDIES,
  type DefaultLanguageProseFindingKind,
  type LedgerShard,
} from '@endora-commerce/cli/rules/default-language-prose.js';
import { pathToFileURL } from 'node:url';

import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/default-language-prose.js';

const PREFIX = '[default-language-prose]';

/** Where the shards live. Exported so the check and its test read one directory. */
export const LEDGER_ROOT = new URL('./ledgers/non-english-defaults/', import.meta.url).pathname;

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout = await requireModuleLayout(PREFIX);

  // § 4.1 — with no shipped language the detector has nothing to answer for and
  // every literal is vacuously English.
  const languages = [...SUPPORTED_LANGUAGES];
  if (languages.length === 0) {
    console.error(
      `${PREFIX} the platform's shipped-language set is empty, so no literal can be in a ` +
        'language it does not ship and the predicate has nothing to decide; refusing to ' +
        'report a vacuous pass',
    );
    process.exit(2);
  }

  // § 4.5, and it is what makes § 1.3's Polish-only bound a refusal rather than
  // a decoration. English needs no detector — an English literal is not a
  // finding under the ruling — so the population is every *other* shipped
  // language, and a set with no detector at all is a check that would report
  // clean over prose it cannot read.
  const needDetector = languages.filter(
    (language) => primarySubtag(language) !== primarySubtag(LANGUAGE_FALLBACK),
  );
  const detected = needDetector.filter((language) =>
    DETECTED_LANGUAGES.includes(primarySubtag(language)),
  );
  if (detected.length === 0) {
    console.error(
      `${PREFIX} the platform ships ${needDetector.length} language(s) other than ` +
        `${LANGUAGE_FALLBACK} (${needDetector.join(', ') || 'none'}) and this check has a ` +
        `detector for none of them (it has one for: ${DETECTED_LANGUAGES.join(', ')}). A ` +
        'clean line here would be an implied coverage claim over prose the run cannot ' +
        'read; refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  const files = layout.moduleWalkRoots.flatMap((root) => walk(root));
  const sources = new Map<string, string>();
  for (const file of files) sources.set(layout.keyOf(file), readFileSync(file, 'utf8'));

  // § 4.2 and § 4.3 — issue #215's shared floor. The population is the module
  // tree, so a tree that moved leaves the walk short rather than empty.
  const coverage = await refuseVacuousModulePopulation({
    prefix: PREFIX,
    manifestIndexPath: layout.manifestIndexPath,
    files,
    moduleIdOf: layout.moduleIdOfPath,
  });

  let shards: LedgerShard[];
  try {
    shards = await loadLedgerShards(LEDGER_ROOT);
  } catch (error: unknown) {
    console.error(
      `${PREFIX} ${error instanceof Error ? error.message : String(error)} — the ledger is ` +
        'what separates recorded debt from a new violation, so a run without it would ' +
        'report every standing site as a fresh one; refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  const byKey = new Map<string, string>();
  for (const [key, absolute] of [...sources.keys()].map(
    (key) => [key, layout.absolutePathOf(key)] as const,
  )) {
    const moduleId = layout.moduleIdOfPath(absolute);
    if (moduleId !== null) byKey.set(key, moduleId);
  }

  const result = checkDefaultLanguageProse({ sources, languages }, shards, (file) =>
    byKey.get(file) ?? null,
  );

  // § 4.4 — every module resolved to zero string literals. With an
  // exemption-heavy predicate that state is *vacuously clean*: nothing is
  // outside a per-language structure when nothing was read.
  if (result.classified === 0) {
    console.error(
      `${PREFIX} the walk opened ${sources.size} file(s) and classified no string literal ` +
        'at all, so every exemption held vacuously and the predicate decided nothing; ' +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  if (listMode) {
    for (const site of result.findings) {
      const tag = result.violations.includes(site) ? 'VIOLATION' : 'LEDGERED ';
      console.log(`${tag} ${site.file}:${site.line}  [${site.kind}] ${site.text.slice(0, 80)}`);
    }
    console.log('');
  }

  reportReadSize({
    prefix: PREFIX,
    files: sources.size,
    sites: result.classified,
    coverage: [
      coverage,
      { source: 'detected-languages', expected: needDetector.length, covered: detected.length },
    ],
  });
  console.log(
    `${PREFIX} non-english prose outside a per-language structure=${result.findings.length} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${shards.reduce((n, shard) => n + Object.keys(shard.entries).length, 0)} ` +
      `shards=${shards.length} stale=${result.stale.length} misfiled=${result.misfiled.length}`,
  );

  const kinds = [
    ...new Set(result.violations.map((finding) => finding.kind)),
  ].sort() as DefaultLanguageProseFindingKind[];
  for (const kind of kinds) {
    console.error(`\n[${kind}]\n${REMEDIES[kind]}\n`);
    for (const site of result.violations.filter((candidate) => candidate.kind === kind)) {
      console.error(`  - ${site.file}:${site.line}  (${site.language}) ${site.text.slice(0, 100)}`);
    }
  }
  if (result.stale.length > 0) {
    console.error(
      '\nStale ledger entries (no literal in that file digests to that key — delete them):',
    );
    for (const key of result.stale) console.error(`  - ${key}`);
  }
  if (result.misfiled.length > 0) {
    console.error("\nLedger entries filed under a module that does not own the file they name:");
    for (const key of result.misfiled) console.error(`  - ${key}`);
  }

  process.exit(
    result.violations.length > 0 || result.stale.length > 0 || result.misfiled.length > 0 ? 1 : 0,
  );
}

// CLI only — importing this module (the companion test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
