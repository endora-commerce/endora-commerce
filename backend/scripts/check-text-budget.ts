/**
 * CI check — the copy the admin shows under a title or beside a field stays
 * short enough to be read in passing (issue #1451, UX audit 2026-11-17 DS-23;
 * the rule is `specs/conventions/module-i18n.md`'s).
 *
 * Five key families carry a length budget, measured in characters of the
 * English bundle:
 *
 *   - `*.page.description`, `*.subtitle` — at most 80: one line under a title;
 *   - `*.hint` — at most 80: one line beside a field; text over 80 moves to
 *     the field's `help`;
 *   - `*.help` — at most 280: the `HelpTip` ⓘ popover; anything longer belongs
 *     in the module's documentation page, linked;
 *   - `settingLabels.*.description` — at most 120: one row of the settings
 *     screen, with the full explanation in the module's documentation.
 *
 * The owner's decision on DEC-01 was *"the rule now, the check after the first
 * text pass"*, so it lands as a **two-way ratchet** over the copy that stood
 * when it did, in `HARDCODED_STRINGS_BASELINE`'s idiom
 * ({@link TEXT_BUDGET_BASELINE}): a key over budget with no entry fails, an
 * entry whose key grew fails, and an entry whose key is gone, back within
 * budget or shorter than recorded fails too — so the ledger only ever shrinks.
 *
 * **English only, and that is the design, not a gap.** English is the source
 * language (`LANGUAGE_FALLBACK`): the copy is written there and translated from
 * it, so the English length is the one an author controls. A Polish sentence
 * runs longer than its English source by a margin the author cannot remove
 * without changing what it says; holding it to the same number would ledger
 * translations of copy that is already within budget, and every shortening of
 * the English is the shortening of the Polish in the same change.
 *
 * Its population is `check:bundle-pairing`'s: every module the generated
 * manifest index registers that declares `i18n.bundlesDir`, read at that
 * module's own directory — the files the running platform loads.
 *
 * Usage: `tsx scripts/check-text-budget.ts [--list | --print-baseline]`
 *   `--list`           — print every over-budget key with its length and budget;
 *   `--print-baseline` — print the ledger **as measured** on this tree, for
 *                        re-recording it (`specs/conventions/check-estate.md`:
 *                        a ledger is re-measured, never computed from a delta).
 * Exit 0 = every budgeted key is within budget or exactly at its recorded
 * length; exit 1 = at least one finding; exit 2 = the run could not see the
 * population it judges — no registered module, a module walk that came back
 * short, a declared English bundle it could not open, no budgeted key at all,
 * or a manifest artefact its source has outrun.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LANGUAGE_FALLBACK } from '@endora-commerce/contracts';

import {
  checkEmittedFreshness,
  emittingPackages,
  refuseStaleEmittedArtefacts,
} from './lib/emitted-freshness.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

export const PREFIX = '[text-budget]';

/** One key family and the most characters its copy may hold. */
export interface TextBudgetRule {
  readonly id: string;
  /** Matched against the whole bundle key. */
  readonly pattern: RegExp;
  readonly budget: number;
}

/**
 * The budgets, as ruled. A key takes the first family it matches; the grammar
 * is the **last segment** (or, for a page description and a setting, the last
 * two and the first), so `actions.newProduct.description` — a palette entry —
 * and a camelCase `…Hint` are outside it.
 */
export const TEXT_BUDGETS: readonly TextBudgetRule[] = [
  { id: 'setting-description', pattern: /^settingLabels\..+\.description$/, budget: 120 },
  { id: 'page-description', pattern: /(^|\.)page\.description$/, budget: 80 },
  { id: 'subtitle', pattern: /(^|\.)subtitle$/, budget: 80 },
  { id: 'hint', pattern: /(^|\.)hint$/, budget: 80 },
  { id: 'help', pattern: /(^|\.)help$/, budget: 280 },
];

/** The family a key belongs to, or `null` for an unbudgeted key. */
export function budgetOf(key: string): TextBudgetRule | null {
  return TEXT_BUDGETS.find((rule) => rule.pattern.test(key)) ?? null;
}

/** The ledger key: one key in two modules is two pieces of copy. */
export function baselineKey(moduleId: string, key: string): string {
  return `${moduleId}:${key}`;
}

/** Characters, not UTF-16 code units — `ż` is one and so is an emoji. */
export function lengthOf(value: string): number {
  return [...value].length;
}

export type TextBudgetFindingKind =
  'over-budget' | 'ledger-grew' | 'ledger-stale' | 'unparseable-bundle';

export interface TextBudgetFinding {
  readonly kind: TextBudgetFindingKind;
  /** `<module>:<key>`, or the module id for a bundle-level finding. */
  readonly entry: string;
  readonly detail: string;
}

export interface TextBudgetBundle {
  readonly moduleId: string;
  /** For messages only. */
  readonly path: string;
  /** The bundle's bytes, as read. */
  readonly text: string;
}

export interface OverBudgetEntry {
  readonly entry: string;
  readonly length: number;
  readonly budget: number;
}

export interface TextBudgetResult {
  readonly findings: readonly TextBudgetFinding[];
  /** Every key over its budget, ledgered or not — what `--print-baseline` records. */
  readonly overBudget: readonly OverBudgetEntry[];
  /** Bundles opened. */
  readonly filesRead: number;
  /** Budgeted keys judged. */
  readonly sites: number;
}

export const REMEDIES: Readonly<Record<TextBudgetFindingKind, string>> = {
  'over-budget':
    'Shorten the English copy to its budget and rewrite the Polish with it; move the explanation ' +
    "to the module's documentation page (`specs/conventions/module-i18n.md`). Do not add a " +
    'ledger entry: the ledger records the copy that stood when the check landed.',
  'ledger-grew':
    'A ledgered key may not grow. Shorten it — to its budget, ideally — and lower or delete its ' +
    'entry in TEXT_BUDGET_BASELINE.',
  'ledger-stale':
    'The ledger describes copy that is gone or shorter. Re-measure with ' +
    '`pnpm --filter backend exec tsx scripts/check-text-budget.ts --print-baseline` and record ' +
    'what it prints for these entries — never a number computed from the change.',
  'unparseable-bundle':
    'The bundle is not a JSON object; fix it (the platform logs and skips it at boot, so the ' +
    'module renders raw keys).',
};

export function checkTextBudget(input: {
  readonly bundles: readonly TextBudgetBundle[];
  readonly baseline: Readonly<Record<string, number>>;
}): TextBudgetResult {
  const findings: TextBudgetFinding[] = [];
  const overBudget: OverBudgetEntry[] = [];
  const seen = new Map<string, number>();
  let sites = 0;

  for (const bundle of input.bundles) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bundle.text);
    } catch (error: unknown) {
      findings.push({ kind: 'unparseable-bundle', entry: bundle.moduleId, detail: String(error) });
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      findings.push({
        kind: 'unparseable-bundle',
        entry: bundle.moduleId,
        detail: 'the bundle is not a JSON object',
      });
      continue;
    }
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      const rule = budgetOf(key);
      if (rule === null) continue;
      sites += 1;
      const length = lengthOf(value);
      const entry = baselineKey(bundle.moduleId, key);
      seen.set(entry, length);
      if (length <= rule.budget) continue;
      overBudget.push({ entry, length, budget: rule.budget });
      const recorded = input.baseline[entry];
      if (recorded === undefined) {
        findings.push({
          kind: 'over-budget',
          entry,
          detail: `${length} characters, budget ${rule.budget} (${rule.id})`,
        });
      } else if (length > recorded) {
        findings.push({
          kind: 'ledger-grew',
          entry,
          detail: `${length} characters, recorded ${recorded}, budget ${rule.budget}`,
        });
      }
    }
  }

  for (const [entry, recorded] of Object.entries(input.baseline)) {
    const length = seen.get(entry);
    const key = entry.slice(entry.indexOf(':') + 1);
    const budget = budgetOf(key)?.budget;
    if (length === undefined) {
      findings.push({
        kind: 'ledger-stale',
        entry,
        detail: `recorded ${recorded}, but no bundle read holds this key`,
      });
    } else if (budget === undefined || length <= budget) {
      findings.push({
        kind: 'ledger-stale',
        entry,
        detail: `recorded ${recorded}, now ${length} — within budget, delete the entry`,
      });
    } else if (length < recorded) {
      findings.push({
        kind: 'ledger-stale',
        entry,
        detail: `recorded ${recorded}, now ${length} — still over budget, lower the entry`,
      });
    }
  }

  overBudget.sort((a, b) => a.entry.localeCompare(b.entry));
  return { findings, overBudget, filesRead: input.bundles.length, sites };
}

/**
 * Every key over budget when the check landed, with its length in characters
 * (`<module>:<key>` → length). Re-measured with `--print-baseline`, never
 * edited by hand from a delta. It is meant to reach `{}`, one text pass at a
 * time (CAT-13, CAT-14, SHELL-23, WORK-11 and the rest of the audit's
 * *"Text to cut"* lists).
 */
export const TEXT_BUDGET_BASELINE: Readonly<Record<string, number>> = {
  // Measured with `--print-baseline` on `origin/master` 2026-11-20 (issue #1451); re-measured
  // 2026-11-21 after `promotions.page.description` was cut (#1436).
  '_i18n:fulfilment.hint': 119,
  '_i18n:pageBuilder.fieldText.editorName.hint': 81,
  '_i18n:returns.detail.settlement.charge.hint': 200,
  'catalog:productsList.bulkEdit.archive.hint': 123,
  'catalog:productsList.bulkEdit.restore.hint': 112,
  'cms:presets.panel.hint': 94,
  'product_feeds:builder.outputFormat.hint': 108,
  'product_feeds:checks.reason.transport.hint': 140,
  'product_feeds:delivery.empty.subtitle': 121,
  'product_feeds:feeds.empty.subtitle': 90,
  'product_feeds:feeds.settings.priceBook.hint': 98,
  'product_feeds:templates.startingPoint.hint': 103,
  'seo:productLink.hint': 95,
};

interface ModuleWithBundles {
  readonly moduleId: string;
  readonly directory: string;
  readonly bundlesDir: string;
}

async function loadModules(indexPath: string): Promise<{
  readonly modules: readonly ModuleWithBundles[];
  readonly manifestLocations: readonly string[];
}> {
  const loaded = (await import(pathToFileURL(indexPath).href)) as {
    DISCOVERED_MANIFESTS?: ReadonlyArray<{
      id: string;
      manifestPath?: string;
      manifest?: { i18n?: { bundlesDir?: string } };
    }>;
  };
  const modules: ModuleWithBundles[] = [];
  const manifestLocations: string[] = [];
  for (const entry of loaded.DISCOVERED_MANIFESTS ?? []) {
    if (entry.manifestPath === undefined) continue;
    manifestLocations.push(entry.manifestPath);
    const bundlesDir = entry.manifest?.i18n?.bundlesDir;
    if (bundlesDir === undefined) continue;
    modules.push({ moduleId: entry.id, directory: dirname(entry.manifestPath), bundlesDir });
  }
  return { modules, manifestLocations };
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const printBaseline = process.argv.includes('--print-baseline');
  const layout = await requireModuleLayout(PREFIX);

  let loaded: Awaited<ReturnType<typeof loadModules>>;
  try {
    loaded = await loadModules(layout.manifestIndexPath);
  } catch (error: unknown) {
    console.error(
      `${PREFIX} the module index at ${layout.manifestIndexPath} could not be read ` +
        `(${String(error)}) — the population is derived from it; refusing to report a vacuous pass`,
    );
    process.exit(2);
  }

  // Issue #215's shared floor, in `check:bundle-pairing`'s conjunction: the
  // layout must place each module and the directory it places it at must exist.
  const directories = [...layout.moduleDirectories]
    .filter(([, directory]) => existsSync(directory))
    .map(([, directory]) => directory);
  const byDirectory = new Map(
    [...layout.moduleDirectories].map(([moduleId, directory]) => [directory, moduleId] as const),
  );
  const coverage = await refuseVacuousModulePopulation({
    prefix: PREFIX,
    manifestIndexPath: layout.manifestIndexPath,
    files: directories,
    moduleIdOf: (path) => byDirectory.get(path) ?? null,
  });

  refuseStaleEmittedArtefacts(
    PREFIX,
    checkEmittedFreshness({
      read: loaded.manifestLocations,
      packages: emittingPackages(layout.repoRoot),
    }),
    layout.displayOf,
  );

  // The English bundle of every module that declares a bundle directory. A
  // declared bundle that is not on disk is not a module with nothing over
  // budget — `en-bundles` below counts it short and the run exits 2.
  const bundles: TextBudgetBundle[] = [];
  for (const module of loaded.modules) {
    const path = join(module.directory, module.bundlesDir, `${LANGUAGE_FALLBACK}.json`);
    if (!existsSync(path)) continue;
    bundles.push({ moduleId: module.moduleId, path, text: readFileSync(path, 'utf8') });
  }

  const result = checkTextBudget({ bundles, baseline: TEXT_BUDGET_BASELINE });

  if (printBaseline) {
    for (const entry of result.overBudget) console.log(`  '${entry.entry}': ${entry.length},`);
    process.exit(0);
  }
  if (listMode) {
    for (const entry of result.overBudget) {
      console.log(`${String(entry.length).padStart(4)} / ${entry.budget}  ${entry.entry}`);
    }
    console.log('');
  }

  reportReadSize({
    prefix: PREFIX,
    files: result.filesRead,
    sites: result.sites,
    coverage: [
      coverage,
      // The second author is the manifests: every module declaring
      // `i18n.bundlesDir` is a module whose English bundle this run must open.
      { source: 'en-bundles', expected: loaded.modules.length, covered: bundles.length },
    ],
  });
  if (result.sites === 0) {
    console.error(
      `${PREFIX} no bundle holds a single budgeted key — the key grammar matches nothing, so a ` +
        'clean line would describe nothing; refusing to report a vacuous pass',
    );
    process.exit(2);
  }
  console.log(
    `${PREFIX} budgeted keys=${result.sites} over budget=${result.overBudget.length} ` +
      `ledger-size=${Object.keys(TEXT_BUDGET_BASELINE).length} findings=${result.findings.length}`,
  );

  if (result.findings.length === 0) process.exit(0);

  const kinds = [...new Set(result.findings.map((finding) => finding.kind))].sort();
  for (const kind of kinds) {
    console.error(`\n[${kind}]\n${REMEDIES[kind]}\n`);
    for (const finding of result.findings.filter((candidate) => candidate.kind === kind)) {
      console.error(`  - ${finding.entry}: ${finding.detail}`);
    }
  }
  process.exit(1);
}

// CLI only — importing this module (the companion test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
