#!/usr/bin/env tsx
// Emits the committed divergence report for the active deployment — both
// renderings, from one derivation.
//
// D-30 asks for *"an override report listing every decorated service with its
// contract version and every injected strategy port"*. Its predecessor recorded
// one fact: which overlay modules a deployment adds. This records the nine seams
// a deployment can actually use (`data-model.md` §2.3), each with the module
// that wrote it, the module that owns what it names, the rung of the escalation
// ladder it sits on, and the sentence the deployment wrote when it did it.
//
// Output, per deployment on disk plus bare core:
//   - bare core:  backend/src/overlay/divergence.core.generated.{ts,md}
//   - deployment: backend/src/apps/<deployment>/divergence.generated.{ts,md}
//
// **Two renderings, one derivation** (FR-015). The `.ts` is what a program reads
// and what the byte-comparison compares; the `.md` is what a reviewer, an
// upgrader and our support read. Nothing is computed twice — `renderDivergence`
// derives once and calls two render functions.
//
// **It reads three things beyond the deployment's own tree**, and each is
// derived rather than listed: the port→owner map (`scripts/lib/registration-owners.ts`,
// shared with `check:port-dependencies` so the two cannot disagree about who
// owns a name), every `"<METHOD> <path>"` the composition serves (so an
// interceptor target that matches nothing is visible), and `ModuleContext`'s own
// members (so a seam no rung classifies is a failure rather than a silence).
//
// Usage: pnpm --filter backend run overlay:divergence   (DEPLOYMENT selects it)
/* eslint-disable no-console -- CLI generator: stdout is its interface. */

import { mkdirSync, readdirSync, readFileSync, writeFileSync, type Dirent } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  activeOverlayModulesRoot,
  overlayModulesRootFor,
  selectedDeployment,
} from '../src/overlay/overlay-roots.js';
import { resolveOverlay } from '../src/overlay/resolve-overlay.js';
import {
  renderDivergenceMarkdown,
  serializeDivergenceModule,
} from '../src/overlay/divergence-report.js';
import {
  deriveDivergence,
  moduleContextSeams,
  routeIdentities,
  type DivergenceFinding,
  type DivergenceResult,
  type OverlaySource,
  type RouteSource,
} from './lib/divergence.js';
import {
  HOST_REGISTERED_PORTS,
  ROOT_FILES,
  rootRegisteredNames,
} from './check-port-dependencies.js';
import { loadPackageDeclarations, refuseUnreadablePackages } from './lib/package-declarations.js';
import {
  moduleOf,
  providedPortNames,
  registeredNames,
} from '@endora-commerce/cli/lib/port-registrations.js';
import {
  mergeRegistrationOwners,
  rootSuppliedNames,
  type OwnerClaim,
} from './lib/registration-owners.js';
import { requireModuleLayout } from './lib/module-roots.js';
import type { ModuleTreeLayout } from './lib/module-roots.js';

/** `backend/src` — this file lives at `backend/scripts/`. */
const BACKEND_SRC = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src');

export const PREFIX = '[divergence]';

// ---------------------------------------------------------------------------
// Output paths
// ---------------------------------------------------------------------------

/**
 * Where a deployment's committed renderings live — `null` for bare core.
 *
 * Paths only, so the determinism gate can enumerate the artefacts it covers
 * without walking the overlay tree once per deployment to learn their names.
 */
export function divergenceOutputPaths(deployment: string | null): {
  readonly module: string;
  readonly markdown: string;
} {
  const base =
    deployment === null
      ? join(BACKEND_SRC, 'overlay', 'divergence.core.generated')
      : join(overlayModulesRootFor(deployment), '..', 'divergence.generated');
  return { module: `${base}.ts`, markdown: `${base}.md` };
}

// ---------------------------------------------------------------------------
// The inputs that are not the deployment's own tree
// ---------------------------------------------------------------------------

function walkTypeScript(root: string, out: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
        continue;
      }
      walkTypeScript(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Everything one run needs that does not change between deployments. */
export interface DivergenceEnvironment {
  readonly layout: ModuleTreeLayout;
  readonly owners: ReadonlyMap<string, string>;
  readonly rootSupplied: ReadonlySet<string>;
  readonly routes: ReadonlyMap<string, string | null>;
  readonly seams: readonly string[];
  /** Files opened building all of the above — the run's `files`, half of it. */
  readonly filesRead: number;
  /** Every module source the walk opened — issue #215's floor, as its input. */
  readonly moduleFiles: readonly string[];
  /** How a walked file is attributed, for that same floor. */
  readonly moduleIdOfFile: (file: string) => string | null;
  /** The `manifestPath` the generated index recorded per module — the freshness input. */
  readonly manifestLocations: readonly string[];
}

let cached: Promise<DivergenceEnvironment> | null = null;

/**
 * The composition's facts, read once per process.
 *
 * Cached because `overlay:check` renders every deployment on disk plus bare
 * core, and each of those needs the same owner map and the same route table: a
 * per-deployment rebuild would read the whole module tree three times to produce
 * three identical answers.
 */
export function divergenceEnvironment(): Promise<DivergenceEnvironment> {
  cached ??= buildEnvironment();
  return cached;
}

/**
 * Module packages whose source is in this checkout and which no workspace glob
 * reaches — a package a *deployment* installs, kept here for its own reasons.
 *
 * There is exactly one today, `backend/acceptance/fixture-package`, and it is
 * not an exception written into this file: it is discovered by its own
 * `endora: { type: 'module', id }` block, the same declaration
 * `lib/module-roots.ts` and `lib/module-packages.ts` read, over a bounded walk
 * of the application's own tree.
 *
 * It has to be read, and the reason is `acceptance`'s whole point. That
 * deployment's overlay module decorates `acceptanceProbeGreeter`, a name the
 * fixture package registers — so with only the workspace's modules and the
 * *installed* set in the owner map, the run cannot attribute the name and files
 * `unowned-subject`, which is a finding about the run dressed as one about the
 * tree (issue #113, one direction over). The claims rank with an installed
 * package's, below the tree's, for the reason the precedence exists at all.
 */
function repositoryResidentPackageRoots(applicationRoot: string, depth = 3): Array<{
  readonly moduleId: string;
  readonly directory: string;
}> {
  const found: Array<{ moduleId: string; directory: string }> = [];
  const visit = (directory: string, remaining: number): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'package.json' && entry.isFile()) {
        const manifest = join(directory, entry.name);
        try {
          const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
            endora?: { type?: string; id?: string };
          };
          if (parsed.endora?.type === 'module' && typeof parsed.endora.id === 'string') {
            found.push({ moduleId: parsed.endora.id, directory });
          }
        } catch {
          // A manifest this run cannot parse declares nothing it can read. It is
          // not a refusal here: `manifests:check` owns manifest well-formedness,
          // and a second answer to that question is a second answer waiting to
          // disagree.
        }
      }
      if (
        entry.isDirectory() &&
        remaining > 0 &&
        entry.name !== 'node_modules' &&
        entry.name !== 'dist' &&
        entry.name !== 'src' &&
        !entry.name.startsWith('.')
      ) {
        visit(join(directory, entry.name), remaining - 1);
      }
    }
  };
  visit(applicationRoot, depth);
  return found;
}

async function buildEnvironment(): Promise<DivergenceEnvironment> {
  const layout = await requireModuleLayout(PREFIX);

  const moduleFiles = layout.moduleWalkRoots.flatMap((root) => walkTypeScript(root));
  const treeClaims: OwnerClaim[] = [];
  const residentClaims: OwnerClaim[] = [];
  const routeSources: RouteSource[] = [];

  for (const file of moduleFiles) {
    const source = readFileSync(file, 'utf8');
    const moduleId = moduleOf(file, layout.hostResidentModules);
    routeSources.push({ file, text: source, moduleId });
    if (moduleId === null) continue;
    for (const name of registeredNames(source, file)) treeClaims.push({ name, moduleId });
  }

  for (const resident of repositoryResidentPackageRoots(layout.applicationRoot)) {
    for (const file of walkTypeScript(resident.directory)) {
      const source = readFileSync(file, 'utf8');
      routeSources.push({ file, text: source, moduleId: resident.moduleId });
      for (const name of registeredNames(source, file)) {
        residentClaims.push({ name, moduleId: resident.moduleId });
      }
      for (const name of providedPortNames(source, file)) {
        residentClaims.push({ name, moduleId: resident.moduleId });
      }
    }
  }

  // The platform's own sources: the kernel registers names no module owns, and
  // it serves routes an interceptor may legitimately target.
  const kernelNames = new Set<string>();
  if (layout.platformRoot !== null) {
    for (const file of walkTypeScript(layout.platformRoot)) {
      const source = readFileSync(file, 'utf8');
      routeSources.push({ file, text: source, moduleId: null });
      for (const name of registeredNames(source, file)) kernelNames.add(name);
      for (const name of providedPortNames(source, file)) kernelNames.add(name);
    }
  }

  // An installed extension package's registrations, read out of the artefact the
  // platform composes rather than out of source it does not ship (T034).
  const packages = await loadPackageDeclarations({
    containerNames: (source, file) => {
      const gated = new Set(providedPortNames(source, file));
      return [
        ...[...gated].map((name) => ({ name, gated: true })),
        ...registeredNames(source, file)
          .filter((name) => !gated.has(name))
          .map((name) => ({ name, gated: false })),
      ];
    },
  });
  refuseUnreadablePackages(PREFIX, packages);

  const owners = mergeRegistrationOwners({
    hostRegistered: HOST_REGISTERED_PORTS,
    treeClaims,
    packageClaims: [...packages.containerNames, ...residentClaims],
  });

  const rootNames = new Set<string>();
  for (const relativePath of Object.values(ROOT_FILES)) {
    const full = join(layout.applicationRoot, relativePath);
    let source: string;
    try {
      source = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    routeSources.push({ file: full, text: source, moduleId: null });
    for (const name of rootRegisteredNames(source, full)) rootNames.add(name);
  }

  const seamSource =
    layout.platformRoot === null
      ? ''
      : readFileSync(join(layout.platformRoot, 'kernel', 'module-context.ts'), 'utf8');

  // Where the generated index says each module's manifest lives — the input the
  // emitted-artefact freshness refusal is computed over, because the owner map's
  // third source reads a package's build output.
  const index = (await import(pathToFileURL(layout.manifestIndexPath).href)) as {
    DISCOVERED_MANIFESTS?: ReadonlyArray<{ manifestPath?: string }>;
  };
  const manifestLocations = (index.DISCOVERED_MANIFESTS ?? [])
    .map((entry) => entry.manifestPath)
    .filter((path): path is string => path !== undefined);

  return {
    layout,
    owners,
    rootSupplied: rootSuppliedNames({ rootNames, kernelNames, owners }),
    routes: routeIdentities(routeSources),
    seams: moduleContextSeams(seamSource),
    filesRead: routeSources.length,
    moduleFiles,
    moduleIdOfFile: (file) => moduleOf(file, layout.hostResidentModules),
    manifestLocations,
  };
}

// ---------------------------------------------------------------------------
// The render
// ---------------------------------------------------------------------------

/** One rendering: where it goes and what it says. */
export interface Rendering {
  readonly outputPath: string;
  readonly content: string;
  /** The label `overlay:check` prints. */
  readonly label: string;
}

export interface RenderedDivergence {
  readonly deployment: string;
  readonly renderings: readonly Rendering[];
  readonly result: DivergenceResult;
  /** Overlay source files this render opened — the run's other `files`. */
  readonly overlayFilesRead: number;
  /** The sources themselves, so a caller can reconcile modules against files. */
  readonly overlaySources: readonly OverlaySource[];
}

/** The deployment's own overlay sources, attributed to the module that owns them. */
export function overlaySourcesOf(
  overlayRoot: string | null,
  moduleIds: readonly string[],
  base: string,
): OverlaySource[] {
  if (overlayRoot === null) return [];
  const sources: OverlaySource[] = [];
  for (const moduleId of moduleIds) {
    for (const file of walkTypeScript(join(overlayRoot, moduleId))) {
      sources.push({
        moduleId,
        file: relative(base, file).split(sep).join('/'),
        text: readFileSync(file, 'utf8'),
      });
    }
  }
  return sources;
}

async function loadDeclaration(deployment: string | null): Promise<{
  omittedModules: ReadonlyArray<{ moduleId: string; reason: string }>;
  decorationOrder: Readonly<Record<string, readonly string[]>>;
  reasons: Readonly<Record<string, string>>;
}> {
  const empty = { omittedModules: [], decorationOrder: {}, reasons: {} };
  if (deployment === null) return empty;
  const { loadDivergenceDeclaration } = await import('../src/lifecycle/services/divergence.js');
  return loadDivergenceDeclaration({ DEPLOYMENT: deployment } as NodeJS.ProcessEnv);
}

/**
 * Pure render — the target paths and the expected file contents, plus every
 * finding the derivation raised producing them.
 *
 * Used by the generator when run directly, by the git-free determinism check,
 * and by `check-divergence.ts`, which reads the findings and writes nothing.
 */
export async function renderDivergence(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RenderedDivergence> {
  const deployment = selectedDeployment(env);
  const overlayRoot = activeOverlayModulesRoot(env);
  const shared = await divergenceEnvironment();
  const resolution = resolveOverlay({ overlayRoot, deployment });
  const sources = overlaySourcesOf(
    overlayRoot,
    resolution.newModules,
    shared.layout.repoRoot,
  );

  const result = deriveDivergence({
    deployment: deployment ?? 'core',
    overlayRoot:
      overlayRoot === null ? null : relative(shared.layout.repoRoot, overlayRoot).split(sep).join('/'),
    overlayModules: resolution.newModules,
    sources,
    routes: shared.routes,
    owners: shared.owners,
    rootSupplied: shared.rootSupplied,
    declaration: await loadDeclaration(deployment),
    seams: shared.seams,
  });

  const paths = divergenceOutputPaths(deployment);

  // Module-resolvable path from the emitted file to src/overlay/types.js.
  const typesFile = join(BACKEND_SRC, 'overlay', 'types.ts');
  let typesSpec = relative(dirname(paths.module), typesFile).replace(/\.ts$/, '.js');
  if (sep !== '/') typesSpec = typesSpec.split(sep).join('/');
  if (!typesSpec.startsWith('.')) typesSpec = `./${typesSpec}`;

  const label = `divergence (${deployment ?? 'core'})`;
  return {
    deployment: deployment ?? 'core',
    renderings: [
      {
        outputPath: paths.module,
        content: serializeDivergenceModule(result.report, typesSpec),
        label: `${label} [ts]`,
      },
      {
        outputPath: paths.markdown,
        content: renderDivergenceMarkdown(result.report),
        label: `${label} [md]`,
      },
    ],
    result,
    overlayFilesRead: sources.length,
    overlaySources: sources,
  };
}

/**
 * Does the overlay tree **spell** a seam call at all?
 *
 * A second author for refusal 3, and the reason it is a text probe rather than a
 * second walk: what has to be caught is the *syntax walk* going blind, and a
 * second syntax walk would go blind with it. With two overlay modules in this
 * repository, a resolver that stopped recognising `ctx.di.decorate` prints a
 * clean report over a tree full of decorations, and `sites=0` is
 * indistinguishable from a deployment that only registers routes — which is a
 * legal thing for an overlay module to do. This tells the two apart.
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

function describeFinding(finding: DivergenceFinding): string {
  return `  - ${finding.where}: ${finding.detail}`;
}

async function main(): Promise<void> {
  const rendered = await renderDivergence();
  for (const rendering of rendered.renderings) {
    mkdirSync(dirname(rendering.outputPath), { recursive: true });
    writeFileSync(rendering.outputPath, rendering.content, 'utf8');
  }
  console.log(
    `${PREFIX} deployment=${rendered.deployment} ` +
      `overlayModules=${rendered.result.report.overlayModules.length} ` +
      `entries=${rendered.result.report.entries.length} → ` +
      rendered.renderings.map((r) => r.outputPath).join(', '),
  );
  // The generator writes the artefact whatever it found; the findings are
  // `check:divergence`'s to fail on. It prints them anyway, because an author
  // running the generator is the person who can fix them.
  if (rendered.result.findings.length > 0) {
    console.log(`${PREFIX} findings=${rendered.result.findings.length} (see check:divergence)`);
    for (const finding of rendered.result.findings) {
      console.log(`  [${finding.kind}]${describeFinding(finding).slice(1)}`);
    }
  }
}

// Only write when executed directly (not when imported by a check).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
