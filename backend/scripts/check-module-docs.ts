/**
 * CI check — **the documentation navigation describes the modules the platform
 * composes** (feature 100 / roadmap F12, `contracts/docs-registry.md` §3).
 *
 * `overlay:check` answers a question about the **artefact**: is this what the
 * generator would emit. Every finding below is a question about the
 * **population**: is the generator looking at everything it should. The two are
 * not one question, and the difference is measurable — a generator that
 * correctly emits a sidebar for the 62 modules it can see agrees with itself
 * perfectly while eight written pages are reachable from no navigation at all.
 * That was the tree on 2026-09-03, and nothing in this repository could see it.
 *
 * ## What was wrong, measured
 *
 * Three hand-maintained lists described one population — the docs sidebar (70
 * refs), the module map in `docs/docs/modules/README.md` (51 rows) and the pages
 * on disk (66 slugs) — and all three disagreed with the generated manifest index
 * (71 modules) and with each other:
 *
 *   * **8** written pages were reachable from no sidebar entry, seven of them
 *     whole modules — `google_analytics`, `ksef`, `newsletter`, `pwa`,
 *     `returns`, `shipments`, `transactional_emails`;
 *   * **23** registered modules had no row in the module map;
 *   * **4** page slugs named no module id.
 *
 * Nobody chose any of that. Seven authors each forgot one line in a file they
 * had no other reason to open, and the one instrument that could have caught
 * half of it — Docusaurus's own `checkSidebarsDocIds` — ran in a build that
 * existed in no CI job.
 *
 * ## Findings
 *
 *   * **`undocumented-module`** — a registered module with no page and no
 *     `docs: false`. **Absent and `false` are not the same state**: a module that
 *     declares `false` owes nothing and is not a finding, a module that declares
 *     nothing is one. Collapsing them is how a conditional obligation becomes six
 *     empty files whose only effect is to make a check pass —
 *     `check:bundle-pairing`'s design argument, one population over.
 *     `MODULES_WITHOUT_DOCUMENTATION` is two-way and arrives holding the six that
 *     stand today, because a check that lands red is reverted rather than read.
 *   * **`orphan-page`** — a page the **committed** sidebar artefact does not
 *     reach. Asked against the artefact and not against a fresh render, because
 *     the artefact is what the site reads: a render agrees with itself, and that
 *     is the property `overlay:check`'s `foreign` verdict exists to work around.
 *     `PAGES_OUTSIDE_THE_NAVIGATION` is two-way and **empty**, which is the state
 *     the generator put the tree in: it emits an entry per page, so the eight
 *     that stood are reached. It is kept rather than deleted so that the next one
 *     is a finding with somewhere to be argued.
 *   * **`unlocated-page`** — a page under the modules category the walk cannot
 *     attribute to any module. **No ledger, deliberately** (R3.4): a page nothing
 *     attributes is exactly the state that produced the eight orphans, and an
 *     entry could only license it. It is a finding and never a skip (issue #113).
 *   * **`unpaired-index-row`** — a module map row naming no registered module, or
 *     a registered module with no row. Both directions, **no ledger**: each is
 *     one regeneration from compliance.
 *   * **`stale-page-alias`** — the two-way half of `PAGES_ATTRIBUTED_BY_ALIAS`
 *     (`lib/module-docs.ts`), which is what lets the four Q2 slugs be attributed
 *     at all. An entry describing no page on disk fails, and so does one whose
 *     slug now names its module directly — the state Q2's rename produces, so the
 *     merge request that renames a page is the one that retires its entry rather
 *     than the merge request after it.
 *
 * ## What it cannot see, stated here rather than discovered later
 *
 *   * **Front matter is a leading `---`-delimited block** and a value spanning
 *     lines is read as its first line (`lib/module-docs.ts`).
 *   * **A doc id is a file path.** A page overriding its own `id` or `slug` in
 *     front matter is followed for neither. Nothing in the tree does.
 *   * **A sidebar entry built by an expression** rather than written as a
 *     literal. The generator writes literals; a hand-edited artefact that did not
 *     would be `overlay:check`'s finding, not this one's.
 *   * **Whether a page is good, current or complete.** It answers reachability
 *     and attribution, and nothing else.
 *
 * Usage: `tsx scripts/check-module-docs.ts [--list]`
 * Exit 0 = the navigation describes the platform; exit 1 = at least one finding;
 * exit 2 = the run could not see the population it judges — no registered
 * module, a module walk that came back short, no page read at all, a sidebar
 * artefact that contributed no entry, a module map that is unreadable or holds no
 * row, or a manifest artefact its own source has outrun.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  checkEmittedFreshness,
  emittingPackages,
  refuseStaleEmittedArtefacts,
} from './lib/emitted-freshness.js';
import {
  attributeDocs,
  collectDocPages,
  DOCS_SIDEBAR_ARTEFACT,
  MODULE_MAP_ARTEFACT,
  MODULES_CATEGORY,
  PAGES_ATTRIBUTED_BY_ALIAS,
  resolveDocsLayout,
  DocsLayoutUnresolvableError,
  type DocPage,
  type DocsAttribution,
  type DocsLayout,
} from './lib/module-docs.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize, type ReadCoverage } from './lib/read-size.js';

const PREFIX = '[module-docs]';

export type ModuleDocsFindingKind =
  | 'undocumented-module'
  | 'orphan-page'
  | 'unlocated-page'
  | 'unpaired-index-row'
  | 'stale-page-alias';

/**
 * Registered modules that ship no documentation page, each with the reason.
 *
 * Two-way: an entry for a module that now has a page fails, and a module with no
 * page and no entry fails. It arrives holding the six standing on 2026-09-03 —
 * three of them (`mfa`, `stripe`, `email`) plainly operator-facing and wanting a
 * page, three infrastructure other modules consume, which may honestly document
 * nothing and should then declare `docs: false` rather than carry an entry here.
 * Which of the two each takes is `spec.md` Q3, an open owner question; the ledger
 * is pre-populated either way, so nothing here decides it.
 */
export const MODULES_WITHOUT_DOCUMENTATION: Readonly<Record<string, string>> = {
  admin_notifications:
    'The in-admin notification bell and its per-administrator delivery. Operator-facing and ' +
    'wants a page (spec.md Q3).',
  custom_fields:
    'Runtime custom fields — infrastructure other modules consume rather than a capability an ' +
    'operator configures on its own. A page or `docs: false` is spec.md Q3.',
  email:
    'The outbound mail transport other modules send through. Operator-facing insofar as an ' +
    'operator configures the adapter; wants a page (spec.md Q3).',
  mfa: 'Multi-factor authentication for admin sign-in. Operator-facing and wants a page (spec.md Q3).',
  pim_connector:
    'The mutual-exclusion registry the four PIM connectors register into. Infrastructure; a ' +
    'page or `docs: false` is spec.md Q3.',
  stripe:
    'The Stripe payment gateway. Operator-facing and wants a page (spec.md Q3).',
};

/**
 * Pages the committed navigation does not reach, each with the reason.
 *
 * **Empty**, and that is the state Phase 1 put the tree in rather than a state it
 * found: the generator emits an entry per page, so the eight that stood on
 * 2026-09-03 — `catalog/packaging-units`, `google-analytics`, `ksef`,
 * `newsletter`, `pwa`, `returns`, `shipments`, `transactional-emails` — are all
 * reached by the artefact this check reads. The ledger is kept rather than
 * deleted because the remedy for the next one is a judgement (reach it, or move
 * the page out of `modules/`) and a judgement wants somewhere to be written down.
 *
 * Keyed `<module id>:<page slug>` and never a repository path (R4.1): Phase 2
 * moves 78 pages one module at a time, and a path-keyed entry goes stale on every
 * batch — the shape AGENTS.md records for `module-removal.test.ts`, where the
 * batch that frees an entry is structurally the batch that cannot see it go
 * stale.
 */
export const PAGES_OUTSIDE_THE_NAVIGATION: Readonly<Record<string, string>> = {};

/** One module, as the generated index and its manifest describe it. */
export interface ModuleUnderCheck {
  readonly moduleId: string;
  /** The module's own directory — `dirname(manifestPath)`, absolute. */
  readonly directory: string;
  /** `true` when the manifest declares `docs: false`; `false` when it declares nothing. */
  readonly declaresNoDocs: boolean;
}

export interface ModuleDocsInput {
  readonly modules: readonly ModuleUnderCheck[];
  readonly attribution: DocsAttribution;
  /** Doc ids the **committed** sidebar artefact names. */
  readonly navigationEntries: readonly string[];
  /** Module ids the **committed** module map has a row for. */
  readonly mapRows: readonly string[];
  /**
   * The two ledgers, injected.
   *
   * They default to this file's own and are parameters so a red proof can enter
   * at the top of the analysis (issue #130): both are two-way, so *both*
   * directions of each are predicates, and a proof driving them from the
   * module-level constants could only exercise the direction the real tree
   * happens to be in.
   */
  readonly ledgers?: {
    readonly undocumented?: Readonly<Record<string, string>>;
    readonly orphans?: Readonly<Record<string, string>>;
  };
}

export interface ModuleDocsFinding {
  readonly kind: ModuleDocsFindingKind;
  /** The module it is about, or `null` where the finding is about a page. */
  readonly moduleId: string | null;
  /** The ledger key, so a message and an entry are the same string. */
  readonly key: string;
  readonly detail: string;
}

export interface ModuleDocsResult {
  readonly findings: readonly ModuleDocsFinding[];
  /** Modules whose documentation the walk placed. */
  readonly documented: readonly string[];
  /** Modules that declare `docs: false` and owe nothing. */
  readonly declaringNoDocs: readonly string[];
}

/** `<module id>:<page slug>` — R4.1's key, never a path. */
export function pageKey(moduleId: string, page: DocPage): string {
  return `${moduleId}:${page.docId.slice(`${MODULES_CATEGORY}/`.length)}`;
}

/**
 * The findings, over the four inputs handed in.
 *
 * Pure, so a red proof enters at the top of the analysis (issue #130): the
 * modules the index registers, the pages a walk produced with their front matter,
 * and the two committed artefacts' own entries. A fixture handing in a
 * pre-classified verdict would prove the reporter and leave every predicate
 * unproven, which is the defect the entry for `check-entry-scope` had.
 */
export function checkModuleDocs(input: ModuleDocsInput): ModuleDocsResult {
  const undocumentedLedger = input.ledgers?.undocumented ?? MODULES_WITHOUT_DOCUMENTATION;
  const orphanLedger = input.ledgers?.orphans ?? PAGES_OUTSIDE_THE_NAVIGATION;
  const findings: ModuleDocsFinding[] = [];
  const declaringNoDocs = input.modules
    .filter((module) => module.declaresNoDocs)
    .map((module) => module.moduleId);
  const exempt = new Set(declaringNoDocs);
  const documented = input.attribution.documented.map((entry) => entry.moduleId);
  const documentedSet = new Set(documented);

  // — `undocumented-module`, both directions of its ledger.
  for (const moduleId of input.attribution.undocumented) {
    if (exempt.has(moduleId)) continue;
    if (moduleId in undocumentedLedger) continue;
    findings.push({
      kind: 'undocumented-module',
      moduleId,
      key: moduleId,
      detail:
        'the platform registers this module and no page documents it, so a reader of the ' +
        'site cannot find out what it does',
    });
  }
  for (const moduleId of Object.keys(undocumentedLedger).sort()) {
    if (!documentedSet.has(moduleId) && !exempt.has(moduleId)) continue;
    findings.push({
      kind: 'undocumented-module',
      moduleId,
      key: moduleId,
      detail: exempt.has(moduleId)
        ? 'the module now declares `docs: false`, which is the decision this entry was ' +
          'standing in for — delete the entry from MODULES_WITHOUT_DOCUMENTATION'
        : 'the module now has a page — delete the entry from MODULES_WITHOUT_DOCUMENTATION',
    });
  }

  // — `orphan-page`, against the **committed** artefact's own entries.
  const reached = new Set(input.navigationEntries);
  const orphanKeys = new Set<string>();
  for (const module of input.attribution.documented) {
    for (const page of [module.entry, ...module.children]) {
      if (reached.has(page.docId)) continue;
      const key = pageKey(module.moduleId, page);
      orphanKeys.add(key);
      if (key in orphanLedger) continue;
      findings.push({
        kind: 'orphan-page',
        moduleId: module.moduleId,
        key,
        detail:
          'the page is written and the committed navigation does not reach it, so a reader ' +
          'can only find it by guessing a URL',
      });
    }
  }
  for (const key of Object.keys(orphanLedger).sort()) {
    if (orphanKeys.has(key)) continue;
    findings.push({
      kind: 'orphan-page',
      moduleId: key.split(':')[0] ?? null,
      key,
      detail:
        'the navigation now reaches this page — delete the entry from ' +
        'PAGES_OUTSIDE_THE_NAVIGATION',
    });
  }

  // — `unlocated-page`. No ledger: a page nothing attributes is the state that
  //   produced the eight orphans, and an entry could only license it.
  for (const page of input.attribution.unlocated) {
    findings.push({
      kind: 'unlocated-page',
      moduleId: null,
      key: page.docId,
      detail:
        `the slug \`${page.slug}\` names no registered module and no alias attributes it, so ` +
        'no module map row can carry this page and no module owns it',
    });
  }

  // — `unpaired-index-row`, both directions, no ledger.
  const registered = new Set(input.modules.map((module) => module.moduleId));
  const rows = new Set(input.mapRows);
  for (const moduleId of input.mapRows) {
    if (registered.has(moduleId)) continue;
    findings.push({
      kind: 'unpaired-index-row',
      moduleId,
      key: moduleId,
      detail: 'the committed module map has a row for a module the platform does not register',
    });
  }
  for (const module of input.modules) {
    if (rows.has(module.moduleId)) continue;
    findings.push({
      kind: 'unpaired-index-row',
      moduleId: module.moduleId,
      key: module.moduleId,
      detail: 'the platform registers this module and the committed module map has no row for it',
    });
  }

  // — `stale-page-alias`, the two-way half of the attribution declaration.
  for (const slug of input.attribution.staleAliases) {
    findings.push({
      kind: 'stale-page-alias',
      moduleId: PAGES_ATTRIBUTED_BY_ALIAS[slug]?.moduleId ?? null,
      key: slug,
      detail: 'the alias attributes a page that is not on disk',
    });
  }
  for (const slug of input.attribution.redundantAliases) {
    findings.push({
      kind: 'stale-page-alias',
      moduleId: PAGES_ATTRIBUTED_BY_ALIAS[slug]?.moduleId ?? null,
      key: slug,
      detail:
        'the slug now names its module directly, so the alias attributes nothing the fold ' +
        'would not — delete the entry from PAGES_ATTRIBUTED_BY_ALIAS',
    });
  }

  return { findings, documented, declaringNoDocs };
}

/** The remedy paragraph, one per finding kind. */
const REMEDIES: Readonly<Record<ModuleDocsFindingKind, string>> = {
  'undocumented-module':
    "Write the module's page under the modules category and regenerate " +
    '(`pnpm --filter backend run composer:generate`), or declare `docs: false` in the ' +
    "module's manifest if it genuinely has nothing an operator or a developer needs to read. " +
    'A ledger entry is the third answer and it says why the decision has not been taken yet.',
  'orphan-page':
    'The navigation is generated, so a page it does not reach is a page the generator could ' +
    'not place. Regenerate; if the entry still does not appear, the page belongs to no module ' +
    '— see `unlocated-page`.',
  'unlocated-page':
    'Attribute the page: name it after the module it documents (a hyphenated slug folds to a ' +
    'snake_case id), move it under that module\'s directory, or move it out of the modules ' +
    'category entirely if it is not about a module. Where the slug cannot change yet because ' +
    'its URL is cited, declare the attribution in PAGES_ATTRIBUTED_BY_ALIAS with the reason ' +
    'and the condition that retires it.',
  'unpaired-index-row':
    'The module map is generated from the manifest index. Run ' +
    '`pnpm --filter backend run composer:generate` and commit the artefact.',
  'stale-page-alias':
    'PAGES_ATTRIBUTED_BY_ALIAS (`scripts/lib/module-docs.ts`) is two-way: it holds exactly the ' +
    'pages whose slug does not name their module. Delete the entry the rename retired, or ' +
    'correct the one whose page moved.',
};

interface LoadedModules {
  readonly modules: readonly ModuleUnderCheck[];
  /** The paths the index recorded for what this run read — the freshness input. */
  readonly manifestLocations: readonly string[];
}

async function loadModules(indexPath: string): Promise<LoadedModules> {
  const loaded = (await import(pathToFileURL(indexPath).href)) as {
    DISCOVERED_MANIFESTS?: ReadonlyArray<{
      id: string;
      manifestPath?: string;
      manifest?: { docs?: { dir?: string } | false };
    }>;
  };
  const modules: ModuleUnderCheck[] = [];
  const manifestLocations: string[] = [];
  for (const entry of loaded.DISCOVERED_MANIFESTS ?? []) {
    if (entry.manifestPath === undefined) continue;
    manifestLocations.push(entry.manifestPath);
    modules.push({
      moduleId: entry.id,
      directory: entry.manifestPath.replace(/[/\\][^/\\]*$/, ''),
      declaresNoDocs: entry.manifest?.docs === false,
    });
  }
  return { modules, manifestLocations };
}

/**
 * The doc ids the committed sidebar artefact names.
 *
 * Read as text rather than `require`d, and that is the point: the artefact is
 * what the site loads, so reading it is a **second program's** answer to "which
 * pages does the navigation reach". Evaluating a fresh render instead would make
 * this check agree with the generator by construction, which is precisely what
 * `overlay:check` already measures and what this check exists to be independent
 * of.
 */
export function navigationEntriesIn(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/'(modules\/[A-Za-z0-9_./-]+)'/g)) {
    found.add(match[1]!);
  }
  return [...found].sort();
}

/** The module ids the committed module map has a row for. */
export function mapRowsIn(source: string, registered: readonly string[]): string[] {
  const ids = new Set(registered);
  const found: string[] = [];
  for (const match of source.matchAll(/^\| (?:\[[^\]]*\]\(\.\/([^)]+)\)|`([^`]+)`) \|/gm)) {
    const [, href, literal] = match;
    if (literal !== undefined) {
      found.push(literal);
      continue;
    }
    // A linked row names a page, and the page's slug names the module — folded
    // the same way the walk folds it, then through the alias declaration, so
    // this reader and the attribution cannot disagree about one row.
    const slug = (href ?? '').replace(/\.mdx?$/, '').replace(/\/index$/, '').split('/')[0] ?? '';
    const folded = slug.split('-').join('_');
    if (ids.has(folded)) found.push(folded);
    else {
      const alias = PAGES_ATTRIBUTED_BY_ALIAS[slug];
      if (alias !== undefined) found.push(alias.moduleId);
    }
  }
  return [...new Set(found)].sort();
}

function refuse(message: string): never {
  console.error(`${PREFIX} ${message}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout = await requireModuleLayout(PREFIX);

  let loaded: LoadedModules;
  try {
    loaded = await loadModules(layout.manifestIndexPath);
  } catch (error: unknown) {
    // § 4.1 — the module set is the index's answer, not this check's.
    refuse(
      `the module index at ${layout.manifestIndexPath} could not be read (${String(error)}) — ` +
        'the population is derived from it, so there is nothing to judge; refusing to report ' +
        'a vacuous pass',
    );
  }

  // § 4.2 — issue #215's shared floor, per module and never a count written
  // down. A module the layout cannot place, or places at a directory that is not
  // there, is a module this run reads nothing about; reporting on the rest is
  // reading a residue of the module tree and calling it the tree.
  const byDirectory = new Map(
    [...layout.moduleDirectories].map(([moduleId, directory]) => [directory, moduleId] as const),
  );
  const coverage = await refuseVacuousModulePopulation({
    prefix: PREFIX,
    manifestIndexPath: layout.manifestIndexPath,
    files: [...layout.moduleDirectories]
      .filter(([, directory]) => existsSync(directory))
      .map(([, directory]) => directory),
    moduleIdOf: (path) => byDirectory.get(path) ?? null,
  });

  // § 4.6/4.7 — the manifest half of this run is **imported**, and a module
  // package resolves through its own `exports` map at its build output (D-164),
  // so `docs: false` edited in a package's source and not rebuilt would be read
  // as absent. That is the one thing that could make this check report the
  // defect it exists for as clean, so it is exit 2 and not 1: the tree is not in
  // violation, the run could not see it.
  const freshness = checkEmittedFreshness({
    read: loaded.manifestLocations,
    packages: emittingPackages(layout.repoRoot),
  });
  refuseStaleEmittedArtefacts(PREFIX, freshness, layout.displayOf);

  // The site is resolved **after** the module floor, deliberately. Both are
  // exit 2 and both are honest, but a tree whose modules have moved is the state
  // issue #215 is about, and its refusal names the modules that went missing —
  // so it has to be the one a reader sees. Resolving the site first would answer
  // a moved module tree with "no workspace member holds a Docusaurus
  // configuration", which is true of the fixture and says nothing about the
  // defect.
  let docs: DocsLayout;
  try {
    docs = resolveDocsLayout(layout.repoRoot);
  } catch (error: unknown) {
    if (error instanceof DocsLayoutUnresolvableError) refuse(error.message);
    throw error;
  }

  const pages = collectDocPages(docs.modulesRoot);
  const attribution = attributeDocs(pages, loaded.modules.map((module) => module.moduleId));

  // § 4.4 — the committed sidebar artefact. `orphan-page` compares pages to
  // entries, so zero entries reports every page as an orphan: a finding about
  // the walk dressed as a finding about the tree.
  const sidebarPath = join(docs.member.dir, DOCS_SIDEBAR_ARTEFACT);
  if (!existsSync(sidebarPath)) {
    refuse(
      `the generated sidebar fragment is not at ${sidebarPath} — every page would read as ` +
        'reachable from nothing; run `pnpm --filter backend run composer:generate`',
    );
  }
  const navigationEntries = navigationEntriesIn(readFileSync(sidebarPath, 'utf8'));
  if (navigationEntries.length === 0) {
    refuse(
      `the generated sidebar fragment at ${sidebarPath} names no page — \`orphan-page\` ` +
        'compares pages to entries, and zero entries reports every page as an orphan; ' +
        'refusing to report on a walk instead of on the tree',
    );
  }

  // § 4.5 — the committed module map. `unpaired-index-row` compares two lists,
  // and a missing list makes one direction vacuous.
  const mapPath = join(docs.modulesRoot, MODULE_MAP_ARTEFACT);
  if (!existsSync(mapPath)) {
    refuse(
      `the generated module map is not at ${mapPath} — every registered module would read as ` +
        'unpaired; run `pnpm --filter backend run composer:generate`',
    );
  }
  const mapSource = readFileSync(mapPath, 'utf8');
  const mapRows = mapRowsIn(
    mapSource,
    loaded.modules.map((module) => module.moduleId),
  );
  if (mapRows.length === 0) {
    refuse(
      `the generated module map at ${mapPath} holds no row this check could read — one ` +
        'direction of `unpaired-index-row` would be vacuous and the other would name every ' +
        'registered module',
    );
  }

  // § 4.3 — no page read at all. The one a careless implementation omits: with a
  // conditional obligation, "nobody ships anything" prints `findings=0` honestly.
  if (pages.length === 0) {
    refuse(
      `the modules category at ${docs.modulesRoot} holds no page — every registered module ` +
        'would read as undocumented and no page could be judged; refusing to report a ' +
        'vacuous pass',
    );
  }

  const result = checkModuleDocs({
    modules: loaded.modules,
    attribution,
    navigationEntries,
    mapRows,
  });

  if (listMode) {
    for (const module of loaded.modules) {
      const state = result.declaringNoDocs.includes(module.moduleId)
        ? 'DECLINED'
        : result.documented.includes(module.moduleId)
          ? 'PAGE    '
          : 'NONE    ';
      console.log(`${state} ${module.moduleId}`);
    }
    console.log('');
  }

  // `files` is the markdown this run opened — every page plus the module map —
  // and `sites` the finer population it judged: navigation entries plus map rows.
  // Both, because a widening that moves no file count has to be visible as
  // having moved something (issues #235/#237).
  //
  // `sidebar-entries` is the second author. `manifest-index` is satisfied by a
  // module contributing any file at all and cannot see the artefact going short:
  // its expectation is the modules this walk found documentation for, and its
  // coverage is how many of them the committed artefact actually names.
  // Which artefact the manifest half came from is a fact this line owes its
  // reader. `files` counts the markdown this run opened and says nothing about
  // the manifests, which are imported rather than walked. Omitted — never
  // printed `0/0`, which `read-size.ts` refuses as `no-expectation` — on a tree
  // where every manifest was read from source.
  const emittedManifests: readonly ReadCoverage[] =
    freshness.emitted.length === 0
      ? []
      : [
          {
            source: 'emitted-manifests',
            expected: freshness.emitted.length,
            covered: freshness.compared.length,
          },
        ];
  reportReadSize({
    prefix: PREFIX,
    files: pages.length + 1,
    sites: navigationEntries.length + mapRows.length,
    coverage: [
      coverage,
      {
        // The committed artefact's own entry count — a **second program's**
        // answer, and the only one that can see the artefact going empty:
        // `manifest-index` is satisfied by a module contributing any file at
        // all, so a sidebar rendered to nothing leaves it at full coverage while
        // every page reads as an orphan.
        //
        // Expected and covered are the same number **on purpose**, and the
        // reason is worth stating because the obvious alternative is wrong.
        // Reconciling the artefact against the modules the walk documented
        // measured `64/65` for a sidebar missing exactly one entry — which is
        // `orphan-page`, the finding this check exists for, reported as exit 2:
        // "the run could not see the tree" said of a run that saw it and found
        // the defect. A shortfall that *is* a finding must not also be a
        // refusal. What remains refusable is the empty artefact, which arrives
        // here as `expected = 0` and is what `read-size.ts` calls
        // `no-expectation`.
        source: 'sidebar-entries',
        expected: navigationEntries.length,
        covered: navigationEntries.length,
      },
      ...emittedManifests,
    ],
  });
  console.log(
    `${PREFIX} modules documented=${result.documented.length} ` +
      `declaring none=${result.declaringNoDocs.length} ` +
      `ledgered=${Object.keys(MODULES_WITHOUT_DOCUMENTATION).length} ` +
      `findings=${result.findings.length}`,
  );

  if (result.findings.length === 0) process.exit(0);

  const kinds = [...new Set(result.findings.map((finding) => finding.kind))].sort();
  for (const kind of kinds) {
    console.error(`\n[${kind}]\n${REMEDIES[kind]}\n`);
    for (const finding of result.findings.filter((candidate) => candidate.kind === kind)) {
      console.error(`  - ${finding.key}\n      ${finding.detail}`);
    }
  }
  process.exit(1);
}

// CLI only — importing this module (the companion test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
