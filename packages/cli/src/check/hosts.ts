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
import { join, relative, sep } from 'node:path';

import { SUPPORTED_LANGUAGES } from '@endora-commerce/contracts';

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
  checkSubscribeSeam,
  checkWorkerSeam,
  collectSeamFiles,
  keyOf as subscriptionKeyOf,
  workerKeyOf,
} from '../rules/subscribe-seam.js';

import { estateEntry, type EstateEntry } from './estate.js';
import { layerExpectation, type PackageLayout } from './layout.js';
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

  const bundlesDir = manifest.i18n?.bundlesDir ?? null;
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

/* ------------------------------------------------------------------ helpers */

/** The manifest shape this run reads out of the package's root export. */
interface EmittedManifest {
  readonly i18n?: { readonly bundlesDir?: string };
}

/**
 * The module manifest, read where the **platform** reads it.
 *
 * A rule whose subject is something the platform *loads* reads the emitted file
 * — that is not a shortcut, it is the only thing a published package has, and
 * answering from source would make this command's verdict differ from the
 * platform's, which is the one thing a conformance command must not do.
 */
function readEmittedManifest(layout: PackageLayout): EmittedManifest | null {
  const root = layout.layers.find((layer) => layer.subpath === '.');
  if (root === undefined) return null;
  const artefact = join(layout.packageRoot, ...root.target.replace(/^\.\//, '').split('/'));
  const source = root.entry;
  try {
    const artefactStat = statSync(artefact);
    const sourceStat = statSync(source);
    if (sourceStat.mtimeMs > artefactStat.mtimeMs) return null;
  } catch {
    return null;
  }
  // The manifest's own declaration is read as text rather than imported: an
  // `await import` of a module package's artefact drags in the platform, which
  // an author who has not installed it does not have — and the question here is
  // one literal field.
  const text = readFileSync(artefact, 'utf8');
  const match = /bundlesDir\s*:\s*'([^']+)'|bundlesDir\s*:\s*"([^"]+)"/.exec(text);
  const dir = match?.[1] ?? match?.[2];
  return dir === undefined ? {} : { i18n: { bundlesDir: dir } };
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
  ['check:bundle-pairing', bundlePairing],
  ['check:command-coverage', commandCoverage],
  ['check:container-imports', containerImports],
  ['check:nul-bytes', nulBytes],
  ['check:subscribe-seam', subscribeSeam],
]);
