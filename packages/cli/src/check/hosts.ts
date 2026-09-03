/**
 * The package-scope hosts — one per rule whose `EstateEntry.host` is `'built'`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6).
 *
 * A host does three things and no more: it derives the rule's population from
 * the {@link PackageLayout}, it calls the **relocated analysis** — the same
 * function `backend/scripts/check-<name>.ts` calls — and it turns the result
 * into a {@link RuleResult}. It re-implements no predicate. A second
 * implementation of an analysis is the defect this repository is built against,
 * in its purest form.
 *
 * The order the verdicts are decided in is `exit-reduction.md` §2's, and it is
 * the same three lines in every host:
 *
 *   1. no declaration for the subject → `not-applicable`, naming the absent
 *      declaration;
 *   2. a declaration and a walk that came back short → `unreadable`, exit 2;
 *   3. otherwise `ran`, with the estate's own `read:` line.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

import { SUPPORTED_LANGUAGES } from '@endora-commerce/contracts';

import {
  barrelKeyOf,
  publishedSurface,
  PUBLISHED_SUBPATHS,
  type HostPackage,
  type PlatformSurface,
} from '../lib/platform-surface.js';
import { readSizeRefusal, type ReadCoverage, type ReadSizeInput } from '../lib/read-size.js';
import { checkBundlePairing, type ModuleUnderCheck } from '../rules/bundle-pairing.js';
import {
  analyzeSource as commandCoverageAnalyse,
  collectScannedFiles,
  isScannedPath as commandCoverageOpens,
} from '../rules/command-coverage.js';
import {
  analyzeSource as containerAnalyse,
  collectModuleFiles,
} from '../rules/container-imports.js';
import {
  checkNulBytes,
  isScannablePath,
  SKIPPED_DIRECTORIES,
  type ScannedFile,
} from '../rules/nul-bytes.js';
import {
  analyzeSource as channelAnalyse,
  collectChannelSources,
} from '../rules/channel-resolution.js';
import {
  checkDefaultLanguageProse,
  collectProseSources,
  DETECTED_LANGUAGES,
  isScannedPath as defaultLanguageProseOpens,
  ledgerKey as proseLedgerKey,
} from '../rules/default-language-prose.js';
import {
  checkDiacriticFolds,
  collectFoldSources,
  isScannablePath as foldsScannablePath,
} from '../rules/diacritic-folds.js';
import {
  collectEntryScopeSources,
  declaredProgramEntryPoints,
  findEntrySites,
  keyOf as entryScopeKeyOf,
  violationsOf as entryScopeViolations,
} from '../rules/entry-scope.js';
import {
  analyzeSource as relationAnalyse,
  collectSources as collectRelationSources,
  findingKey as relationKey,
  isViolation as isRelationViolation,
  RELATION_DECORATOR_HINT,
} from '../rules/kernel-boundary.js';
import {
  checkPlatformSurface,
  collectPlatformSurfaceSources,
  keyOf as platformSurfaceKeyOf,
  remedyOf as platformSurfaceRemedy,
} from '../rules/platform-surface.js';
import {
  checkPortShape,
  collectPortShapeSources,
} from '../rules/port-shape.js';
import {
  checkTransactionContext,
  collectTransactionSources,
  keyOf as transactionKeyOf,
} from '../rules/transaction-context.js';
import {
  checkSubscribeSeam,
  checkWorkerSeam,
  collectSeamFiles,
  keyOf as subscriptionKeyOf,
  workerKeyOf,
} from '../rules/subscribe-seam.js';

import { estateEntry, type EstateEntry } from './estate.js';
import { isFile, layerExpectation, type PackageLayout } from './layout.js';
import type { Finding, RuleResult } from './run.js';

/** A rule's package-scope host. Pure but for reading the package off disk. */
export type PackageRuleHost = (layout: PackageLayout) => RuleResult;

/** The estate's `sources=` token for a package: its own `exports` map. */
const PACKAGE_EXPORTS = 'package-exports';

function entryOf(id: string): EstateEntry {
  const entry = estateEntry(id);
  if (entry === undefined) {
    // Unreachable through `runCheck`, which iterates the estate; a host called
    // directly with an unknown id must not answer with a default.
    throw new Error(`[endora check] no estate entry for \`${id}\``);
  }
  return entry;
}

function notApplicable(id: string, explanation: string): RuleResult {
  return {
    id,
    verdict: 'not-applicable',
    findings: [],
    acknowledged: [],
    readSize: null,
    explanation,
    unevaluatedSignals: entryOf(id).partial ?? [],
  };
}

function unreadable(id: string, explanation: string, readSize: ReadSizeInput | null): RuleResult {
  return {
    id,
    verdict: 'unreadable',
    findings: [],
    acknowledged: [],
    readSize,
    explanation,
    unevaluatedSignals: entryOf(id).partial ?? [],
  };
}

function ran(id: string, readSize: ReadSizeInput, findings: readonly Finding[]): RuleResult {
  return {
    id,
    verdict: 'ran',
    findings,
    acknowledged: [],
    readSize,
    explanation: '',
    unevaluatedSignals: entryOf(id).partial ?? [],
  };
}

/**
 * The one sentence a `not-applicable`-from-a-declaration verdict prints.
 *
 * It names the declaration the rule looked for and did not find. That sentence
 * is what makes the verdict auditable by its reader, and it is the whole
 * difference between this verdict and a skip.
 */
function absentDeclaration(entry: EstateEntry): string {
  const declaration = entry.subjectDeclaration?.declaration ?? 'subject';
  return `no ${declaration}: this rule has no subject in this package`;
}

/**
 * Turn a walk plus its declared expectation into either `ran`'s read line or the
 * short-walk refusal, in one place.
 *
 * `read-size.ts`'s three refusal kinds are already the estate's, and a
 * `no-expectation` verdict is caught by the caller before it gets here — it is
 * `not-applicable`, not a refusal (§3).
 */
function readSizeOrShortWalk(
  id: string,
  input: ReadSizeInput,
): { readonly ok: true } | { readonly ok: false; readonly result: RuleResult } {
  const refusal = readSizeRefusal(input);
  if (refusal === null) return { ok: true };
  return {
    ok: false,
    result: unreadable(
      id,
      `${refusal.message}. Supply the sources the package's \`exports\` map declares, or ` +
        `withdraw the declaration.`,
      input,
    ),
  };
}

/**
 * The coverage token for a rule's walk.
 *
 * Three answers, and they are `exit-reduction.md` §2's three states: a
 * refusal the layout could not derive at all, `null` for *no expectation* —
 * which is `not-applicable`, never `0/0` — and the token.
 */
function coverageOf(
  layout: PackageLayout,
  walked: readonly string[],
  opens: (path: string) => boolean,
): ReadCoverage | null | { readonly refusal: string } {
  if (layout.layerRefusal !== null) return { refusal: layout.layerRefusal };
  const expectation = layerExpectation(layout, walked, opens);
  if (expectation.expected.length === 0) return null;
  return {
    source: PACKAGE_EXPORTS,
    expected: expectation.expected.length,
    covered: expectation.covered.length,
  };
}

/** `true` when {@link coverageOf} answered with a refusal rather than a token. */
function isRefusal(
  value: ReadCoverage | null | { readonly refusal: string },
): value is { readonly refusal: string } {
  return value !== null && 'refusal' in value;
}

const opensTypeScript = (path: string): boolean =>
  path.endsWith('.ts') && !path.endsWith('.d.ts') && !path.endsWith('.test.ts');

/* ---------------------------------------------------------------- nul-bytes */

/**
 * The one rule with no repository input at all: its population is every file the
 * package holds, minus the same declared exclusions the repository host uses.
 *
 * `self-reported`, exactly as in this repository — nothing else derives "every
 * file that is not binary", and inventing a `package-exports` expectation for it
 * would be a second author that agrees with the walk by construction.
 */
const nulBytes: PackageRuleHost = (layout) => {
  const id = 'check:nul-bytes';
  const files: ScannedFile[] = [];
  for (const absolute of walkEverything(layout.packageRoot)) {
    const path = relative(layout.packageRoot, absolute).split(sep).join('/');
    if (!isScannablePath(path)) continue;
    files.push({ path, bytes: readFileSync(absolute) });
  }
  const result = checkNulBytes(files);
  const readSize: ReadSizeInput = { prefix: '[nul-bytes]', files: result.scanned };
  const short = readSizeOrShortWalk(id, readSize);
  if (!short.ok) return short.result;

  return ran(
    id,
    readSize,
    result.violations.map((finding) => ({
      rule: id,
      key: finding.path,
      location: `${finding.path}:${finding.line}:${finding.column}`,
      message:
        `${finding.count} raw NUL byte(s). Git classifies the file as binary, so every diff ` +
        `of it reads "Binary files differ" and the file stops being reviewable. Spell the ` +
        `byte as \`\\0\` — the same byte at runtime, and the diff comes back.`,
    })),
  );
};

/* ----------------------------------------------------------- bundle-pairing */

/**
 * The two-language floor, and the single most likely thing a stranger gets
 * wrong.
 *
 * The subject is the manifest's `i18n.bundlesDir`, read from the **emitted**
 * manifest where the package emits — the platform composes a package through its
 * published artefact, so that is the value the platform will read. A package
 * declaring no bundles directory owes no translation and is `not-applicable`.
 *
 * `undeclared-bundle-dir` is declared unevaluated on the rule's line: the
 * directory names that signal probes come from *other* modules' manifests
 * (`declaredBundleDirectories`), and a lone package supplies none.
 */
const bundlePairing: PackageRuleHost = (layout) => {
  const id = 'check:bundle-pairing';
  const entry = entryOf(id);

  const manifest = readEmittedManifest(layout);
  if (manifest === null) {
    return unreadable(
      id,
      `the package's manifest could not be read at its \`exports\` root target. Build the ` +
        `package (\`pnpm run build\` in its directory) — the platform composes a module ` +
        `through its published artefact, so answering from source would make this verdict ` +
        `differ from the platform's.`,
      null,
    );
  }

  const bundlesDir = manifest.bundlesDir;
  if (bundlesDir === null || bundlesDir.length === 0) {
    return notApplicable(id, absentDeclaration(entry));
  }

  const languages = [...SUPPORTED_LANGUAGES];
  if (languages.length === 0) {
    return unreadable(
      id,
      `the platform's shipped-language set is empty, so every module is vacuously paired ` +
        `and the predicate has nothing to compare. Install \`@endora-commerce/contracts\`.`,
      null,
    );
  }

  const module: ModuleUnderCheck = {
    moduleId: layout.moduleId,
    directory: layout.packageRoot,
    bundlesDir,
  };
  const result = checkBundlePairing({ modules: [module], languages });
  const readSize: ReadSizeInput = {
    prefix: '[bundle-pairing]',
    files: result.filesRead.length,
    sites: result.classified.length,
    coverage: [
      { source: 'shipped-languages', expected: languages.length, covered: result.languagesProbed },
    ],
  };
  const short = readSizeOrShortWalk(id, readSize);
  if (!short.ok) return short.result;

  return ran(
    id,
    readSize,
    result.findings.map((finding) => ({
      rule: id,
      key: `${finding.kind}|${finding.language ?? '-'}|${layout.keyOf(finding.path)}`,
      location: layout.keyOf(finding.path),
      message: `${finding.kind}: ${finding.detail}`,
    })),
  );
};

/* -------------------------------------------------------- container-imports */

const containerImports: PackageRuleHost = (layout) => {
  const id = 'check:container-imports';
  const entry = entryOf(id);
  const files = collectModuleFiles([layout.sourceRoot]);
  const coverage = coverageOf(layout, files, opensTypeScript);
  if (isRefusal(coverage)) return unreadable(id, coverage.refusal, null);
  if (coverage === null) return notApplicable(id, absentDeclaration(entry));

  const readSize: ReadSizeInput = {
    prefix: '[container-imports]',
    files: files.length,
    coverage: [coverage],
  };
  const short = readSizeOrShortWalk(id, readSize);
  if (!short.ok) return short.result;

  // Attribution keys on the declared `endora.id`, never on a `modules/<id>/`
  // path segment: D-141 is this repository's convention and a stranger's
  // checkout has no reason to hold it.
  const hostResident = new Map([[layout.keyOf(layout.sourceRoot), layout.moduleId]]);
  const findings = files.flatMap((file) =>
    containerAnalyse(readFileSync(file, 'utf8'), layout.keyOf(file), hostResident),
  );

  return ran(
    id,
    readSize,
    findings.map((finding) => ({
      rule: id,
      key: `${finding.file}|${finding.specifier}`,
      location: `${finding.file}:${finding.line}`,
      message:
        `imports '${finding.specifier}'. A module sees exactly one kernel surface — ` +
        `\`ModuleContext\` — and spells the container's vocabulary through \`ctx.asClass\` / ` +
        `\`ctx.asFunction\` / \`ctx.asValue\`. A module that reaches the container directly ` +
        `can register a route, a worker or a subscriber that never passes through its ` +
        `gating seam, and nothing would notice.`,
    })),
  );
};

/* ----------------------------------------------------------- subscribe-seam */

const subscribeSeam: PackageRuleHost = (layout) => {
  const id = 'check:subscribe-seam';
  const entry = entryOf(id);
  const files = collectSeamFiles([layout.sourceRoot]);
  const coverage = coverageOf(layout, files, opensTypeScript);
  if (isRefusal(coverage)) return unreadable(id, coverage.refusal, null);
  if (coverage === null) return notApplicable(id, absentDeclaration(entry));

  const sources = new Map(files.map((file) => [layout.keyOf(file), readFileSync(file, 'utf8')]));
  const readSize: ReadSizeInput = {
    prefix: '[subscribe-seam]',
    files: sources.size,
    coverage: [coverage],
  };
  const short = readSizeOrShortWalk(id, readSize);
  if (!short.ok) return short.result;

  const hostResidentModules = new Map([[layout.keyOf(layout.sourceRoot), layout.moduleId]]);
  const input = { sources, hostResidentModules };
  const subscriptions = checkSubscribeSeam(input, {});
  const workers = checkWorkerSeam(input, {});

  const findings: Finding[] = [
    ...subscriptions.violations.map((site) => ({
      rule: id,
      key: subscriptionKeyOf(site),
      location: `${site.file}:${site.line}`,
      message:
        `${site.receiver}.on('${site.event}') is an EventBus subscription outside the ` +
        `module's gating seam, so the handler keeps running with the module switched off ` +
        `(Constitution XVII). Register it from \`backend.ts\` with ` +
        `\`ctx.subscribe(event, handler)\`.`,
    })),
    ...workers.violations.map((site) => ({
      rule: id,
      key: workerKeyOf(site),
      location: `${site.file}:${site.line}`,
      message:
        `${site.spelling} is a BullMQ queue consumer outside the module's gating seam, so ` +
        `the platform cannot stop it: it is in no per-module registry and the presence ` +
        `reconcile has nothing to reconcile. Hand it to \`ctx.worker(worker)\`.`,
    })),
  ];

  const result = ran(id, readSize, findings);
  // The repository-scope host refuses a run that read no worker site at all,
  // because *that* tree is known to hold queue consumers. One package holding
  // none is the ordinary case, so the floor is stated rather than enforced.
  if (workers.sites.length > 0) {
    return { ...result, unevaluatedSignals: [] };
  }
  return result;
};

/* --------------------------------------------------------- command-coverage */

/**
 * Principle XIII, and the one rule here whose repository host stages its
 * findings.
 *
 * That staging is `MIGRATED_MODULES`, a rollout ledger of *these* modules, and a
 * third-party package is in no rollout. So every finding is blocking, which is
 * what `--strict` already means in this repository and what CI already runs.
 */
const commandCoverage: PackageRuleHost = (layout) => {
  const id = 'check:command-coverage';
  const entry = entryOf(id);
  const files = collectScannedFiles(layout.sourceRoot);
  // The rule's own membership predicate, not a `.ts` test: this walk prunes
  // `migrations` by design, so a package that publishes a `./migrations` layer
  // must not be reported short for a layer the rule excludes.
  const coverage = coverageOf(layout, files, (path) =>
    commandCoverageOpens(path, layout.sourceRoot),
  );
  if (isRefusal(coverage)) return unreadable(id, coverage.refusal, null);
  if (coverage === null) return notApplicable(id, absentDeclaration(entry));

  const readSize: ReadSizeInput = {
    prefix: '[command-coverage]',
    files: files.length,
    coverage: [coverage],
  };
  const short = readSizeOrShortWalk(id, readSize);
  if (!short.ok) return short.result;

  const findings = files.flatMap((file) => {
    const key = layout.keyOf(file);
    return commandCoverageAnalyse(key, readFileSync(file, 'utf8'));
  });

  return ran(
    id,
    readSize,
    findings.map((finding) => ({
      rule: id,
      key: `${finding.kind}|${finding.filePath}|${finding.method}`,
      location: `${finding.filePath}:${finding.line ?? '?'}`,
      message: `${finding.kind}: ${finding.message}`,
    })),
  );
};

/* ------------------------------------------------------- channel:resolution */

/**
 * Constitution XII — the request's sales channel is resolved once, by the
 * canonical resolver, and no module re-derives it.
 *
 * Unconditional: every module's backend sources are the subject, and there is
 * no declaration a package can decline to make. This repository's rollout
 * allow-list does not travel — a stranger's package is in no rollout of ours —
 * so every violation is blocking.
 */
const channelResolution: PackageRuleHost = (layout) => {
  const id = 'channel:resolution';
  const entry = entryOf(id);
  const files = collectChannelSources(layout.sourceRoot);
  const coverage = coverageOf(layout, files, opensTypeScript);
  if (isRefusal(coverage)) return unreadable(id, coverage.refusal, null);
  if (coverage === null) return notApplicable(id, absentDeclaration(entry));

  const readSize: ReadSizeInput = {
    prefix: '[channel-resolution]',
    files: files.length,
    coverage: [coverage],
  };
  const short = readSizeOrShortWalk(id, readSize);
  if (!short.ok) return short.result;

  const findings = files.flatMap((file) =>
    channelAnalyse(readFileSync(file, 'utf8'), layout.keyOf(file)),
  );

  return ran(
    id,
    readSize,
    findings.map((violation) => ({
      rule: id,
      key: `${violation.file}|${violation.kind}|${violation.line}`,
      location: `${violation.file}:${violation.line}`,
      message:
        `${violation.kind}: ${violation.detail}. The current sales channel is resolved once, ` +
        `by the platform's own resolver, and read through \`getResolvedChannel()\` — a module ` +
        `that re-derives it answers a different question from the one the request asked ` +
        `(Constitution XII).`,
    })),
  );
};

/* -------------------------------------------------- default-language-prose */

/**
 * The owner ruling of 2026-09-01, clause 1: a module's own prose is English by
 * default.
 *
 * Unconditional, and the ledger is the **package's** — this repository's shards
 * are a statement about its own 46 sites and a stranger's package predates none
 * of them, so the analysis is handed no shard and the author's own
 * acknowledgements are applied by `ledger.ts` over every rule at once.
 *
 * Detection is Polish only, which is the rule's declared bound rather than this
 * host's: `DETECTED_LANGUAGES` is reconciled against the platform's shipped
 * languages on the `read:` line, so a third shipped language is a short walk
 * here exactly as it is in this repository.
 */
const defaultLanguageProse: PackageRuleHost = (layout) => {
  const id = 'check:default-language-prose';
  const entry = entryOf(id);
  const files = collectProseSources(layout.sourceRoot);
  // The rule's own membership predicate, not a `.ts` test: this walk prunes
  // `migrations` by design (an applied migration cannot be edited, so a ledger
  // entry over a literal in one would never drain), so a package that publishes
  // a `./migrations` layer must not be reported short for a layer the rule
  // excludes.
  const coverage = coverageOf(layout, files, (path) =>
    defaultLanguageProseOpens(path, layout.sourceRoot),
  );
  if (isRefusal(coverage)) return unreadable(id, coverage.refusal, null);
  if (coverage === null) return notApplicable(id, absentDeclaration(entry));

  const languages = [...SUPPORTED_LANGUAGES];
  const detectable = languages.filter(
    (language) => language === 'en' || DETECTED_LANGUAGES.includes(language.split('-')[0] ?? ''),
  );
  const sources = new Map(files.map((file) => [layout.keyOf(file), readFileSync(file, 'utf8')]));
  const result = checkDefaultLanguageProse({ sources, languages }, [], () => layout.moduleId);
  const readSize: ReadSizeInput = {
    prefix: '[default-language-prose]',
    files: sources.size,
    sites: result.classified,
    coverage: [
      coverage,
      { source: 'detected-languages', expected: languages.length, covered: detectable.length },
    ],
  };
  const short = readSizeOrShortWalk(id, readSize);
  if (!short.ok) return short.result;

  return ran(
    id,
    readSize,
    result.violations.map((site) => ({
      rule: id,
      key: proseLedgerKey(site),
      location: `${site.file}:${site.line}`,
      message: `${site.kind}: ${site.language} prose in a ${site.placement} — ${site.text}`,
    })),
  );
};

/* ------------------------------------------------------- diacritic-folds */

/**
 * Issues #240 and #245 — the fold and the slug builder have one owner.
 *
 * The package is one population root, and `SHARED_FOLD_HELPER` is *right* to
 * match nothing here: a package has no exempt file. It imports `foldDiacritics`
 * and `slugify` from `@endora-commerce/contracts` like every other consumer,
 * which is exactly what the exemption exists to make true — so both ledgers are
 * empty and every finding is blocking.
 */
const diacriticFolds: PackageRuleHost = (layout) => {
  const id = 'check:diacritic-folds';
  const entry = entryOf(id);
  // One root, named after the package's own source directory, so the rule's
  // population predicate answers for a package-relative key exactly as it does
  // for a repo-relative one.
  const rootName = layout.keyOf(layout.sourceRoot);
  const roots = { [rootName]: 'the package under check — its whole source tree.' };

  const scanned: { path: string; source: string }[] = [];
  for (const file of collectFoldSources(layout.sourceRoot)) {
    const path = layout.keyOf(file);
    if (!foldsScannablePath(path, roots)) continue;
    scanned.push({ path, source: readFileSync(file, 'utf8') });
  }
  const coverage = coverageOf(
    layout,
    scanned.map((file) => join(layout.packageRoot, file.path)),
    // `layerExpectation` hands an **absolute** layer entry; the rule's predicate
    // reads the key namespace the walk keyed with, so it is asked in that one.
    (absolute) => foldsScannablePath(layout.keyOf(absolute), roots),
  );
  if (isRefusal(coverage)) return unreadable(id, coverage.refusal, null);
  if (coverage === null) return notApplicable(id, absentDeclaration(entry));

  const result = checkDiacriticFolds(scanned, {}, {}, roots);
  const readSize: ReadSizeInput = {
    prefix: '[diacritic-folds]',
    files: result.scanned,
    sites: result.replaceSites,
    coverage: [coverage],
  };
  const short = readSizeOrShortWalk(id, readSize);
  if (!short.ok) return short.result;

  return ran(
    id,
    readSize,
    result.violations.map((finding) => ({
      rule: id,
      key: `${finding.kind}|${finding.path}|${finding.literal}`,
      location: `${finding.path}:${finding.line}:${finding.column}`,
      message:
        `${finding.kind}: ${finding.literal}. Import \`foldDiacritics\` or \`slugify\` from ` +
        `\`@endora-commerce/contracts\` — the obvious one-liner reads as complete and is ` +
        `not: \`ł\` has no canonical decomposition, so NFD leaves it alone and the strip ` +
        `has nothing to remove.`,
    })),
  );
};

/* ------------------------------------------------------------- entry-scope */

/**
 * Feature 072 FR-020 — a non-HTTP entry point establishes its own scope.
 *
 * The subject is a `package.json` script running a source path, a worker, a
 * repeating timer or a `process.on` handler. A package with none of those has
 * nothing to scope, and the rule says so rather than reporting clean over a
 * population it never had (`exit-reduction.md` §2).
 */
const entryScope: PackageRuleHost = (layout) => {
  const id = 'check:entry-scope';
  const entry = entryOf(id);
  const files = collectEntryScopeSources(layout.sourceRoot);
  const coverage = coverageOf(layout, files, (path) => path.endsWith('.ts') && !path.endsWith('.d.ts'));
  if (isRefusal(coverage)) return unreadable(id, coverage.refusal, null);
  if (coverage === null) return notApplicable(id, absentDeclaration(entry));

  const declared = declaredProgramsOf(layout);
  const sites = files.flatMap((file) =>
    findEntrySites(file, readFileSync(file, 'utf8'), declared, layout.keyOf),
  );
  if (sites.length === 0) return notApplicable(id, absentDeclaration(entry));

  const readSize: ReadSizeInput = {
    prefix: '[entry-scope]',
    files: files.length,
    sites: sites.length,
    coverage: [coverage],
  };
  const short = readSizeOrShortWalk(id, readSize);
  if (!short.ok) return short.result;

  return ran(
    id,
    readSize,
    entryScopeViolations(sites, {}).map((site) => ({
      rule: id,
      key: entryScopeKeyOf(site),
      location: `${site.file}:${site.line}`,
      message:
        `${site.kind}/${site.construct} in \`${site.scheduler}\` establishes no scope. A ` +
        `non-HTTP entry point has no caller to answer, so it opens its own: call ` +
        `\`enterPlatformScope\` or \`enterSystemScope\` in the callback itself.`,
    })),
  );
};

/* ---------------------------------------------------------- kernel-boundary */

/**
 * Feature 072 D-32, rule A — an ORM relation stays inside its own module or
 * points at the platform.
 *
 * Rules B and C are the platform roots' and a package holds none; they are
 * declared unevaluated on this rule's line rather than counted zero.
 */
const kernelBoundary: PackageRuleHost = (layout) => {
  const id = 'check:kernel-boundary';
  const entry = entryOf(id);
  const files = collectRelationSources(layout.sourceRoot);
  const coverage = coverageOf(layout, files, opensTypeScript);
  if (isRefusal(coverage)) return unreadable(id, coverage.refusal, null);
  if (coverage === null) return notApplicable(id, absentDeclaration(entry));

  const hostResident = hostResidentOf(layout);
  const relationFiles = files.filter((file) =>
    RELATION_DECORATOR_HINT.test(readFileSync(file, 'utf8')),
  );
  const readSize: ReadSizeInput = {
    prefix: '[kernel-boundary]',
    files: files.length,
    sites: relationFiles.length,
    coverage: [coverage],
  };
  const short = readSizeOrShortWalk(id, readSize);
  if (!short.ok) return short.result;

  const findings = relationFiles.flatMap((file) =>
    relationAnalyse(readFileSync(file, 'utf8'), file, hostResident),
  );

  return ran(
    id,
    readSize,
    findings.filter(isRelationViolation).map((finding) => ({
      rule: id,
      key: relationKey(finding),
      location: layout.keyOf(finding.file),
      message:
        `${finding.className}.${finding.property} (@${finding.decorator}) relates ` +
        `${finding.sourceOwner} -> ${finding.targetOwner}. A relation across a module ` +
        `boundary is a foreign key the ORM will create, in a schema neither module can be ` +
        `detached from (Constitution I). Reach the other module through its port instead.`,
    })),
  );
};

/* --------------------------------------------------------- platform-surface */

/**
 * D-160.8 — a module reaches only the platform surface the host publishes.
 *
 * The relative-specifier half is vacuous here and is declared vacuous rather
 * than counted zero: a module in a package reaches the host by **bare**
 * specifier only. The host package is the installed `@endora-commerce/platform`,
 * whose barrels this run reads; without it every host reach is `unreadable` and
 * no rule is reported clean on that basis.
 */
const platformSurface: PackageRuleHost = (layout) => {
  const id = 'check:platform-surface';
  const entry = entryOf(id);
  const files = collectPlatformSurfaceSources(layout.sourceRoot);
  const coverage = coverageOf(layout, files, opensTypeScript);
  if (isRefusal(coverage)) return unreadable(id, coverage.refusal, null);
  if (coverage === null) return notApplicable(id, absentDeclaration(entry));

  const host = installedPlatform(layout);
  if (host === null) {
    return unreadable(
      id,
      `\`@endora-commerce/platform\` is not installed beside this package, so the surface ` +
        `it publishes cannot be read and a reach into it cannot be judged. Install the ` +
        `platform — a shorter published set reports *fewer* findings, which is why this is ` +
        `a refusal rather than a clean run.`,
      null,
    );
  }

  const sources = new Map(files.map((file) => [layout.keyOf(file), readFileSync(file, 'utf8')]));
  const readSize: ReadSizeInput = {
    prefix: '[platform-surface]',
    files: sources.size,
    coverage: [
      coverage,
      { source: 'platform-barrels', expected: host.barrels, covered: host.barrels },
    ],
  };
  const short = readSizeOrShortWalk(id, readSize);
  if (!short.ok) return short.result;

  const result = checkPlatformSurface(
    {
      sources,
      files: new Set(sources.keys()),
      surface: host.surface,
      moduleIdOf: () => layout.moduleId,
      canonicalTargetOf: (target: string) => target,
      host: host.package,
      platformSourceRoot: host.sourceRoot,
    },
    {},
  );

  return ran(
    id,
    readSize,
    result.violations.map((finding) => ({
      rule: id,
      key: platformSurfaceKeyOf(finding),
      location: `${finding.file}:${finding.line}`,
      message: `${finding.kind}: ${platformSurfaceRemedy(finding)}`,
    })),
  );
};

/* --------------------------------------------------------------- port-shape */

/**
 * D-97.3 and issue #192 — signals 1 and 2 on a published port.
 *
 * Signal 3 asks whether a module resolves a container name **no contract
 * publishes**, which needs the published surface of every installed peer; it is
 * declared unevaluated on the rule's own line. Both ledgers and both
 * platform-name sets are empty, which is what makes the two signals that do run
 * blocking.
 */
const portShape: PackageRuleHost = (layout) => {
  const id = 'check:port-shape';
  const entry = entryOf(id);
  const ports = layout.layers.find((layer) => layer.subpath === './ports');
  if (ports === undefined) return notApplicable(id, absentDeclaration(entry));

  const portFiles = collectPortShapeSources(ports.directory);
  const moduleFiles = collectPortShapeSources(layout.sourceRoot);
  const coverage = coverageOf(layout, moduleFiles, opensTypeScript);
  if (isRefusal(coverage)) return unreadable(id, coverage.refusal, null);
  if (coverage === null) return notApplicable(id, absentDeclaration(entry));

  const readSize: ReadSizeInput = {
    prefix: '[port-shape]',
    files: moduleFiles.length,
    sites: portFiles.length,
    coverage: [
      coverage,
      { source: 'ports-subpaths', expected: 1, covered: portFiles.length > 0 ? 1 : 0 },
    ],
  };
  const short = readSizeOrShortWalk(id, readSize);
  if (!short.ok) return short.result;

  const keyed = (list: readonly string[]): Map<string, string> =>
    new Map(list.map((file) => [layout.keyOf(file), readFileSync(file, 'utf8')]));
  const result = checkPortShape({
    contracts: new Map(),
    modules: keyed(moduleFiles),
    modulePorts: keyed(portFiles),
    hostResidentModules: hostResidentOf(layout),
  });

  // Signal 1 only. Signal 2 compares a doc block's container name to the name
  // the port is **registered** under, and a port's provider is routinely another
  // module — `orders` publishes `PaymentPlacementApplyPort` and `payments`
  // registers it — so over one package every such port reads
  // `container-name-unregistered`. That is the state §5 of
  // `contracts/package-scope-layout.md` rules on: a port whose owner is not
  // installed is `unreadable` **for that edge**, never unowned, because the
  // wiring may be right and the map short. Both signals are declared on the
  // rule's own line rather than counted zero.
  return ran(
    id,
    readSize,
    result.findings.map((finding) => ({
      rule: id,
      key: `${finding.kind}|${finding.portName}|${finding.member}`,
      location: `${finding.file}:${finding.line}`,
      message:
        `${finding.kind}: ${finding.portName}.${finding.member} — feature detection through a ` +
        `port is impossible by construction. \`lazyPort\`'s proxy answers every property ` +
        `with a function, so \`if (port.maybe)\` is always true and the forward throws when ` +
        `the provider has none.`,
    })),
  );
};

/* ------------------------------------------------------ transaction-context */

/**
 * Issue #200 — SQL written inside a transaction that does not run inside it.
 *
 * The subject is the package's backend sources, which is what an `exports`
 * subpath publishing them declares. The ledger argument is the **package's**,
 * never this repository's: `CONNECTION_LEVEL_SQL_IN_TRANSACTIONS` is a statement
 * about this tree's debt and a stranger's package predates none of it, so the
 * analysis is handed an empty map and the author's own acknowledgements are
 * applied later, by `ledger.ts`, over every rule at once.
 */
const transactionContext: PackageRuleHost = (layout) => {
  const id = 'check:transaction-context';
  const entry = entryOf(id);
  const files = collectTransactionSources(layout.sourceRoot);
  const coverage = coverageOf(layout, files, opensTypeScript);
  if (isRefusal(coverage)) return unreadable(id, coverage.refusal, null);
  if (coverage === null) return notApplicable(id, absentDeclaration(entry));

  const sources = new Map(files.map((file) => [layout.keyOf(file), readFileSync(file, 'utf8')]));
  const readSize: ReadSizeInput = {
    prefix: '[transaction-context]',
    files: sources.size,
    coverage: [coverage],
  };
  const short = readSizeOrShortWalk(id, readSize);
  if (!short.ok) return short.result;

  const result = checkTransactionContext({ sources }, {});
  return ran(
    id,
    readSize,
    result.violations.map((escape) => ({
      rule: id,
      key: transactionKeyOf(escape),
      location: `${escape.file}:${escape.line}`,
      message:
        `[${escape.scope}/${escape.shape}/${escape.direction}] ${escape.statement} — a ` +
        `connection-level handle takes its own pooled connection, so this statement ` +
        `commits the moment it runs: the enclosing rollback cannot reach it and a read ` +
        `cannot see what the transaction has written. Use the EntityManager's own ` +
        `\`em.execute(sql, params)\`, which passes the transaction context and is ` +
        `identical outside a transaction.`,
    })),
  );
};

/** `[<package-relative source root>] -> <module id>`, the attribution a package declares. */
function hostResidentOf(layout: PackageLayout): ReadonlyMap<string, string> {
  return new Map([[layout.keyOf(layout.sourceRoot), layout.moduleId]]);
}

/**
 * The `package.json` scripts that run a source path — `check:entry-scope`'s
 * second population source (issue #228), spelled the same way its keys are.
 */
function declaredProgramsOf(layout: PackageLayout): ReadonlySet<string> {
  try {
    const manifest = JSON.parse(
      readFileSync(join(layout.packageRoot, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    return new Set(
      declaredProgramEntryPoints(JSON.stringify({ scripts: manifest.scripts ?? {} })),
    );
  } catch {
    return new Set();
  }
}

/**
 * The installed `@endora-commerce/platform`, its published barrels and the
 * surface they declare — or `null` when it is not installed.
 *
 * `check:platform-surface` refuses rather than degrades on its absence, because
 * a shorter published set reports *fewer* findings: the obvious repair for a
 * finding is to widen the barrel, and the whole of D-160.8 is that the barrel is
 * not widened quietly.
 */
function installedPlatform(layout: PackageLayout): {
  readonly package: HostPackage;
  readonly surface: PlatformSurface;
  readonly sourceRoot: string;
  readonly barrels: number;
} | null {
  const dir = join(layout.packageRoot, 'node_modules', '@endora-commerce', 'platform');
  if (!isFile(join(dir, 'package.json'))) return null;
  let manifest: { name?: string; exports?: Record<string, unknown> };
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as typeof manifest;
  } catch {
    return null;
  }
  const name = manifest.name;
  if (typeof name !== 'string') return null;

  const barrelSources = new Map<string, string>();
  const barrelTargets = new Map<string, string>();
  for (const subpath of PUBLISHED_SUBPATHS) {
    const source = join(dir, 'src', subpath, 'index.ts');
    if (!isFile(source)) continue;
    barrelSources.set(barrelKeyOf(subpath), readFileSync(source, 'utf8'));
    barrelTargets.set(subpath, barrelKeyOf(subpath));
  }
  if (barrelSources.size === 0) return null;

  const surface = publishedSurface(barrelSources, (fromKey, specifier) =>
    resolvePlatformTarget(fromKey, specifier, dir),
  );
  return {
    package: { name, subpathTargets: barrelTargets },
    surface,
    sourceRoot: 'src',
    barrels: barrelSources.size,
  };
}

/** A barrel's relative specifier, resolved against the installed platform's sources. */
function resolvePlatformTarget(fromKey: string, specifier: string, dir: string): string | null {
  const from = join(dir, 'src', fromKey.replace(/^src\//, ''));
  for (const candidate of [
    resolve(dirname(from), `${specifier.replace(/\.js$/, '')}.ts`),
    resolve(dirname(from), specifier.replace(/\.js$/, ''), 'index.ts'),
  ]) {
    if (isFile(candidate)) return posixKey(relative(dir, candidate));
  }
  return null;
}

function posixKey(path: string): string {
  return path.split(sep).join('/');
}

/* ------------------------------------------------------------------ helpers */

/** One palette action, as the emitted manifest declares it. */
interface EmittedAction {
  readonly id: string;
  readonly targetRoute: string;
  readonly requiredPermission?: string;
}

/** The manifest shape this run reads out of the package's root export. */
interface EmittedManifest {
  readonly bundlesDir: string | null;
  readonly actions: readonly EmittedAction[];
}

/**
 * The module manifest, read where the **platform** reads it.
 *
 * A rule whose subject is something the platform *loads* reads the emitted file
 * — that is not a shortcut, it is the only thing a published package has, and
 * answering from source would make this command's verdict differ from the
 * platform's, which is the one thing a conformance command must not do
 * (`contracts/package-scope-layout.md` §4). The artefact's currency is decided
 * first: a source strictly newer than its emitted target is `stale-artefact`,
 * and is never answered from source as a convenience.
 *
 * It is read as **text through the compiler API** rather than `await import`ed,
 * for two reasons and not one. A host is synchronous, which is Phase 1's shape
 * and the reason the whole estate can be iterated in one pass; and an import
 * evaluates whatever the artefact's own import graph reaches, which for a module
 * is the platform an author may not have installed. Reading literal AST nodes
 * costs the same discipline every analysis in this estate already keeps.
 *
 * **One reader, and it fails closed.** A field it cannot read as a literal is
 * `null` / absent rather than guessed at, and the rule that needs it reports
 * `unreadable` — never a clean run over a manifest this run could not see.
 */
function readEmittedManifest(layout: PackageLayout): EmittedManifest | null {
  const root = layout.layers.find((layer) => layer.subpath === '.');
  if (root === undefined) return null;
  const artefact = join(layout.packageRoot, ...root.target.replace(/^\.\//, '').split('/'));
  try {
    const artefactStat = statSync(artefact);
    const sourceStat = statSync(root.entry);
    if (sourceStat.mtimeMs > artefactStat.mtimeMs) return null;
  } catch {
    return null;
  }

  const sf = ts.createSourceFile(
    artefact,
    readFileSync(artefact, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  let bundlesDir: string | null = null;
  const actions: EmittedAction[] = [];

  const literal = (node: ts.Node | undefined): string | null =>
    node !== undefined && ts.isStringLiteralLike(node) ? node.text : null;
  const property = (
    object: ts.ObjectLiteralExpression,
    name: string,
  ): ts.Expression | undefined =>
    object.properties.find(
      (member): member is ts.PropertyAssignment =>
        ts.isPropertyAssignment(member) &&
        (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
        member.name.text === name,
    )?.initializer;

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const dir = literal(property(node, 'bundlesDir'));
      if (dir !== null) bundlesDir = dir;
      const declared = property(node, 'actions');
      if (declared !== undefined && ts.isArrayLiteralExpression(declared)) {
        for (const element of declared.elements) {
          if (!ts.isObjectLiteralExpression(element)) continue;
          const actionId = literal(property(element, 'id'));
          const targetRoute = literal(property(element, 'targetRoute'));
          if (actionId === null || targetRoute === null) continue;
          const required = literal(property(element, 'requiredPermission'));
          actions.push({
            id: actionId,
            targetRoute,
            ...(required === null ? {} : { requiredPermission: required }),
          });
        }
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);

  return { bundlesDir, actions };
}

/**
 * Every file under `dir`, with the rule's own declared directory prunes applied.
 *
 * The prune is for speed and the population is {@link isScannablePath}'s, which
 * is the rule — one decision, taken in one place, exactly as the repository
 * host's walk takes it.
 */
function walkEverything(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIPPED_DIRECTORIES[name] !== undefined) continue;
    const full = join(dir, name);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walkEverything(full, out);
    else if (stat.isFile()) out.push(full);
  }
  return out;
}

/**
 * Every rule with a package-scope host in this build.
 *
 * `check-inventory.test.ts` reconciles this map against the estate manifest:
 * an entry declaring `host: 'built'` with no host here fails, and a host with no
 * such entry fails too (`data-model.md` §1, invariant 4).
 */
export const PACKAGE_HOSTS: ReadonlyMap<string, PackageRuleHost> = new Map<
  string,
  PackageRuleHost
>([
  ['channel:resolution', channelResolution],
  ['check:bundle-pairing', bundlePairing],
  ['check:command-coverage', commandCoverage],
  ['check:container-imports', containerImports],
  ['check:default-language-prose', defaultLanguageProse],
  ['check:diacritic-folds', diacriticFolds],
  ['check:entry-scope', entryScope],
  ['check:kernel-boundary', kernelBoundary],
  ['check:nul-bytes', nulBytes],
  ['check:platform-surface', platformSurface],
  ['check:port-shape', portShape],
  ['check:subscribe-seam', subscribeSeam],
  ['check:transaction-context', transactionContext],
]);
