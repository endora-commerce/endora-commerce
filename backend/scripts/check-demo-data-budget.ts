/**
 * CI check — **a module's shipped non-`.ts` demo assets stay inside a per-module
 * budget** (`specs/113-module-owned-demo-data/`, FR-016, D-6;
 * `contracts/module-demo-data-layer.md` §7).
 *
 * The owner's concern about feature 113 was **weight**: a demo dataset in every
 * module package is bytes every client installs whether or not they ever seed a
 * demo shop. `research.md` § R2.1 measured the packaging answer to that concern
 * and found it costs more than it saves — 70 demo packages, 537 KB of
 * scaffolding, to avoid shipping 68 KB of data — so the concern gets an
 * instrument instead of a package shape, and this file is the instrument.
 *
 * ## The trigger is a content class, and that is the whole design
 *
 * `research.md` § R2.2, in its own words: *"Today's demo catalogue is generated,
 * not stored: 200 products from a synthesiser, and images as inline
 * `data:image/svg+xml` placeholders built in-process by `productPlaceholderSvg`
 * — deliberately, so re-seeding is stable and offline. A generated catalogue of
 * 10 000 products costs the same bytes as one of 200. **Code does not grow the
 * way the owner is worried about; assets do.**"*
 *
 * So the subject is **non-`.ts` demo assets** and not a byte count over a demo
 * layer, a package or a `dist`. §7.2 says why a package budget is the wrong
 * instrument: it *"would read an unrelated `dist` growth as a demo finding and
 * would say nothing when a module traded 300 KB of code for 300 KB of
 * photographs."* The precedent for the weight class is in the tree —
 * `product_feeds` ships **1.5 MB of `.txt` taxonomy data** under
 * `dist/backend/data/taxonomies/` and 74% of its shipped bytes are that data —
 * and it got there through the same `copy-package-assets.mjs` step a demo
 * dataset with real photographs would use. That directory is **not** a demo
 * layer, so this check says nothing about it, which is the difference between an
 * asset-class budget and a package one.
 *
 * ## What ships is not this check's opinion
 *
 * A file under a module's source tree ships when `classifyAssetFile` says
 * `'asset'` — `scripts/lib/runtime-assets.mjs`, the one owner of that question
 * since D-218, and the same function `copy-package-assets.mjs` and the manifest
 * generator ask. Nothing here holds an extension list (D-100), so a ruling that
 * adds `.jpg` to `RUNTIME_ASSET_EXTENSIONS` puts photographs inside this budget
 * in the same run, with no edit here. Three of its four answers ship nothing and
 * are therefore outside the budget rather than exempt from it: `'ignored'`
 * (`.ts`, `.tsx`, `.md`, `.gitkeep`), `'unclassified'` (an extension nobody has
 * ruled on — `copy-package-assets.mjs` exits 1 on it, so it never reaches a
 * client) and `'fixture'` (a shippable extension in a directory that also holds
 * a test file, which the copy step does not carry).
 *
 * **That last one is worth stating in place, because it looks like a hole.**
 * Every demo layer in this tree holds a `demo.test.ts`, so a `.json` dropped
 * beside it is a `'fixture'` and is budgeted by nothing — correctly, because it
 * ships to nobody and the owner's concern is a client's bytes. D-218 records the
 * cost and the remedy: a real demo asset goes in a directory of its own
 * (`backend/demo/data/`), exactly as `product_feeds` keeps its taxonomies, and
 * the walk below is recursive so that directory is measured.
 *
 * ## The declaration is read where the platform reads it
 *
 * The manifest artefact — `dist/manifest.js` for a module package (D-164) — and
 * as **text through the compiler API**, never `await import`ed. The location of
 * a module's demo layer is then derived from that artefact's own body
 * specifiers: §1.4 requires `seed` and `reset` to be reached by a relative
 * `await import('./backend/demo/seed.js')`, so the directory the platform loads
 * the body from is the directory this check measures. Nothing here spells
 * `backend/demo`, and a module that names its layer differently is followed.
 *
 * The emitted path is mapped back to the source tree through the package's own
 * `tsconfig.build.json` `rootDir`/`outDir` — the same declaration
 * `copy-package-assets.mjs` mirrors — because the source tree is what an author
 * edits and what the copy step carries. A manifest that is its own source (an
 * application-tree module, a fixture) needs no mapping and gets none.
 *
 * ## Findings
 *
 *   * **`demo-assets-over-budget`** — the centre. The message names the module,
 *     the floor, the measured bytes, the assets, and §6's escape hatch by name
 *     (§7.6).
 *   * **`undeclared-demo-assets`** — assets on disk under a demo layer of a
 *     module that declares `demo: false` or nothing. The inverse failure: bytes
 *     every client installs that no runner will ever read. The layer paths it
 *     probes are derived from what the *other* manifests declare, in
 *     `check:bundle-pairing`'s `undeclared-bundle-dir` idiom.
 *   * **`unlocatable-demo-layer`** — a module declares `demo` and the analysis
 *     resolved no layer directory on disk. A **finding, never a skip** (issue
 *     #113): a layer that cannot be located is a layer whose bytes are not
 *     measured, and reading that as "zero bytes" agrees with every defect.
 *   * **`unreadable-demo-declaration`** — a `demo` name in the manifest that
 *     resolves to neither an object literal nor `false`. Also a finding rather
 *     than a skip, and for the sharper reason: read as *absent* it would move
 *     the module into the `undeclared-demo-assets` population, where a correct
 *     demo layer is a violation — so the wrong answer is not merely silent, it
 *     is confidently wrong in the other direction.
 *   * **`stale-budget-entry`**, **`orphan-budget-entry`**,
 *     **`budget-entry-without-a-reason`** — the ledger's two-way half. See
 *     {@link DEMO_ASSETS_OVER_BUDGET}.
 *
 * ## What it deliberately cannot see
 *
 *   * **A demo body that reads an asset from outside its own layer.** The layer
 *     is the manifest's own body specifiers; a `readFileSync` into a sibling
 *     directory is dataflow this analysis does not carry, and a demo dataset
 *     parked in `backend/data/` is `check:module-boundary`'s tree to walk and
 *     nobody's to budget. Stated rather than discovered later.
 *   * **Rows.** A `seed` that writes ten million generated products ships no
 *     bytes and is outside this subject entirely — which is § R2.2's finding
 *     rather than a gap.
 *   * **`dist`.** What ships is decided from the source tree and the classifier
 *     the copy step uses, so an asset hand-placed in a built tree and absent
 *     from `src` is invisible here. It is also gone at the next build.
 *   * **Whether the demo data is any good.** Nothing static can.
 *
 * Usage: `tsx scripts/check-demo-data-budget.ts [--list]`
 * Exit 0 = every module is inside its budget; exit 1 = at least one is not, or
 * the ledger has gone stale; exit 2 = the run could not see the population it
 * judges — see {@link vacuousDemoPopulation} and the five refusals in `main`.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { dirname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import {
  checkEmittedFreshness,
  emittingPackages,
  packageHolding,
  readArtefactOf,
  refuseStaleEmittedArtefacts,
  type EmittingPackage,
} from './lib/emitted-freshness.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';
import { classifyAssetFile } from './lib/runtime-assets.js';
import {
  nodeDemoBudgetFs,
  type DemoBudgetFs,
} from './lib/demo-budget-fs.js';

/** The log prefix this check prints under — one grammar, one spelling. */
export const PREFIX = '[demo-data-budget]';

/**
 * What one module's shipped non-`.ts` demo assets may occupy, in bytes.
 *
 * **256 KB, and the headroom is deliberate** — `check:pdfmake-footprint`'s shape
 * (§7.3): a tripwire against an accident, not a tight budget. The three
 * measurements it sits between, all from `research.md` § R2:
 *
 *   * every module in this tree ships **0 bytes** of non-`.ts` demo asset today,
 *     because the catalogue is generated and its images are inline SVG built in
 *     process;
 *   * the whole demo corpus is **68 KB of source** across the modules that own
 *     demo rows — so 256 KB in *one* module is already far past anything the
 *     current design produces;
 *   * `product_feeds`' **1.5 MB** of bundled `.txt` is the weight class the
 *     owner is worried about, and a module reaching it would trip this floor six
 *     times over.
 *
 * Bump it explicitly when the team accepts a new floor for **every** module, or
 * accept one module's in {@link DEMO_ASSETS_OVER_BUDGET}. Raising it to make a
 * run pass is the thing neither is for.
 */
export const DEMO_ASSET_BUDGET_BYTES = 256 * 1024;

/**
 * Modules whose demo assets exceed {@link DEMO_ASSET_BUDGET_BYTES}, with the
 * floor the team accepted for each and why.
 *
 * **It lands empty, and that is the argument for landing it rather than against
 * it.** The invariant — no module ships a non-`.ts` demo asset at all — is true
 * on the day this check arrives, which is the cheapest possible moment to lock
 * one and the only moment at which a ledger is empty on arrival. A ledger that
 * arrives full is a ledger nobody drains and a number somebody eventually
 * raises; this one has nothing to drain, so the only way an entry appears is
 * that somebody decided to put one there.
 *
 * **What an entry means, for whoever writes the first one.** It is a decision to
 * accept a new floor *for that module* — the team has looked at the bytes, at
 * who installs them, and at §6's escape hatch, and has judged that this module's
 * clients should carry them. It is **not** a way past the check: the entry's
 * `bytes` is still a ceiling, so the module goes red again the moment it grows
 * past what was accepted, and the reason is what a later reader disagrees with.
 * An entry saying "this is not really a demo asset" means the *predicate* has
 * outgrown its population — narrow the predicate, never add the entry.
 *
 * **The trigger is the content class and not a creeping byte count** (T234).
 * Today's catalogue is generated, so its bytes do not creep: a module either
 * ships no asset at all or has taken a decision to ship one. That is why the
 * floor can be generous and the ledger can be empty, and it is why the first
 * entry here will be a genuine product decision rather than the accumulated
 * residue of nobody looking.
 *
 * **Two-way**, in the idiom of every ledger in this estate: an entry naming a
 * module that is inside the shared floor is `stale-budget-entry`, an entry
 * naming a module this run does not see is `orphan-budget-entry`, and an entry
 * with an empty reason is `budget-entry-without-a-reason`.
 */
export const DEMO_ASSETS_OVER_BUDGET: DemoBudgetLedger = {};

/* ------------------------------------------------------------------ types */

export type DemoDataBudgetFindingKind =
  | 'demo-assets-over-budget'
  | 'undeclared-demo-assets'
  | 'unlocatable-demo-layer'
  | 'unreadable-demo-declaration'
  | 'stale-budget-entry'
  | 'orphan-budget-entry'
  | 'budget-entry-without-a-reason';

/** One accepted per-module floor. */
export interface DemoBudgetEntry {
  /** The bytes the team accepted for this module. Still a ceiling. */
  readonly bytes: number;
  /** Why. A sentence a later reader can disagree with; never "accepted". */
  readonly reason: string;
}

export type DemoBudgetLedger = Readonly<Record<string, DemoBudgetEntry>>;

/** A package's `tsconfig.build.json` emit layout, package-relative. */
export interface EmitDirectories {
  readonly rootDir: string;
  readonly outDir: string;
}

/** One registered module, as the generated index and its package describe it. */
export interface ModuleUnderCheck {
  readonly moduleId: string;
  /**
   * The manifest artefact the platform loads, absolute — `dist/manifest.js` for
   * a module package, the source manifest for a module that does not emit.
   */
  readonly manifestPath: string;
  /** The directory {@link EmitDirectories} is relative to, absolute. */
  readonly packageRoot: string;
  /** `null` when the manifest is its own source and needs no mapping. */
  readonly emit: EmitDirectories | null;
}

/** What a module's manifest says about demo data. */
export type DemoDeclarationState = 'declared' | 'declined' | 'absent' | 'unreadable';

export interface DemoDeclaration {
  readonly state: DemoDeclarationState;
  /** Relative specifiers the `seed`/`reset` bodies are reached by (§1.4). */
  readonly specifiers: readonly string[];
  /** `demo.package` — the escape hatch (§6), a package name as a string. */
  readonly packageName: string | null;
}

/** One shipped non-`.ts` demo asset. */
export interface DemoAsset {
  readonly moduleId: string;
  /** Absolute path in the source tree. */
  readonly path: string;
  readonly bytes: number;
}

export interface DemoDataBudgetFinding {
  readonly kind: DemoDataBudgetFindingKind;
  readonly moduleId: string;
  /** The file or directory it names, absolute; `null` for a ledger finding. */
  readonly path: string | null;
  /** The sentence the author reads, without the shared remedy. */
  readonly detail: string;
}

export interface DemoDataBudgetInput {
  readonly modules: readonly ModuleUnderCheck[];
  readonly budgetBytes: number;
  readonly ledger?: DemoBudgetLedger;
  readonly fs?: DemoBudgetFs;
}

export interface DemoDataBudgetResult {
  readonly findings: readonly DemoDataBudgetFinding[];
  /** Every file the demo-layer walk enumerated — the read line's `files`. */
  readonly filesRead: readonly string[];
  /** Every shipped asset classified — the read line's `sites`. */
  readonly assets: readonly DemoAsset[];
  /** Modules declaring a `demo` object. */
  readonly declaring: readonly string[];
  /** Modules declaring `demo: false`. */
  readonly declining: readonly string[];
  /** Modules whose manifest says nothing about demo data. */
  readonly undecided: readonly string[];
  /** Modules that named a package in `demo.package` (§6). */
  readonly delegated: readonly string[];
  /**
   * Declaring, non-delegating modules whose demo layer the walk found on disk.
   *
   * The `read:` line's second author: the expectation comes from the artefacts
   * the platform loads and the coverage from the filesystem, so a demo layer
   * that moved is a short walk rather than a clean line.
   */
  readonly layersLocated: number;
  /** Demo-layer paths, module-source-root-relative — the probe vocabulary. */
  readonly layerPaths: readonly string[];
  /** Shipped asset bytes per module, for the `--list` mode and the report. */
  readonly bytesByModule: ReadonlyMap<string, number>;
}

/* --------------------------------------------------- reading a declaration */

const asName = (node: ts.PropertyName | ts.BindingName | undefined): string | null =>
  node !== undefined && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : null;

const propertyOf = (
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined =>
  object.properties.find(
    (member): member is ts.PropertyAssignment =>
      ts.isPropertyAssignment(member) && asName(member.name) === name,
  )?.initializer;

/** Every relative `import('./…')` specifier inside `node`, in source order. */
function relativeImportSpecifiers(node: ts.Node): string[] {
  const found: string[] = [];
  const visit = (child: ts.Node): void => {
    if (
      ts.isCallExpression(child) &&
      child.expression.kind === ts.SyntaxKind.ImportKeyword &&
      child.arguments[0] !== undefined &&
      ts.isStringLiteralLike(child.arguments[0])
    ) {
      const text = child.arguments[0].text;
      if (text.startsWith('.')) found.push(text);
    }
    child.forEachChild(visit);
  };
  visit(node);
  return found;
}

/**
 * What a manifest says about demo data, from its own text.
 *
 * Exported because a red proof enters here — source text is the top of this
 * analysis for every finding that turns on the declaration, and a fixture
 * handing in a pre-classified state would prove the reporter and leave the
 * reader unproven (issue #130).
 *
 * **It resolves a shorthand property**, because that is what the emitted
 * artefact writes: `const demo = { … }` at file scope and a bare `demo,` inside
 * the `defineModuleManifest({ … })` call. A reader that only looked for
 * `demo: <object>` would answer `absent` for every module in this tree.
 */
export function readDemoDeclaration(text: string, fileName: string): DemoDeclaration {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);

  // Collected rather than narrowed into a captured `let`: a `let` assigned only
  // inside the visitor is narrowed to `null` by control-flow analysis, and every
  // branch below it then reads as unreachable.
  const fromDeclaration: ts.Expression[] = [];
  const fromProperty: ts.Expression[] = [];
  let named = false;

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && asName(node.name) === 'demo') {
      named = true;
      if (node.initializer !== undefined) fromDeclaration.push(node.initializer);
    }
    if (ts.isPropertyAssignment(node) && asName(node.name) === 'demo') {
      named = true;
      fromProperty.push(node.initializer);
    }
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'demo') named = true;
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);

  if (!named) return { state: 'absent', specifiers: [], packageName: null };

  // A property assignment wins over a file-scope `const` of the same name: it is
  // the value the manifest object actually carries. A shorthand `demo,` carries
  // no initializer of its own, so the `const` is what it resolves to — which is
  // the shape every emitted manifest in this tree writes.
  const resolved = fromProperty[0] ?? fromDeclaration[0];
  if (resolved === undefined) {
    return { state: 'unreadable', specifiers: [], packageName: null };
  }
  if (resolved.kind === ts.SyntaxKind.FalseKeyword) {
    return { state: 'declined', specifiers: [], packageName: null };
  }
  if (!ts.isObjectLiteralExpression(resolved)) {
    return { state: 'unreadable', specifiers: [], packageName: null };
  }

  const declaredPackage = propertyOf(resolved, 'package');
  return {
    state: 'declared',
    specifiers: [...new Set(relativeImportSpecifiers(resolved))].sort(),
    packageName:
      declaredPackage !== undefined && ts.isStringLiteralLike(declaredPackage)
        ? declaredPackage.text
        : null,
  };
}

/* ------------------------------------------------------ locating the layer */

const toPosix = (path: string): string => (sep === '/' ? path : path.split(sep).join('/'));

/**
 * `<pkg>/dist/backend/demo/seed.js` → `<pkg>/src/backend/demo/seed.ts`, or the
 * path itself where the manifest is its own source and there is nothing to map.
 *
 * The mapping is the package's own `tsconfig.build.json` declaration — the same
 * `rootDir`/`outDir` pair `copy-package-assets.mjs` mirrors — so this check and
 * the build step cannot come to disagree about where a source becomes an
 * artefact, and neither `dist` nor `src` is written down here (D-100).
 */
function sourceCounterpartOf(module: ModuleUnderCheck, emitted: string): string {
  if (module.emit === null) return emitted;
  const within = toPosix(relative(module.packageRoot, emitted));
  const out = module.emit.outDir;
  if (out === '' || !(within === out || within.startsWith(`${out}/`))) return emitted;
  const belowOut = out === '' ? within : within.slice(out.length + 1);
  const rooted = module.emit.rootDir === '' ? belowOut : `${module.emit.rootDir}/${belowOut}`;
  return join(module.packageRoot, ...rooted.split('/'));
}

/**
 * The directories a module's demo bodies are loaded from, in the source tree.
 *
 * Derived from the manifest artefact's own relative specifiers (§1.4) and the
 * package's own emit layout — no directory name is written down here (D-100),
 * so a module that calls its layer something else is followed and the first one
 * that does costs no edit.
 */
export function demoLayerDirectories(
  module: ModuleUnderCheck,
  declaration: DemoDeclaration,
): readonly string[] {
  const manifestDir = dirname(module.manifestPath);
  const directories = declaration.specifiers.map((specifier) =>
    dirname(sourceCounterpartOf(module, join(manifestDir, ...specifier.split('/')))),
  );
  return [...new Set(directories)].sort();
}

/** The module's own source root — where a layer path is relative to. */
function sourceRootOf(module: ModuleUnderCheck): string {
  if (module.emit === null || module.emit.rootDir === '') return module.packageRoot;
  return join(module.packageRoot, ...module.emit.rootDir.split('/'));
}

/* ----------------------------------------------------------- the walk */

interface WalkedFile {
  readonly path: string;
  readonly classification: ReturnType<typeof classifyAssetFile>;
  readonly bytes: number;
}

/** Every file under `dir`, classified by the one owner of "does this ship". */
function walkLayer(dir: string, fs: DemoBudgetFs, out: WalkedFile[] = []): WalkedFile[] {
  const entries = fs.readDirectory(dir);
  if (entries === null) return out;
  const siblings = entries.filter((entry) => entry.isFile).map((entry) => entry.name);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory) {
      walkLayer(full, fs, out);
      continue;
    }
    if (!entry.isFile) continue;
    out.push({
      path: full,
      classification: classifyAssetFile(entry.name, siblings),
      bytes: fs.sizeOf(full) ?? 0,
    });
  }
  return out;
}

const humanBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : bytes >= 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${bytes} B`;

/* ------------------------------------------------------------- the analysis */

/**
 * The findings, over the modules handed in.
 *
 * Pure but for the injected reader, so a red proof enters where a real run
 * enters: a module tree on disk plus the index's own answer about which modules
 * exist (issue #130). A fixture handing in per-module byte counts would prove
 * the arithmetic and leave the locating, the classification and the probe —
 * which is all of the analysis — unproven.
 */
export function checkDemoDataBudget(input: DemoDataBudgetInput): DemoDataBudgetResult {
  const fs = input.fs ?? nodeDemoBudgetFs;
  const ledger = input.ledger ?? {};
  const findings: DemoDataBudgetFinding[] = [];
  const filesRead: string[] = [];
  const assets: DemoAsset[] = [];
  const declaring: string[] = [];
  const declining: string[] = [];
  const undecided: string[] = [];
  const delegated: string[] = [];
  const bytesByModule = new Map<string, number>();
  const layerPaths = new Set<string>();
  let layersLocated = 0;

  const declarations = new Map<string, DemoDeclaration>();
  for (const module of input.modules) {
    const text = fs.readFile(module.manifestPath);
    declarations.set(
      module.moduleId,
      text === null
        ? { state: 'unreadable', specifiers: [], packageName: null }
        : readDemoDeclaration(text, module.manifestPath),
    );
  }

  // Pass one — the declaring modules. Their own layers are measured, and the
  // paths they use become the vocabulary pass two probes with.
  for (const module of input.modules) {
    const declaration = declarations.get(module.moduleId)!;
    if (declaration.state === 'unreadable') {
      findings.push({
        kind: 'unreadable-demo-declaration',
        moduleId: module.moduleId,
        path: module.manifestPath,
        detail:
          'the manifest names `demo` and this run could not resolve it to an object literal ' +
          'or to `false`, so whether this module ships demo assets is undecided — and an ' +
          'undecided module read as "declares nothing" would have its correct demo layer ' +
          'reported as undeclared assets',
      });
      continue;
    }
    if (declaration.state === 'declined') {
      declining.push(module.moduleId);
      continue;
    }
    if (declaration.state === 'absent') {
      undecided.push(module.moduleId);
      continue;
    }

    declaring.push(module.moduleId);
    if (declaration.packageName !== null) delegated.push(module.moduleId);

    const sourceRoot = sourceRootOf(module);
    const directories = demoLayerDirectories(module, declaration).filter((directory) =>
      fs.isDirectory(directory),
    );
    for (const directory of directories) {
      layerPaths.add(toPosix(relative(sourceRoot, directory)));
    }

    if (directories.length === 0) {
      if (declaration.packageName !== null) {
        // §6: the demo data is the named package's. Nothing local to measure,
        // and nothing to report — the module ships no demo asset of its own.
        continue;
      }
      findings.push({
        kind: 'unlocatable-demo-layer',
        moduleId: module.moduleId,
        path: module.manifestPath,
        detail:
          declaration.specifiers.length === 0
            ? 'the `demo` declaration carries no relative `await import()` specifier, so ' +
              'there is no directory to measure. Contract §1.4 requires the bodies to be ' +
              'reached by one'
            : `the declaration reaches ${declaration.specifiers.join(', ')} and no directory ` +
              'behind those specifiers is on disk, so this module\'s demo assets are not ' +
              'measured by anything',
      });
      continue;
    }

    layersLocated += 1;
    let bytes = 0;
    for (const directory of directories) {
      for (const file of walkLayer(directory, fs)) {
        filesRead.push(file.path);
        if (file.classification !== 'asset') continue;
        assets.push({ moduleId: module.moduleId, path: file.path, bytes: file.bytes });
        bytes += file.bytes;
      }
    }
    bytesByModule.set(module.moduleId, bytes);

    const accepted = ledger[module.moduleId];
    const ceiling = accepted === undefined ? input.budgetBytes : accepted.bytes;
    if (bytes > ceiling) {
      findings.push({
        kind: 'demo-assets-over-budget',
        moduleId: module.moduleId,
        path: directories[0] ?? module.manifestPath,
        detail:
          `ships ${humanBytes(bytes)} of non-\`.ts\` demo assets in ` +
          `${assets.filter((asset) => asset.moduleId === module.moduleId).length} file(s), ` +
          `over the ${accepted === undefined ? 'per-module floor' : 'floor accepted for this module'} ` +
          `of ${humanBytes(ceiling)}`,
      });
    }
  }

  // Pass two — the inverse failure. A module that declares `demo: false` or
  // nothing, with shippable assets sitting under a directory the *declaring*
  // modules use as their layer: bytes every client installs and no runner reads.
  // The vocabulary is derived from pass one, never a literal — a check that
  // spelled `backend/demo` would answer for one convention and go quiet for the
  // next (`check:bundle-pairing`'s `undeclared-bundle-dir` reasoning).
  const probes = [...layerPaths].sort();
  for (const module of input.modules) {
    const declaration = declarations.get(module.moduleId)!;
    if (declaration.state !== 'declined' && declaration.state !== 'absent') continue;
    const sourceRoot = sourceRootOf(module);
    for (const probe of probes) {
      const directory = join(sourceRoot, ...probe.split('/'));
      if (!fs.isDirectory(directory)) continue;
      const found: DemoAsset[] = [];
      for (const file of walkLayer(directory, fs)) {
        filesRead.push(file.path);
        if (file.classification !== 'asset') continue;
        found.push({ moduleId: module.moduleId, path: file.path, bytes: file.bytes });
      }
      if (found.length === 0) continue;
      assets.push(...found);
      const bytes = found.reduce((total, asset) => total + asset.bytes, 0);
      bytesByModule.set(module.moduleId, (bytesByModule.get(module.moduleId) ?? 0) + bytes);
      findings.push({
        kind: 'undeclared-demo-assets',
        moduleId: module.moduleId,
        path: directory,
        detail:
          `${humanBytes(bytes)} of shippable asset(s) sit under a demo layer while the ` +
          `manifest declares \`demo: ${declaration.state === 'declined' ? 'false' : '<nothing>'}\`, ` +
          'so every client installs them and no demo run will ever read them',
      });
    }
  }

  // The ledger's two-way half.
  const seen = new Set(input.modules.map((module) => module.moduleId));
  for (const [moduleId, entry] of Object.entries(ledger)) {
    if (!seen.has(moduleId)) {
      findings.push({
        kind: 'orphan-budget-entry',
        moduleId,
        path: null,
        detail:
          'the ledger accepts a floor for a module this run does not see — it is not ' +
          'registered, or its id changed. Delete the entry',
      });
      continue;
    }
    if (entry.reason.trim() === '') {
      findings.push({
        kind: 'budget-entry-without-a-reason',
        moduleId,
        path: null,
        detail:
          'an accepted floor with no reason is a number nobody can disagree with. Say what ' +
          'the bytes are and who carries them',
      });
    }
    const measured = bytesByModule.get(moduleId) ?? 0;
    if (measured <= input.budgetBytes) {
      findings.push({
        kind: 'stale-budget-entry',
        moduleId,
        path: null,
        detail:
          `the ledger accepts ${humanBytes(entry.bytes)} for this module and it ships ` +
          `${humanBytes(measured)}, inside the shared floor of ` +
          `${humanBytes(input.budgetBytes)} — the entry describes nothing. Delete it`,
      });
    }
  }

  return {
    findings,
    filesRead,
    assets,
    declaring: declaring.sort(),
    declining: declining.sort(),
    undecided: undecided.sort(),
    delegated: delegated.sort(),
    layersLocated,
    layerPaths: probes,
    bytesByModule,
  };
}

/** The remedy paragraph, one per finding kind. */
export const REMEDIES: Readonly<Record<DemoDataBudgetFindingKind, string>> = {
  'demo-assets-over-budget':
    'The remedy is contract §6, the escape hatch: move this module\'s demo data into a ' +
    'package of its own and name that package in `demo.package` — a package **name as a ' +
    'string**, never an `import` specifier, because the manifest generator derives peers ' +
    'from every specifier it finds and would make the demo package a required peer that ' +
    'pnpm installs for every client (§6.2). A client who wants the demo installs the ' +
    'package; everyone else installs nothing. If the bytes genuinely belong in this ' +
    'package, accept the floor in `DEMO_ASSETS_OVER_BUDGET` with a reason — never by ' +
    'raising `DEMO_ASSET_BUDGET_BYTES`, which accepts it for every module at once.',
  'undeclared-demo-assets':
    'Either declare the demo data — a `demo` object in the module manifest, so a demo run ' +
    'reads these bytes — or delete them. A shippable asset under a demo layer that no ' +
    'declaration reaches is installed by every client and read by nobody.',
  'unlocatable-demo-layer':
    'Contract §1.4: `seed` and `reset` are reached by a relative `await import()` from the ' +
    'declaration, and that specifier is what locates the layer. Check the package is built ' +
    '(`pnpm run build:packages`) and that the body is where the specifier says.',
  'unreadable-demo-declaration':
    'Write the declaration as a typed `const demo: ModuleDemoManifest<ModuleContext> = { … }` ' +
    'passed to `defineModuleManifest`, or as `demo: false`. A computed value cannot be read ' +
    'by anything static, and the platform\'s own schema is the only other reader.',
  'stale-budget-entry':
    'Delete the entry. A ledger entry that describes nothing is the state every two-way ' +
    'ratchet in this estate exists to refuse.',
  'orphan-budget-entry':
    'Delete the entry, or correct the module id. An entry over a module nothing registers ' +
    'is never checked against anything.',
  'budget-entry-without-a-reason':
    'Write the reason. An accepted floor is a decision, and a decision with no sentence is ' +
    'one nobody can review.',
};

/* ------------------------------------------------------------- the refusals */

/**
 * Why this run may not report on the demo population, or `null`.
 *
 * Pure over the record, so a red proof enters at the top (issue #130). It is the
 * refusal `read-size.ts` cannot make: with a **conditional** predicate — the
 * obligation attaches to the first module that declares demo data — "no module
 * declares any" is *vacuously clean*, and a check that reported it as a pass
 * would be exactly the green that means "not looking" (issue #113).
 *
 * The state is reachable and is not hypothetical: this check is useless before
 * `specs/113-module-owned-demo-data/`'s Phase 2, whose whole subject is moving
 * the declarations into the modules.
 */
export function vacuousDemoPopulation(result: {
  readonly declaring: readonly string[];
  readonly delegated: readonly string[];
}): string | null {
  if (result.declaring.length === 0) {
    return (
      'no registered module declares demo data at all, so the budget binds nothing and ' +
      'every module is vacuously inside it — refusing to report a vacuous pass'
    );
  }
  // `> 0` is load-bearing rather than defensive: with both counts at zero the
  // equality is true, so this clause would answer for the state the clause above
  // exists to answer — two refusals sharing one truth, and the second one's
  // sentence describing a tree that is not the one in front of it.
  if (result.declaring.length > 0 && result.declaring.length === result.delegated.length) {
    return (
      `all ${result.declaring.length} declaring module(s) name a package in \`demo.package\`, ` +
      'so no demo layer in this tree is measured and the budget binds nothing here — ' +
      'refusing to report a vacuous pass'
    );
  }
  return null;
}

/* ---------------------------------------------------------------- the host */

/** The modules this run judges, and the artefact locations freshness reads. */
interface LoadedModules {
  readonly modules: readonly ModuleUnderCheck[];
  readonly manifestLocations: readonly string[];
}

async function loadModules(
  indexPath: string,
  packages: readonly EmittingPackage[],
): Promise<LoadedModules> {
  const loaded = (await import(pathToFileURL(indexPath).href)) as {
    DISCOVERED_MANIFESTS?: ReadonlyArray<{ id: string; manifestPath?: string }>;
  };
  const modules: ModuleUnderCheck[] = [];
  const manifestLocations: string[] = [];
  for (const entry of loaded.DISCOVERED_MANIFESTS ?? []) {
    if (entry.manifestPath === undefined) continue;
    manifestLocations.push(entry.manifestPath);
    const artefact = readArtefactOf(entry.manifestPath, packages);
    const owner = packageHolding(artefact, packages);
    modules.push({
      moduleId: entry.id,
      manifestPath: artefact,
      packageRoot: owner?.dir ?? dirname(artefact),
      emit: owner?.emit ?? null,
    });
  }
  return { modules, manifestLocations };
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout = await requireModuleLayout(PREFIX);
  const packages = emittingPackages(layout.repoRoot);

  let loaded: LoadedModules;
  try {
    loaded = await loadModules(layout.manifestIndexPath, packages);
  } catch (error: unknown) {
    // Refusal 1 — the module set is the index's answer, not this check's.
    console.error(
      `${PREFIX} the module index at ${layout.manifestIndexPath} could not be read ` +
        `(${String(error)}) — the population is derived from it, so there is nothing to ` +
        'judge; refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  // Refusal 2 — issue #215's shared floor, in `check:bundle-pairing`'s
  // conjunction: the layout must *place* each registered module (which sees the
  // half-moved tree) and the directory must be there (which sees the moved one).
  const byDirectory = new Map(
    [...layout.moduleDirectories].map(([moduleId, directory]) => [directory, moduleId] as const),
  );
  const directories = [...layout.moduleDirectories]
    .filter(([, directory]) => nodeDemoBudgetFs.isDirectory(directory))
    .map(([, directory]) => directory);
  const coverage = await refuseVacuousModulePopulation({
    prefix: PREFIX,
    manifestIndexPath: layout.manifestIndexPath,
    files: directories,
    moduleIdOf: (path) => byDirectory.get(path) ?? null,
  });

  // Refusal 3 — the declaration is read out of an artefact a module package
  // resolves at its build output (D-164), so an author who edited
  // `src/manifest.ts` and did not rebuild would be answered about the previous
  // build. Exit 2 rather than 1: the tree is not in violation, the run could not
  // see it.
  const freshness = checkEmittedFreshness({ read: loaded.manifestLocations, packages });
  refuseStaleEmittedArtefacts(PREFIX, freshness, layout.displayOf);

  const result = checkDemoDataBudget({
    modules: loaded.modules,
    budgetBytes: DEMO_ASSET_BUDGET_BYTES,
    ledger: DEMO_ASSETS_OVER_BUDGET,
  });

  // Refusal 4 — the conditional predicate's vacuously-clean state.
  const vacuous = vacuousDemoPopulation(result);
  if (vacuous !== null) {
    console.error(`${PREFIX} ${vacuous}`);
    process.exit(2);
  }

  if (listMode) {
    for (const moduleId of result.declaring) {
      const bytes = result.bytesByModule.get(moduleId) ?? 0;
      const state = result.delegated.includes(moduleId) ? 'PACKAGE' : 'LOCAL  ';
      console.log(`${state} ${moduleId.padEnd(24)} assets=${humanBytes(bytes)}`);
    }
    console.log(
      `DECLINED ${result.declining.length}  UNDECIDED ${result.undecided.length}  ` +
        `layer paths: ${result.layerPaths.join(', ') || '(none)'}\n`,
    );
  }

  // Refusal 5 — the walk opened no demo file at all, which `read-size.ts`
  // refuses as `read-nothing`, plus the second author's short walk.
  //
  // **`sites` is legitimately zero and `files` is not**, and the two must not be
  // confused: `sites` counts the shipped assets, and *zero shipped assets is the
  // invariant this check locks*, so refusing on it would refuse every correct
  // tree. `files` counts what the demo-layer walk enumerated — 32 files across
  // eight layers on the tree this landed against — and a zero there is the walk
  // having gone blind while the manifests still declare eight layers.
  reportReadSize({
    prefix: PREFIX,
    files: result.filesRead.length,
    sites: result.assets.length,
    coverage: [
      coverage,
      {
        source: 'demo-declarations',
        expected: result.declaring.length - result.delegated.length,
        covered: result.layersLocated,
      },
      ...(freshness.emitted.length === 0
        ? []
        : [
            {
              source: 'emitted-manifests',
              expected: freshness.emitted.length,
              covered: freshness.compared.length,
            },
          ]),
    ],
  });
  console.log(
    `${PREFIX} declaring=${result.declaring.length} declining=${result.declining.length} ` +
      `undecided=${result.undecided.length} assets=${result.assets.length} ` +
      `bytes=${humanBytes([...result.bytesByModule.values()].reduce((a, b) => a + b, 0))} ` +
      `floor=${humanBytes(DEMO_ASSET_BUDGET_BYTES)} ` +
      `ledger-size=${Object.keys(DEMO_ASSETS_OVER_BUDGET).length} ` +
      `findings=${result.findings.length}`,
  );

  if (result.findings.length === 0) process.exit(0);

  const kinds = [...new Set(result.findings.map((finding) => finding.kind))].sort();
  for (const kind of kinds) {
    console.error(`\n[${kind}]\n${REMEDIES[kind]}\n`);
    for (const finding of result.findings.filter((candidate) => candidate.kind === kind)) {
      const where = finding.path === null ? '' : ` ${layout.displayOf(finding.path)}`;
      console.error(`  - ${finding.moduleId}:${where}\n      ${finding.detail}`);
    }
  }
  process.exit(1);
}

// CLI only — importing this module (the companion test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
