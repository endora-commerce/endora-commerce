/**
 * CI check — **a module that ships a bundle in any language ships one in every
 * language the platform ships** (`specs/094-translation-boundary/`,
 * `contracts/bundle-pairing-ratchet.md`).
 *
 * The owner's ruling of 2026-09-01, third surface: every module Endora
 * implements ships an `en` bundle and a `pl` bundle, English being the default
 * and the runtime fallback. It lands at **zero violations** — 62 of the 69
 * registered modules ship both, 7 ship neither, none ships exactly one — and
 * that is the argument for landing it, not against: the invariant is true today
 * and nothing holds it there.
 *
 * ## The predicate is a conditional, and that is the whole design
 *
 * Not *"every module ships `pl.json`"*. Seven registered modules legitimately
 * ship no bundle at all — a module with no user-facing strings owes none, and
 * demanding one would produce seven empty files whose only effect is to make
 * this check pass. The obligation attaches to the **first** bundle: once a
 * module has strings, it has them in every shipped language.
 *
 * ## What already looks like the enforcer and is not
 *
 * `test/unit/_i18n/registered-bundles-shape.test.ts` is the file that appears to
 * answer this, and it misses it twice — both times because the population is
 * derived from the artefact under judgement, which is the family this repository
 * spends its review effort on (issues #113, #244, #215):
 *
 *   * its symmetry case read `if (!en || !pl) continue;`, so a module that drops
 *     `pl.json` was **skipped by the test whose subject is bundle symmetry**.
 *     That line is deleted in the merge request this check lands in: pairing is
 *     the precondition it rests on, and a skip whose reason has gone is worse
 *     than no skip at all;
 *   * its action-key case iterates `loaded.byLanguage` — the languages *that
 *     module happens to ship*. "Every shipped language" silently means the
 *     module's rather than the platform's, and the two readings are
 *     indistinguishable in prose.
 *
 * Neither is a bug in that file. It was written to answer key-level symmetry and
 * it answers it; nothing answered file-level presence. This check is that, and
 * it deliberately does **not** judge key-level symmetry — one rule, one
 * instrument.
 *
 * ## The two derived sets
 *
 * **The languages** come from `SUPPORTED_LANGUAGES`, never from a literal list
 * here (D-100). A third shipped language makes every two-bundle module a finding
 * in the same run, which is the point of deriving it.
 *
 * **The modules** come from the generated manifest index, through
 * `lib/module-roots.ts` and `lib/module-population.ts`, so a module that became a
 * package is followed rather than dropped (issue #215). Each module's own
 * directory is `dirname(manifestPath)` — the anchor the `_i18n` boot reconciler
 * joins `bundlesDir` to, so this check reads the bundles the running platform
 * reads and not a directory computed from a convention.
 *
 * **And the probe directory name is derived too.** A module that declares
 * `i18n.bundlesDir` is read there. A module that declares none is probed at every
 * directory name the *other* manifests declare — `i18n` today, whatever a module
 * calls it tomorrow — because `undeclared-bundle-dir` is a finding about files
 * that exist and are never read, and a check that spelled `'i18n'` into itself
 * would answer for one convention and go quiet for the next.
 *
 * ## Findings
 *
 *   * **`missing-language-bundle`** — a module shipping a bundle in one shipped
 *     language and not another. The centre.
 *   * **`empty-bundle`** — a bundle that parses to zero entries. It satisfies a
 *     presence test while translating nothing: the way around this check that
 *     would otherwise be one `echo '{}' >` away.
 *   * **`unparseable-bundle`** — a bundle that is not readable as
 *     `TranslationBundleEntriesSchema`. A **finding, not a skip**: the boot
 *     reconciler logs and skips it and the module renders raw keys, so a check
 *     that also skipped it would agree with the defect (issue #113).
 *   * **`undeclared-bundle-dir`** — bundle files on disk under a module whose
 *     manifest declares no `i18n.bundlesDir`, so nothing loads them. The inverse
 *     failure, and the pairing predicate still applies to what was found.
 *
 * **No ledger, deliberately.** Every finding is a module one file away from
 * compliance, the remedy is available in the same merge request, and the
 * population stands at zero. An entry could only license shipping a
 * single-language module, which is the thing the ruling forbids.
 *
 * ## What it does not cover, stated rather than discovered later
 *
 *   * **Key-level symmetry** between `en.json` and `pl.json` — that is
 *     `registered-bundles-shape.test.ts`' subject, and this check is the
 *     precondition it was missing.
 *   * **Whether a Polish sentence is a faithful translation.** Nothing static
 *     can.
 *   * **A bundle file named for a language the platform does not ship**
 *     (`de.json`). The loader throws `unsupported-language-file` on it at boot;
 *     it is out of this predicate's population and is not read.
 *   * **The storefront**, which has no module bundles: `MessageKey` is a closed
 *     union in one in-tree file and `Record<MessageKey, string>` is total, so
 *     `tsc` refuses a missing Polish string at compile time — stronger than any
 *     check here could be.
 *
 * Usage: `tsx scripts/check-bundle-pairing.ts [--list]`
 * Exit 0 = every module that ships a bundle ships all of them; exit 1 = at least
 * one does not; exit 2 = the run could not see the population it judges —
 * no shipped language, no registered module, a module walk that came back short,
 * no bundle read at all, or a manifest artefact its source has outrun.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { SUPPORTED_LANGUAGES, TranslationBundleEntriesSchema } from '@endora-commerce/contracts';

import {
  checkEmittedFreshness,
  emittingPackages,
  refuseStaleEmittedArtefacts,
} from './lib/emitted-freshness.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

const PREFIX = '[bundle-pairing]';

export type BundlePairingFindingKind =
  | 'missing-language-bundle'
  | 'empty-bundle'
  | 'unparseable-bundle'
  | 'undeclared-bundle-dir';

/** One registered module, as the generated index and its manifest describe it. */
export interface ModuleUnderCheck {
  readonly moduleId: string;
  /** The module's own directory — `dirname(manifestPath)`, absolute. */
  readonly directory: string;
  /** `i18n.bundlesDir` from the manifest, or `null` when it declares none. */
  readonly bundlesDir: string | null;
}

/**
 * The filesystem, injected.
 *
 * Not for the red proofs — those build a fixture module tree on disk and use the
 * real one, because a fixture that hands in a reader proves the classifier and
 * leaves the walk that feeds it unproven. It exists so a caller measuring a tree
 * it does not own can supply its own reader without this file learning about it.
 */
export interface BundlePairingFs {
  readonly isDirectory: (path: string) => boolean;
  readonly isFile: (path: string) => boolean;
  readonly readFile: (path: string) => string;
}

export const nodeBundlePairingFs: BundlePairingFs = {
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  isFile: (path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
  readFile: (path) => readFileSync(path, 'utf8'),
};

export interface BundlePairingInput {
  readonly modules: readonly ModuleUnderCheck[];
  /** The platform's shipped languages — `SUPPORTED_LANGUAGES` in a real run. */
  readonly languages: readonly string[];
  readonly fs?: BundlePairingFs;
}

export interface BundlePairingFinding {
  readonly kind: BundlePairingFindingKind;
  readonly moduleId: string;
  /** The language it is about, or `null` where the finding is about the module. */
  readonly language: string | null;
  /** The file or directory it names, absolute. */
  readonly path: string;
  /** The sentence the author reads, without the shared remedy. */
  readonly detail: string;
}

export interface BundlePairingResult {
  readonly findings: readonly BundlePairingFinding[];
  /** Every bundle file opened — the read line's `files`. */
  readonly filesRead: readonly string[];
  /** Every module classified — the read line's `sites`. */
  readonly classified: readonly string[];
  /** Modules shipping at least one bundle: the ones the predicate binds. */
  readonly shipping: readonly string[];
  /** Modules shipping none: exempt by § 1's conditional, and reported clean. */
  readonly shippingNothing: readonly string[];
  /**
   * How many shipped languages the walk actually probed for — `0` when no module
   * shipped anything at all, which is the vacuous state § 4's fourth condition
   * refuses. It is deliberately *not* "languages a bundle was found in": every
   * module dropping `pl` is a run of findings, not a run that read nothing.
   */
  readonly languagesProbed: number;
}

/** The directory names the manifests themselves declare — never a literal. */
export function declaredBundleDirectories(
  modules: readonly ModuleUnderCheck[],
): readonly string[] {
  return [
    ...new Set(
      modules
        .map((module) => module.bundlesDir)
        .filter((dir): dir is string => dir !== null && dir.length > 0),
    ),
  ].sort();
}

/** Where a module's bundles would be, declared first and probed otherwise. */
function candidateDirectories(
  module: ModuleUnderCheck,
  declared: readonly string[],
): readonly string[] {
  if (module.bundlesDir !== null && module.bundlesDir.length > 0) {
    return [join(module.directory, module.bundlesDir)];
  }
  return declared.map((name) => join(module.directory, name));
}

/**
 * The findings, over the modules and languages handed in.
 *
 * Pure but for the injected reader, so a red proof enters where a real run
 * enters: a module tree on disk plus the index's own answer about which modules
 * exist (issue #130). A fixture handing in a per-module classification would
 * prove the reporter and leave the classifier — which is all of the analysis —
 * unproven.
 */
export function checkBundlePairing(input: BundlePairingInput): BundlePairingResult {
  const fs = input.fs ?? nodeBundlePairingFs;
  const declared = declaredBundleDirectories(input.modules);
  const findings: BundlePairingFinding[] = [];
  const filesRead: string[] = [];
  const classified: string[] = [];
  const shipping: string[] = [];
  const shippingNothing: string[] = [];

  for (const module of input.modules) {
    classified.push(module.moduleId);

    // The first candidate directory that actually holds a bundle. A module with
    // a declared `bundlesDir` has exactly one; a module with none is probed at
    // every name the other manifests use, which is what makes
    // `undeclared-bundle-dir` reachable without a directory name written here.
    let bundlesDirectory: string | null = null;
    const present = new Map<string, string>();
    for (const candidate of candidateDirectories(module, declared)) {
      if (!fs.isDirectory(candidate)) continue;
      const found = new Map<string, string>();
      for (const language of input.languages) {
        const file = join(candidate, `${language}.json`);
        if (fs.isFile(file)) found.set(language, file);
      }
      if (found.size === 0) continue;
      bundlesDirectory = candidate;
      for (const [language, file] of found) present.set(language, file);
      break;
    }

    if (bundlesDirectory === null) {
      // § 1's conditional: a module with no user-facing strings owes nothing,
      // and this is the branch that keeps the rule a conditional rather than a
      // universal. Seven registered modules take it today.
      shippingNothing.push(module.moduleId);
      continue;
    }
    shipping.push(module.moduleId);

    if (module.bundlesDir === null || module.bundlesDir.length === 0) {
      findings.push({
        kind: 'undeclared-bundle-dir',
        moduleId: module.moduleId,
        language: null,
        path: bundlesDirectory,
        detail:
          `bundle files are on disk but the manifest declares no \`i18n.bundlesDir\`, so ` +
          `the boot reconciler never loads them and every key they hold renders raw`,
      });
    }

    for (const language of input.languages) {
      const file = present.get(language);
      if (file === undefined) {
        findings.push({
          kind: 'missing-language-bundle',
          moduleId: module.moduleId,
          language,
          path: join(bundlesDirectory, `${language}.json`),
          detail:
            `the module ships ${[...present.keys()].sort().join(', ')} and not ${language}; ` +
            `a reader whose language is ${language} gets this module's strings in another one`,
        });
        continue;
      }

      filesRead.push(file);
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFile(file));
      } catch (error: unknown) {
        findings.push({
          kind: 'unparseable-bundle',
          moduleId: module.moduleId,
          language,
          path: file,
          detail: `not valid JSON (${error instanceof Error ? error.message : String(error)})`,
        });
        continue;
      }
      const validated = TranslationBundleEntriesSchema.safeParse(parsed);
      if (!validated.success) {
        findings.push({
          kind: 'unparseable-bundle',
          moduleId: module.moduleId,
          language,
          path: file,
          detail:
            'not readable as `TranslationBundleEntriesSchema` — entries must be a flat ' +
            `{"a.b.c": "text"} map (${validated.error.issues[0]?.message ?? 'invalid shape'})`,
        });
        continue;
      }
      if (Object.keys(validated.data).length === 0) {
        findings.push({
          kind: 'empty-bundle',
          moduleId: module.moduleId,
          language,
          path: file,
          detail:
            'parses to zero entries — it satisfies a presence test while translating nothing',
        });
      }
    }
  }

  return {
    findings,
    filesRead,
    classified,
    shipping,
    shippingNothing,
    languagesProbed: shipping.length > 0 ? input.languages.length : 0,
  };
}

/** The remedy paragraph, one per finding kind. */
const REMEDIES: Readonly<Record<BundlePairingFindingKind, string>> = {
  'missing-language-bundle':
    'Every module Endora implements ships a bundle in every language the platform ships ' +
    '(AGENTS.md § i18n, owner ruling of 2026-09-01). Author the strings in English and ' +
    'translate them; a module with no user-facing strings ships no bundle at all, which is ' +
    'the only exemption there is.',
  'empty-bundle':
    'Delete the file if the module has no strings — shipping none is legal and shipping an ' +
    'empty one is a presence test passing over nothing. If it has strings, write them.',
  'unparseable-bundle':
    'The boot reconciler validates each bundle with `TranslationBundleEntriesSchema`, logs ' +
    'and skips one that fails, and the module then renders raw keys with nothing reported. ' +
    'Flatten the JSON to `{"a.b.c": "text"}`.',
  'undeclared-bundle-dir':
    "Declare `i18n: { bundlesDir: '<dir>' }` in the module's `manifest.ts`. Until it is " +
    'declared the files are read by nobody, which looks exactly like having no translations.',
};

/**
 * The manifest half of this run is **imported**, and a module package resolves
 * through its own `exports` map at its build output (D-164) — so an author who
 * edits `packages/modules/<id>/src/manifest.ts` and runs this check is answered
 * about the previous build. `bundlesDir` is exactly such a field, and
 * `undeclared-bundle-dir` is a finding *about* its absence, so a stale artefact
 * is the one thing that could make this check report the defect it exists for as
 * clean. Exit 2 rather than 1: the tree is not in violation, the run could not
 * see it (issue #113).
 */
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
      manifest?: { i18n?: { bundlesDir?: string } };
    }>;
  };
  const entries = loaded.DISCOVERED_MANIFESTS ?? [];
  const modules: ModuleUnderCheck[] = [];
  const manifestLocations: string[] = [];
  for (const entry of entries) {
    if (entry.manifestPath === undefined) continue;
    manifestLocations.push(entry.manifestPath);
    modules.push({
      moduleId: entry.id,
      directory: dirname(entry.manifestPath),
      bundlesDir: entry.manifest?.i18n?.bundlesDir ?? null,
    });
  }
  return { modules, manifestLocations };
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout = await requireModuleLayout(PREFIX);

  // § 4.1 — with no shipped language every module is vacuously paired, and the
  // whole predicate answers "clean" over a question it never asked.
  const languages = [...SUPPORTED_LANGUAGES];
  if (languages.length === 0) {
    console.error(
      `${PREFIX} the platform's shipped-language set is empty, so every module is vacuously ` +
        'paired and the predicate has nothing to compare; refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  let loaded: LoadedModules;
  try {
    loaded = await loadModules(layout.manifestIndexPath);
  } catch (error: unknown) {
    // § 4.2 — the module set is the index's answer, not this check's.
    console.error(
      `${PREFIX} the module index at ${layout.manifestIndexPath} could not be read ` +
        `(${String(error)}) — the population is derived from it, so there is nothing to ` +
        'judge; refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  // § 4.3 — issue #215's shared floor, over the population this check walks:
  // each registered module's **own directory**, which is what `bundlesDir` is
  // joined to. A module tree that moved leaves the index answering for 69
  // modules over a walk that reached two, and the remainder would read clean.
  const directories = loaded.modules
    .filter((module) => existsSync(module.directory))
    .map((module) => module.directory);
  const byDirectory = new Map(
    loaded.modules.map((module) => [module.directory, module.moduleId] as const),
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

  const result = checkBundlePairing({ modules: loaded.modules, languages });

  if (listMode) {
    for (const module of loaded.modules) {
      const state = result.shippingNothing.includes(module.moduleId) ? 'NONE   ' : 'SHIPS  ';
      console.log(
        `${state} ${module.moduleId.padEnd(24)} bundlesDir=${module.bundlesDir ?? '(none)'}`,
      );
    }
    console.log('');
  }

  // § 4.4, and the one a careless implementation omits: with a conditional
  // predicate, "no module ships a bundle" is *vacuously clean*. `files` is the
  // bundle files opened, so it is exactly that state — and `read-size.ts`
  // refuses it as `read-nothing` before this run can report a pass.
  reportReadSize({
    prefix: PREFIX,
    files: result.filesRead.length,
    sites: result.classified.length,
    coverage: [
      coverage,
      {
        source: 'shipped-languages',
        expected: languages.length,
        covered: result.languagesProbed,
      },
    ],
  });
  console.log(
    `${PREFIX} modules shipping bundles=${result.shipping.length} ` +
      `shipping none=${result.shippingNothing.length} ` +
      `findings=${result.findings.length}`,
  );

  if (result.findings.length === 0) {
    process.exit(0);
  }

  const kinds = [...new Set(result.findings.map((finding) => finding.kind))].sort();
  for (const kind of kinds) {
    console.error(`\n[${kind}]\n${REMEDIES[kind]}\n`);
    for (const finding of result.findings.filter((candidate) => candidate.kind === kind)) {
      const language = finding.language === null ? '' : ` (${finding.language})`;
      console.error(
        `  - ${finding.moduleId}${language}: ${layout.displayOf(finding.path)}\n` +
          `      ${finding.detail}`,
      );
    }
  }
  process.exit(1);
}

// CLI only — importing this module (the companion test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
