// The deployment divergence report — the two renderings, from one derivation,
// and the assembly the report's two hosts share.
//
// ## Why this is in the package
//
// It was `backend/src/overlay/divergence-report.ts` until
// `specs/110-instance-repository/` T138a. The derivation beside it
// (`divergence.ts`) moved out of `backend/scripts/` in the same task and for the
// same reason: the report has **two hosts** — `overlay:divergence` over this
// repository, and `endora generate` inside a client's instance, whose
// `apps/<deployment>/` tree is the very thing `instance-tree.md` §2.2 writes and
// which nothing could render a report over. `instance-repository.md` R3.5 is
// that the population is a parameter and the renderer is one program, which is
// what `admin-artefacts.ts` and `docs-artefacts.ts` already do for the two other
// artefact families an instance builds from.
//
// `backend/test/unit/kernel/host-residue-partition.test.ts` had already
// classified the file as platform-shaped residue and named its retiring
// condition as *"the `overlay/` half of FR-013"* — the platform. That premise is
// **corrected rather than met**: the platform is a runtime dependency of every
// instance and a renderer has no runtime reader, while the CLI already has the
// compiler, is a `devDependency` and is the tool that generates an instance's
// other artefacts. The ledger entry retires here.
//
// **One derivation, two renders** (`data-model.md` §3). The alternative — a
// second derivation for the human rendering — was rejected as two answers to one
// question waiting to disagree; `serializeManifestModule` already had this shape
// and feature 100's generated module map is the precedent for the `.md`.
//
// The report supersedes the v2 override manifest, which recorded exactly one
// fact: which overlay modules a deployment adds. That field survives here as
// `overlayModules`, and it is legitimately empty for a deployment shipping no
// overlay module — so `overlay:check`'s `empty` verdict does not apply to either
// rendering. A deployment that diverges by nothing says so explicitly, which is
// the whole difference between an empty report and an absent one.
//
// ## The headers are parameters, on `admin-artefacts.ts`' precedent
//
// The two hosts tell a reader different things to run — `overlay:divergence`
// here, `endora generate` in an instance — and an artefact naming the wrong one
// would send a client to a script their tree does not have. The defaults are
// this repository's exact strings, so its six committed artefacts are
// byte-identical across the move.
//
// **It reaches for nothing outside itself since `specs/110-instance-repository/`
// T114a.** Its one application dependency was `repoRoot`, imported for exactly
// one consumer — `repoRelativePath`, an export with no caller anywhere in the
// repository. (The four apparent hits in `check-module-boundary.ts` are an
// unrelated *parameter* name, `(repoRelativePath: string) => boolean`.) A dead
// export is the cheapest possible thing to be blocked on, and leaving it
// standing is what made this file look blocked: `contracts/application-root-supplier.md`
// §5.

import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import ts from 'typescript';

import type { DivergenceEntry, DivergenceKind, DivergenceReport } from '@endora-commerce/contracts';

import {
  claimFileOnce,
  deriveDivergence,
  moduleContextSeams,
  routeIdentities,
  type DivergenceInput,
  type DivergenceResult,
  type OverlaySource,
  type RouteSource,
} from './divergence.js';
import type { ModulePackage } from './module-packages.js';
import {
  mergeRegistrationOwners,
  rootSuppliedNames,
  type OwnerClaim,
} from './registration-owners.js';
import {
  providedPortNames,
  registeredNames,
  rootRegisteredNames,
} from './port-registrations.js';

/**
 * What each rung costs, in the words a reader who has never seen this repository
 * needs (SC-001).
 *
 * The human rendering spells the **cost** rather than the number, because a
 * number is only meaningful to somebody who has the ladder open beside them —
 * and the reader this artefact exists for is a client's developer who has not.
 * The full ladder is `docs/docs/architecture/customisation-ladder.md`; these are
 * its one-line summaries and they are kept in step by
 * `test/unit/overlay/divergence-render.test.ts`.
 */
export const RUNG_COSTS: Readonly<Record<number, string>> = {
  0: 'rung 0 — configuration. Costs nothing and survives every upgrade, because it is data.',
  1: 'rung 1 — subscribe to what the owner already emits. Costs nothing at the seam; you observe, you do not change what the owner did.',
  2: 'rung 2 — run before or after what the owner already serves. Costs a coupling to an endpoint identity, which is versioned public API.',
  3: 'rung 3 — a strategy port the owner published. Costs a dependency edge in your manifest; the owner keeps the seam and keeps fixing it behind you.',
  4: 'rung 4 — change what the container hands out. Costs a contract-version coupling to a shape nothing checks for you: `ctx.di.decorate<T>` asserts `T` at the call site and compares it to nothing.',
  5: 'rung 5 — fork. Costs everything, permanently.',
};

/** The heading each kind gets in the human rendering. */
const KIND_HEADINGS: Readonly<Record<DivergenceKind, string>> = {
  omission: 'Modules this deployment does not ship',
  registration: 'Services this deployment adds to the container',
  'port-provided': 'Ports this deployment publishes',
  'port-consumed': 'Ports this deployment consumes',
  subscription: 'Events this deployment subscribes to',
  interceptor: 'Endpoints this deployment intercepts',
  decoration: 'Registrations this deployment wraps',
  'root-plugin': 'Plugins this deployment mounts at the server root',
  worker: 'Queues this deployment consumes',
};

/** Stable order for the human rendering — most invasive last is not the point;
 *  a reader wants the same order every time, so it is the ladder's own. */
const KIND_ORDER: readonly DivergenceKind[] = [
  'omission',
  'subscription',
  'interceptor',
  'port-provided',
  'port-consumed',
  'decoration',
  'root-plugin',
  'registration',
  'worker',
];

/**
 * The "do not edit" headers this repository's own generator writes.
 *
 * Parameters rather than literals, on `admin-artefacts.ts`' and
 * `docs-artefacts.ts`' precedent: the two hosts tell a reader different things
 * to run, and an artefact naming the wrong one would send a client to a script
 * their tree does not have. The default is this repository's, so its committed
 * artefacts are byte-identical across the move and a host that means the other
 * one says so.
 */
export const COMPOSER_DIVERGENCE_MODULE_HEADER =
  `// AUTO-GENERATED by scripts/generate-divergence.ts — DO NOT EDIT.\n` +
  `// Run \`pnpm --filter backend run overlay:divergence\` (or rebuild) to refresh.\n` +
  `// Deterministic record of this deployment's divergence from core.\n`;

/** The same, for the human rendering, whose comment syntax is HTML's. */
export const COMPOSER_DIVERGENCE_MARKDOWN_HEADER = [
  '<!-- AUTO-GENERATED by scripts/generate-divergence.ts \u2014 DO NOT EDIT. -->',
  '<!-- Run `pnpm --filter backend run overlay:divergence` (or rebuild) to refresh. -->',
];

/**
 * Emit the report as a committed, typed TS module (mirrors
 * `manifest-index.generated.ts`).
 *
 * `typesImportSpecifier` is the module-resolvable path from the emitted file's
 * directory to `src/overlay/types.js` — it differs between the core output
 * (`./types.js`) and a deployment output (`../../overlay/types.js`), so the
 * caller computes and passes it.
 */
export function serializeDivergenceModule(
  report: DivergenceReport,
  typesImportSpecifier: string,
  header: string = COMPOSER_DIVERGENCE_MODULE_HEADER,
): string {
  const body = JSON.stringify(report, null, 2);
  return `${header}
import type { DivergenceReport } from '${typesImportSpecifier}';

export const DIVERGENCE_REPORT: DivergenceReport = ${body};
`;
}

/** Stable JSON serialization, for a caller that wants the shape and no module. */
export function serializeDivergenceJson(report: DivergenceReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function ownerCell(entry: DivergenceEntry): string {
  if (entry.kind === 'omission') return '—';
  return entry.owner === null ? 'a composition root (no module owns it)' : `\`${entry.owner}\``;
}

function subjectCell(entry: DivergenceEntry): string {
  if (entry.kind === 'interceptor' && entry.detail.kind === 'interceptor') {
    return `\`${entry.subject}\` (${entry.detail.phase})`;
  }
  return `\`${entry.subject}\``;
}

/**
 * The human rendering — D-30's own word for this artefact is *report*.
 *
 * Three rules, all of them SC-001's: no key strings (a reader is not looking
 * anything up), no repository-relative paths (the reader's tree is not this
 * one), and the rung's **cost** spelled out rather than its number.
 */
export function renderDivergenceMarkdown(
  report: DivergenceReport,
  header: readonly string[] = COMPOSER_DIVERGENCE_MARKDOWN_HEADER,
): string {
  const lines: string[] = [];
  const isCore = report.deployment === 'core';

  lines.push(...header);
  lines.push('');
  lines.push(
    isCore
      ? '# Divergence from core: bare core'
      : `# Divergence from core: \`${report.deployment}\``,
  );
  lines.push('');
  lines.push(
    'Every way this deployment differs from the platform it was built on, derived from its own',
    'tree. It is the first thing to consult when an upgrade changes behaviour you depended on.',
    '',
    'Each entry names **what** was changed, **which of this deployment’s modules** changed it,',
    '**which module owns** the thing that was changed, what the change **costs**, and the',
    'sentence this deployment wrote when it made the change.',
    '',
  );

  if (isCore) {
    lines.push(
      'This is the bare-core build: no deployment is selected, so there is nothing to diverge',
      'from core *with*. It is generated and committed anyway, because an absent report and a',
      'report that says "nothing" are indistinguishable, and only one of them is a statement.',
      '',
    );
  }

  lines.push('## What this deployment adds');
  lines.push('');
  if (report.overlayModules.length === 0) {
    lines.push('No overlay modules. This deployment ships the platform’s own module set.');
  } else {
    lines.push('| Overlay module |');
    lines.push('| --- |');
    for (const moduleId of report.overlayModules) lines.push(`| \`${moduleId}\` |`);
  }
  lines.push('');

  lines.push('## What this deployment changes');
  lines.push('');
  if (report.entries.length === 0) {
    lines.push(
      'Nothing. This deployment changes no registration, intercepts no endpoint, subscribes to no',
      'event, publishes and consumes no port, mounts no root plugin and omits no module.',
      '',
      'That is a statement rather than an absence: the derivation ran over this deployment’s own',
      'tree and found no divergence of any recorded kind.',
    );
    lines.push('');
  } else {
    for (const kind of KIND_ORDER) {
      const entries = report.entries.filter((entry) => entry.kind === kind);
      if (entries.length === 0) continue;
      lines.push(`### ${KIND_HEADINGS[kind]}`);
      lines.push('');
      const rungs = [...new Set(entries.map((entry) => entry.rung))].filter(
        (rung): rung is number => rung !== null,
      );
      for (const rung of rungs.sort((a, b) => a - b)) {
        const cost = RUNG_COSTS[rung];
        if (cost !== undefined) lines.push(`${cost}`, '');
      }
      lines.push('| What | Changed by | Owned by | Why |');
      lines.push('| --- | --- | --- | --- |');
      for (const entry of entries) {
        const changedBy = entry.kind === 'omission' ? '—' : `\`${entry.module}\``;
        lines.push(
          `| ${escapeCell(subjectCell(entry))} | ${changedBy} | ${escapeCell(ownerCell(entry))} | ` +
            `${escapeCell(entry.reason.length === 0 ? '**not declared**' : entry.reason)} |`,
        );
      }
      lines.push('');
    }
  }

  lines.push('## What this report does not cover');
  lines.push('');
  lines.push(
    'A report that lists what it records and says nothing about the rest is indistinguishable',
    'from a complete one. These are the seams that exist and are deliberately not divergences,',
    'and the facts only a running instance can answer.',
    '',
  );
  lines.push('### Seams that are a module’s own business');
  lines.push('');
  lines.push('| Seam | Why it is not a divergence |');
  lines.push('| --- | --- |');
  for (const entry of report.boundary.notRecorded) {
    lines.push(`| \`${escapeCell(entry.seam)}\` | ${escapeCell(entry.why)} |`);
  }
  lines.push('');
  lines.push('### Facts only a running instance knows');
  lines.push('');
  lines.push('| Fact | Why it is not here |');
  lines.push('| --- | --- |');
  for (const entry of report.boundary.runtimeOnly) {
    lines.push(`| ${escapeCell(entry.fact)} | ${escapeCell(entry.why)} |`);
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// The assembly both hosts share
// ---------------------------------------------------------------------------

/**
 * Every TypeScript or emitted-JavaScript source under a root, recursively.
 *
 * One walk rather than one per host, because the two hosts read two *different
 * dialects of the same tree* — this repository's modules are sources and an
 * instance's are the `dist` those sources compile to — and the analysis is the
 * compiler API either way (`registeredNames` and `routeIdentities` both parse
 * with `ts.createSourceFile`, which reads emitted JavaScript as readily as it
 * reads TypeScript). Measured on `packages/modules/blog`: the six container
 * names and the twenty-nine route identities its sources yield are the same six
 * and the same twenty-nine its `dist/backend` yields.
 *
 * `.d.ts` is excluded here and asked for separately by {@link seamsFromKernel},
 * which is the one input whose instance answer is a declaration file.
 */
export function walkAnalysableSources(root: string, out: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walkAnalysableSources(full, out);
    } else if (/\.(?:[cm]?js|ts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * A deployment's own overlay sources, attributed to the overlay module that
 * owns them.
 *
 * `base` is the root the reported path is relative to — this repository's root
 * here, the instance's root there — so an entry names a path in the reader's own
 * tree and never in ours (SC-001's second rule).
 */
export function overlaySourcesUnder(
  overlayRoot: string | null,
  moduleIds: readonly string[],
  base: string,
): OverlaySource[] {
  if (overlayRoot === null) return [];
  const sources: OverlaySource[] = [];
  for (const moduleId of moduleIds) {
    for (const file of walkAnalysableSources(join(overlayRoot, moduleId))) {
      sources.push({
        moduleId,
        file: relative(base, file).split(sep).join('/'),
        text: readFileSync(file, 'utf8'),
      });
    }
  }
  return sources;
}

/**
 * Everything one run needs that does not change between deployments.
 *
 * Four facts, and the whole of what the two hosts differ about is **how each is
 * assembled** — never what it is. `contracts/divergence-report.md` §3.2's
 * *"it is not recomputed here"* is the same instruction one host over.
 */
export interface DivergenceEnvironment {
  /** Container name → the module that registers it. */
  readonly owners: ReadonlyMap<string, string>;
  /** Names a composition root supplies, which no module owns. */
  readonly rootSupplied: ReadonlySet<string>;
  /** Every `"<METHOD> <path>"` the composition serves, and who owns it. */
  readonly routes: ReadonlyMap<string, string | null>;
  /** `ModuleContext`'s own members. */
  readonly seams: readonly string[];
  /** Files this assembly opened — half of the run's `files`. */
  readonly filesRead: number;
}

/** One rendering a host asks for: where it goes and in which dialect. */
export type DivergenceRenderingSpec =
  | {
      readonly rendering: 'module';
      readonly outputPath: string;
      /** The module-resolvable specifier the emitted file imports `DivergenceReport` from. */
      readonly typesImportSpecifier: string;
      readonly header?: string;
      readonly label: string;
    }
  | {
      readonly rendering: 'markdown';
      readonly outputPath: string;
      readonly header?: readonly string[];
      readonly label: string;
    }
  | { readonly rendering: 'json'; readonly outputPath: string; readonly label: string };

/** One rendering, rendered. */
export interface DivergenceRendering {
  readonly outputPath: string;
  readonly content: string;
  /** The label `overlay:check` and `endora generate` print. */
  readonly label: string;
}

export interface RenderedDivergenceArtefacts {
  readonly result: DivergenceResult;
  readonly renderings: readonly DivergenceRendering[];
}

/**
 * One derivation, N renderings (`data-model.md` §3).
 *
 * The loop is here rather than in either host for the reason the file header
 * gives: a second derivation for a second rendering is two answers to one
 * question waiting to disagree, and the moment there were three renderings
 * across two hosts that stopped being hypothetical.
 */
export function renderDivergenceArtefacts(
  input: DivergenceInput,
  specs: readonly DivergenceRenderingSpec[],
): RenderedDivergenceArtefacts {
  const result = deriveDivergence(input);
  const renderings = specs.map((spec): DivergenceRendering => {
    switch (spec.rendering) {
      case 'module':
        return {
          outputPath: spec.outputPath,
          content: serializeDivergenceModule(
            result.report,
            spec.typesImportSpecifier,
            spec.header ?? COMPOSER_DIVERGENCE_MODULE_HEADER,
          ),
          label: spec.label,
        };
      case 'markdown':
        return {
          outputPath: spec.outputPath,
          content: renderDivergenceMarkdown(
            result.report,
            spec.header ?? COMPOSER_DIVERGENCE_MARKDOWN_HEADER,
          ),
          label: spec.label,
        };
      case 'json':
        return {
          outputPath: spec.outputPath,
          content: serializeDivergenceJson(result.report),
          label: spec.label,
        };
    }
  });
  return { result, renderings };
}

/**
 * Does the overlay tree **spell** a seam call at all?
 *
 * A second author for the "no seam call of any kind read" refusal
 * (`divergence-report.md` §5, refusal 3), and the reason it is a text probe
 * rather than a second walk: what has to be caught is the *syntax walk* going
 * blind, and a second syntax walk would go blind with it. With two overlay
 * modules in this repository, a resolver that stopped recognising
 * `ctx.di.decorate` prints a clean report over a tree full of decorations, and
 * `sites=0` is indistinguishable from a deployment that only registers routes —
 * which is a legal thing for an overlay module to do. This tells the two apart.
 */
export function overlayTreeSpellsASeamCall(sources: readonly OverlaySource[]): boolean {
  const spellings = [
    'di.register(',
    'di.providePort(',
    'di.decorate(',
    '.subscribe(',
    '.interceptors(',
    '.rootPlugin(',
    '.worker(',
    'lazyPort(',
    'lazyPort<',
  ];
  return sources.some((source) => spellings.some((spelling) => source.text.includes(spelling)));
}

// ---------------------------------------------------------------------------
// The instance host's half: a composition made of installed packages
// ---------------------------------------------------------------------------

/**
 * What an instance's report cannot derive, each with a reason (FR-018).
 *
 * **Every one of the nine kinds is derived in an instance exactly as it is
 * here**, because the population of all nine is the deployment's own overlay
 * tree — `apps/<deployment>/modules/**` — which is the client's own source and
 * is read by the same walk. What differs is **attribution**, in one place, and
 * that one place is written down here rather than left to be discovered by a
 * client reading a report with a silent hole in it.
 *
 * `HOST_REGISTERED_PORTS` is the bridging table `check:port-dependencies`
 * carries: names this repository's composition roots register *on an unconverted
 * module's behalf*, each with its own retiring condition. It is a judgement about
 * this repository's roots and nothing derives it, so it has no instance
 * equivalent — in an instance those names are registered by `composeApp` inside
 * `@endora-commerce/platform`, the walk finds them there, and they come out as
 * root-supplied. That answer is *true of the instance*; it is simply less
 * specific than ours, and a client who did not know that would read `a
 * composition root (no module owns it)` and conclude nothing owns it.
 */
export const INSTANCE_BOUNDARY_NOTES: ReadonlyArray<{
  readonly seam: string;
  readonly why: string;
}> = [
  {
    seam: 'the module behind a container name the platform registers on its behalf',
    why:
      "such a name is reported as a composition root's rather than as that module's. The " +
      'mapping is a judgement about a composition root, not a fact a walk produces, and this ' +
      'instance has no composition root of its own — `composeApp` is the platform’s. Every ' +
      'name a module registers for itself is attributed to that module — this deployment’s ' +
      'own overlay modules included, from their own sources — which is every name ' +
      'an overlay module is likely to decorate',
  },
  {
    seam: 'what an installed module package would register if it shipped its sources',
    why:
      'container names and route identities are read from each package’s published `./backend` ' +
      'artefact, which is the module version this instance installed. That is the composition ' +
      'this deployment actually runs; it is not the module’s source tree, and a name reachable ' +
      'only from a layer the package does not publish is in no owner map',
  },
];

/** One installed package this run could not read, named rather than skipped. */
export interface UnreadableCompositionInput {
  readonly packageName: string;
  readonly at: string;
  readonly reason: string;
}

export interface InstanceCompositionScan {
  readonly environment: DivergenceEnvironment;
  readonly unreadable: readonly UnreadableCompositionInput[];
  /** Module packages that contributed at least one analysable file. */
  readonly covered: number;
  /** Module packages that publish a `./backend` subpath at all. */
  readonly expected: number;
}

/** The absolute path a package's declared `exports` subpath resolves to. */
function subpathTargetOf(
  pkg: { dir: string; exports: ReadonlyMap<string, string> },
  subpath: string,
): string | null {
  const target = pkg.exports.get(subpath);
  if (target === undefined) return null;
  return join(pkg.dir, target.replace(/^\.\//, ''));
}

/**
 * `ModuleContext`'s members, out of whatever file beside the platform's
 * `./kernel` entry point declares the interface.
 *
 * A **search** rather than a spelled path, and deliberately: the entry point is
 * a barrel and re-exports the interface rather than declaring it, so the
 * declaration is in a sibling — and which sibling is the platform's own business
 * and its build layout's, neither of which this file may assert (D-100). The
 * interface *name* is the one thing that is contract here, and it is already
 * spelled exactly once, in `moduleContextSeams`.
 */
export function seamsFromKernel(kernelEntry: string): readonly string[] {
  const directory = dirname(kernelEntry);
  let names: string[];
  try {
    names = readdirSync(directory).sort();
  } catch {
    return [];
  }
  for (const name of names) {
    if (!/\.ts$/.test(name)) continue;
    const full = join(directory, name);
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    const seams = moduleContextSeams(readFileSync(full, 'utf8'));
    if (seams.length > 0) return seams;
  }
  return [];
}

/**
 * The composition an instance runs, read out of what it installed.
 *
 * Three of the four facts come from the same two walks: each module package's
 * published `./backend` layer, and the platform's own. The fourth —
 * `ModuleContext`'s members — comes from the platform's shipped kernel
 * declarations, which yield byte-identically what this repository's source does
 * (measured: the same sixteen members, in the same order).
 *
 * A package that publishes no `./backend` subpath is an admin- or
 * storefront-only module: it registers nothing and serves nothing, so it is
 * *readable and empty* rather than unreadable, exactly as
 * `package-declarations.ts` classifies the same state. A package that publishes
 * one whose target the walk cannot open is **named**, because an unread package
 * is a package whose registrations are in no owner map and every decoration of
 * one of its names would read `unowned-subject` — a finding about the run
 * dressed as a finding about the tree.
 */
export function instanceComposition(input: {
  readonly packages: readonly ModulePackage[];
  /** The installed platform, or `null` when it does not resolve. */
  readonly platform: { readonly dir: string; readonly exports: ReadonlyMap<string, string> } | null;
}): InstanceCompositionScan {
  const claims: OwnerClaim[] = [];
  const platformNames = new Set<string>();
  const routeSources: RouteSource[] = [];
  const unreadable: UnreadableCompositionInput[] = [];
  const claimFile = claimFileOnce();
  let filesRead = 0;
  let covered = 0;
  let expected = 0;

  for (const pkg of input.packages) {
    const backend = subpathTargetOf(pkg, './backend');
    if (backend === null) continue;
    expected += 1;
    const files = walkAnalysableSources(dirname(backend));
    if (files.length === 0) {
      unreadable.push({
        packageName: pkg.name,
        at: backend,
        reason:
          'it publishes a "./backend" subpath beside which the walk found no source at all, so ' +
          'the container names and the routes it owns are in no map',
      });
      continue;
    }
    covered += 1;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      filesRead += 1;
      if (claimFile(file)) routeSources.push({ file, text, moduleId: pkg.moduleId });
      for (const name of registeredNames(text, file)) claims.push({ name, moduleId: pkg.moduleId });
      for (const name of providedPortNames(text, file)) {
        claims.push({ name, moduleId: pkg.moduleId });
      }
    }
  }

  let seams: readonly string[] = [];
  if (input.platform !== null) {
    for (const file of walkAnalysableSources(input.platform.dir)) {
      const text = readFileSync(file, 'utf8');
      filesRead += 1;
      if (claimFile(file)) routeSources.push({ file, text, moduleId: null });
      for (const name of registeredNames(text, file)) platformNames.add(name);
      for (const name of providedPortNames(text, file)) platformNames.add(name);
      // The **root** spelling as well, and it is not an optimisation: in an
      // instance `composeApp` is the composition root and it writes
      // `registerValues(container, { … })`, which `registeredNames` does not
      // read. Measured on a real scaffolded instance with only the two module
      // spellings: an overlay module decorating `commandBus` was reported
      // `unowned-subject`, which is the exact state `rootSuppliedNames`' own doc
      // block says it exists to prevent — a finding about the run dressed as one
      // about the tree.
      for (const name of rootRegisteredNames(text, file)) platformNames.add(name);
    }
    const kernel = subpathTargetOf(input.platform, './kernel');
    if (kernel !== null) seams = seamsFromKernel(kernel);
  }

  // `hostRegistered` is empty on purpose and the emptiness is the narrowing
  // `INSTANCE_BOUNDARY_NOTES` states: the bridging table is a judgement about
  // *this repository's* composition roots, and an instance has none of its own.
  const owners = mergeRegistrationOwners({
    hostRegistered: {},
    treeClaims: [],
    packageClaims: claims,
  });

  return {
    environment: {
      owners,
      // The platform's own registrations are both halves at once here: it is the
      // kernel *and* the composition root an instance runs, `composeApp` being
      // the platform's. `rootSuppliedNames` drops every name a module claimed,
      // so a module that registers a name the platform also spells keeps it.
      rootSupplied: rootSuppliedNames({ rootNames: [], kernelNames: platformNames, owners }),
      routes: routeIdentities(routeSources),
      seams,
      filesRead,
    },
    unreadable,
    covered,
    expected,
  };
}

/**
 * The scan's environment, with the **deployment's own** overlay registrations
 * merged into the owner map (`specs/124-instance-customisation-gap/` FR-005,
 * FR-006, FR-007).
 *
 * ## Why it is a second step rather than a fourth input to `instanceComposition`
 *
 * That function is documented as *"everything one run needs that does not change
 * between deployments"*, and the overlay claim set is **per deployment** — a
 * report is rendered once per directory under `apps/`. The package half is where
 * the scan's cost is (one platform walk plus one per installed package, against
 * one small overlay tree), so hoisting it and merging here is the shape that
 * repairs the defect without making the expensive half run once per deployment.
 *
 * ## Why it is a conformance repair and not a widening
 *
 * `contracts/divergence-report.md` §3.2 specifies the owner map as *"module
 * sources plus each installed package's `./backend` artefact"*, and this
 * repository's own host already obeys it: `moduleWalkRoots` contains
 * `overlayRoot`. The instance host was the one out of conformance — it built
 * `owners` from installed packages and `rootSupplied` from the platform walk,
 * and the client's own overlay tree was in neither. Measured by A8 of the
 * instance acceptance criterion: one rendering listing
 * `registration:<overlay>:<name>` and reporting `unowned-subject` for `<name>`,
 * whose remedy sentence — *"Composition throws for it at boot"* — was untrue of
 * a tree that had just booted.
 *
 * ## The claim is keyed from `OverlaySource.moduleId`, never from `moduleOf`
 *
 * FR-006, and it is not a preference: `moduleOf`'s overlay branch requires
 * `/src/apps/` in the path and an instance's overlay root is
 * `<root>/apps/<deployment>/modules/`, so a claim placed by path would attribute
 * nothing at all here. `overlaySourcesUnder` already carries the id, from the
 * directory the walk descended into.
 *
 * The precedence is `registration-owners.ts`': the deployment's own tree is the
 * **tree** half and overwrites, an installed package claims only what nothing
 * above claimed. That is the right way round — a name the client registers in
 * their own overlay module is theirs — and it is the same rule this repository's
 * host applies to its own `backend/src/apps/` sources.
 */
export function withOverlayRegistrationOwners(
  environment: DivergenceEnvironment,
  sources: readonly OverlaySource[],
): DivergenceEnvironment {
  const overlayClaims: OwnerClaim[] = [];
  for (const source of sources) {
    for (const name of registeredNames(source.text, source.file)) {
      overlayClaims.push({ name, moduleId: source.moduleId });
    }
    for (const name of providedPortNames(source.text, source.file)) {
      overlayClaims.push({ name, moduleId: source.moduleId });
    }
  }
  if (overlayClaims.length === 0) return environment;

  const owners = mergeRegistrationOwners({
    // The scan's map seeds this one, in the slot the merge rule gives to a
    // claim already settled: the packages have been merged against each other
    // and the question here is only what the deployment adds on top.
    hostRegistered: Object.fromEntries(environment.owners),
    treeClaims: overlayClaims,
    packageClaims: [],
  });
  return {
    ...environment,
    owners,
    // A name a module owns is not root-supplied, and the deployment's overlay
    // module is a module: without this, a client registering a name the platform
    // also spells would have it in both, and `deriveDivergence` reads
    // `rootSupplied` only to decide that an absent owner is legitimate.
    rootSupplied: new Set(
      [...environment.rootSupplied].filter((name) => owners.get(name) === undefined),
    ),
  };
}

/** The refusal sentence, or `null` when every package this run needed was readable. */
export function unreadableCompositionReason(scan: InstanceCompositionScan): string | null {
  if (scan.unreadable.length === 0) return null;
  const named = scan.unreadable
    .map((entry) => `${entry.packageName}: ${entry.reason} (${entry.at})`)
    .join('; ');
  return (
    `${scan.unreadable.length} of the ${scan.expected} installed module package(s) publishing a ` +
    `"./backend" subpath could not be read, so what they register is in no owner map and every ` +
    `decoration of one of their names would be reported as owned by nobody — ${named}`
  );
}

// ---------------------------------------------------------------------------
// The declaration, read as source text
// ---------------------------------------------------------------------------

/** The three fields a deployment declares (`deployment-declaration.md` §2). */
export interface DeclarationLiterals {
  readonly omittedModules: ReadonlyArray<{ readonly moduleId: string; readonly reason: string }>;
  readonly decorationOrder: Readonly<Record<string, readonly string[]>>;
  readonly reasons: Readonly<Record<string, string>>;
}

/** The empty declaration — what a deployment that has declared nothing says. */
export const EMPTY_DECLARATION: DeclarationLiterals = {
  omittedModules: [],
  decorationOrder: {},
  reasons: {},
};

export interface DeclarationReading {
  readonly declaration: DeclarationLiterals;
  /**
   * Fields the analysis could not resolve to literals, each named.
   *
   * Never merged into "declares nothing": an absent declaration and one this run
   * could not read are the same answer only if you let them be, and that is the
   * exact silence `divergence-loader.ts`' own header records as having hidden a
   * broken root derivation from every deployment in the tree.
   */
  readonly unresolved: readonly string[];
}

/** A string written as a literal, a plain template, or a `+` chain of those. */
function stringLiteralOf(node: ts.Expression | undefined): string | null {
  if (node === undefined) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return stringLiteralOf(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = stringLiteralOf(node.left);
    const right = stringLiteralOf(node.right);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

/** An object-literal or string-literal property name, as written. */
function propertyNameOf(name: ts.PropertyName | undefined): string | null {
  if (name === undefined) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
      current = current.expression;
    } else if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

/**
 * A deployment's declaration, out of the file's **source text**.
 *
 * The running platform `import()`s this file; this run may not, and the reason
 * is not a preference. `endora` runs as compiled JavaScript under plain `node`,
 * and an instance's `apps/<deployment>/divergence.ts` is TypeScript — there is
 * no loader in the process that could evaluate it, and adding one would make a
 * scaffolding tool evaluate a client's code in order to describe it. Reading the
 * text is also what the rest of this analysis does: the whole derivation is
 * *"every subject is read as a literal"* (§3.3), and the declaration is held to
 * the same rule as the tree it describes.
 *
 * What that costs is stated rather than discovered: a declaration whose fields
 * are computed — spread from another module, built in a loop — resolves to
 * nothing and is **named** in {@link DeclarationReading.unresolved}, never
 * silently read as empty.
 */
export function readDivergenceDeclaration(source: string, file: string): DeclarationReading {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const unresolved: string[] = [];

  let literal: ts.ObjectLiteralExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (literal !== null) return;
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === 'divergence' &&
          declaration.initializer !== undefined
        ) {
          const initializer = unwrap(declaration.initializer);
          if (ts.isObjectLiteralExpression(initializer)) literal = initializer;
          else unresolved.push('divergence (the declaration is not an object literal)');
        }
      }
    }
    if (ts.isExportAssignment(node) && node.isExportEquals !== true) {
      const expression = unwrap(node.expression);
      if (ts.isObjectLiteralExpression(expression)) literal = expression;
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);

  if (literal === null) return { declaration: EMPTY_DECLARATION, unresolved };

  const fields = new Map<string, ts.Expression>();
  for (const property of (literal as ts.ObjectLiteralExpression).properties) {
    if (ts.isPropertyAssignment(property)) {
      const name = propertyNameOf(property.name);
      if (name !== null) fields.set(name, unwrap(property.initializer));
      continue;
    }
    // A spread, a shorthand or a method: the field's value is somewhere else,
    // which is exactly the state that must not read as "declares nothing".
    unresolved.push('divergence (a property whose value is not written in place)');
  }

  const omittedModules: Array<{ moduleId: string; reason: string }> = [];
  const omitted = fields.get('omittedModules');
  if (omitted !== undefined) {
    if (!ts.isArrayLiteralExpression(omitted)) {
      unresolved.push('omittedModules (not an array literal)');
    } else {
      for (const element of omitted.elements) {
        const entry = unwrap(element);
        if (!ts.isObjectLiteralExpression(entry)) {
          unresolved.push('omittedModules (an entry that is not an object literal)');
          continue;
        }
        let moduleId: string | null = null;
        let reason: string | null = null;
        for (const property of entry.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const name = propertyNameOf(property.name);
          if (name === 'moduleId') moduleId = stringLiteralOf(property.initializer);
          if (name === 'reason') reason = stringLiteralOf(property.initializer);
        }
        if (moduleId === null) {
          unresolved.push('omittedModules (an entry with no literal moduleId)');
        } else {
          omittedModules.push({ moduleId, reason: reason ?? '' });
        }
      }
    }
  }

  const decorationOrder: Record<string, readonly string[]> = {};
  const order = fields.get('decorationOrder');
  if (order !== undefined) {
    if (!ts.isObjectLiteralExpression(order)) {
      unresolved.push('decorationOrder (not an object literal)');
    } else {
      for (const property of order.properties) {
        if (!ts.isPropertyAssignment(property)) {
          unresolved.push('decorationOrder (a property whose value is not written in place)');
          continue;
        }
        const key = propertyNameOf(property.name);
        const value = unwrap(property.initializer);
        if (key === null || !ts.isArrayLiteralExpression(value)) {
          unresolved.push(`decorationOrder.${key ?? '<computed>'} (not a literal array of ids)`);
          continue;
        }
        const ids: string[] = [];
        let readable = true;
        for (const element of value.elements) {
          const id = stringLiteralOf(element);
          if (id === null) readable = false;
          else ids.push(id);
        }
        if (!readable) unresolved.push(`decorationOrder.${key} (a member that is not a literal)`);
        else decorationOrder[key] = ids;
      }
    }
  }

  const reasons: Record<string, string> = {};
  const declaredReasons = fields.get('reasons');
  if (declaredReasons !== undefined) {
    if (!ts.isObjectLiteralExpression(declaredReasons)) {
      unresolved.push('reasons (not an object literal)');
    } else {
      for (const property of declaredReasons.properties) {
        if (!ts.isPropertyAssignment(property)) {
          unresolved.push('reasons (a property whose value is not written in place)');
          continue;
        }
        const key = propertyNameOf(property.name);
        const value = stringLiteralOf(property.initializer);
        if (key === null || value === null) {
          unresolved.push(`reasons.${key ?? '<computed>'} (not a literal sentence)`);
          continue;
        }
        reasons[key] = value;
      }
    }
  }

  return { declaration: { omittedModules, decorationOrder, reasons }, unresolved };
}
