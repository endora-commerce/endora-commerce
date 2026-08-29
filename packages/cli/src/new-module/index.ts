/**
 * `endora new module` — the command.
 *
 * The order is the one `contracts/module-scaffold-output.md` §2 requires and it
 * is not incidental: **validate everything → write every file except
 * `package.json` → render → take the rendered manifest.** The generator derives
 * `peerDependencies` from the bare specifiers the sources actually import and
 * `exports` from which layers exist, so the sources have to be complete before
 * the manifest can be rendered at all.
 *
 * Every refusal that is the author's to fix happens before the first byte is
 * written (`cli-surface.md` §3.3). A partially written module type-checks against
 * nothing, is in no registry, and makes the author's next command a manual
 * clean-up.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { emitModuleFiles, type EmittedFile } from './emit.js';
import {
  depthOf,
  renderPackageManifest,
  resolveHost,
  workspaceGlobs,
  type ScaffoldHost,
} from './host.js';
import {
  buildScaffoldSpec,
  npmNameFor,
  ScaffoldHostError,
  ScaffoldInputError,
  slugOf,
  type ModuleScaffoldSpec,
  type ScaffoldInput,
} from './spec.js';

export interface NewModuleOptions extends ScaffoldInput {
  /** Where to write. Default: the module tree the workspace globs reach. */
  readonly dir?: string | undefined;
  /**
   * The npm scope, which the workspace already declares.
   *
   * Accepted so a caller can *assert* it, and refused when it disagrees: the
   * scope is derived from the members' own names, and a command that took a
   * scope on trust would write a package the workspace does not publish under.
   */
  readonly scope?: string | undefined;
  /** Report what would be written, write nothing. */
  readonly dryRun?: boolean | undefined;
  readonly cwd?: string | undefined;
}

export interface NewModuleResult {
  readonly spec: ModuleScaffoldSpec;
  readonly packageName: string;
  readonly packageDir: string;
  /** The files this command authors, in write order. Never `package.json`. */
  readonly files: readonly EmittedFile[];
  /** The manifests the platform's generator wrote, checkout-relative. */
  readonly renderedManifests: readonly string[];
  readonly dryRun: boolean;
  readonly nextSteps: readonly string[];
}

export async function runNewModule(options: NewModuleOptions): Promise<NewModuleResult> {
  const cwd = options.cwd ?? process.cwd();
  const host = resolveHost(cwd);
  const spec = buildScaffoldSpec(options);
  if (options.scope !== undefined && normaliseScope(options.scope) !== host.scope) {
    throw new ScaffoldInputError(
      `--scope "${options.scope}" is not the scope this workspace publishes under ` +
        `("${host.scope}"). The npm name of a module package is '<scope>mod-<id>', derived ` +
        `from the members' own names.`,
    );
  }
  const packageName = npmNameFor(host.scope, spec.id);

  const packageDir =
    options.dir === undefined
      ? join(host.defaultModulesRoot, spec.id)
      : isAbsolute(options.dir)
        ? options.dir
        : resolve(cwd, options.dir);

  refuseOccupiedDirectory(packageDir);
  refuseDuplicateModule(host, spec.id, packageDir);

  const depth = depthOf(host.repoRoot, packageDir);
  if (depth === 0) {
    throw new ScaffoldInputError(
      `--dir names the checkout root, which cannot be a module package: its two build ` +
        `configurations extend a \`tsconfig.base.json\` above it and there is nothing above it.`,
    );
  }

  const files = emitModuleFiles(spec, depth);
  if (options.dryRun === true) {
    return {
      spec,
      packageName,
      packageDir,
      files,
      renderedManifests: [],
      dryRun: true,
      nextSteps: nextStepsFor(host, packageName, packageDir, spec.layers.admin !== null),
    };
  }

  for (const file of files) {
    const target = join(packageDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, 'utf8');
  }

  const render = await renderPackageManifest(host);
  if (!existsSync(join(packageDir, 'package.json'))) {
    throw new ScaffoldHostError(
      `the platform's manifest generator wrote no package.json for ${packageName}. Its ` +
        `population is the workspace globs, so a directory no glob reaches is not a module ` +
        `package: it is not a member, not discovered, and absent from every generated ` +
        `artefact. ${relative(host.repoRoot, packageDir)} is outside them.\n${render.output}`,
    );
  }

  return {
    spec,
    packageName,
    packageDir,
    files,
    renderedManifests: render.wrote,
    dryRun: false,
    nextSteps: nextStepsFor(host, packageName, packageDir, spec.layers.admin !== null),
  };
}

/** `@endora-commerce` and `@endora-commerce/` are the same answer. */
function normaliseScope(scope: string): string {
  return scope.endsWith('/') ? scope : `${scope}/`;
}

function refuseOccupiedDirectory(packageDir: string): void {
  if (!existsSync(packageDir)) return;
  const entries = readdirSync(packageDir);
  if (entries.length === 0) return;
  throw new ScaffoldInputError(
    `${packageDir} exists and is not empty (${entries.slice(0, 5).join(', ')}). This command ` +
      `never merges into a directory: it is not idempotent over an existing module, and ` +
      `pretending otherwise would silently discard hand-written code.`,
  );
}

/**
 * A module id claimed twice, refused before anything is written.
 *
 * A duplicate id is a duplicate lifecycle registration, a duplicate settings
 * namespace and a duplicate migration owner — the id is identity of record for
 * all three. Both places a module can live are checked: a workspace member
 * declaring it, and the application's own module tree.
 */
function refuseDuplicateModule(host: ScaffoldHost, moduleId: string, packageDir: string): void {
  const hostResident = join(host.repoRoot, 'backend', 'src', 'modules', moduleId);
  if (existsSync(hostResident)) {
    throw new ScaffoldInputError(
      `"${moduleId}" is already a module: ${relative(host.repoRoot, hostResident)}. A module id ` +
        `is identity of record for the lifecycle registry, the settings namespace and every ` +
        `migration's owner, so it cannot be claimed twice.`,
    );
  }
  for (const dir of memberDirectories(host)) {
    if (dir === packageDir) continue;
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
    } catch {
      continue;
    }
    const endora = (parsed as { endora?: { id?: unknown } } | null)?.endora;
    if (endora?.id !== moduleId) continue;
    throw new ScaffoldInputError(
      `"${moduleId}" is already the module id of ${relative(host.repoRoot, dir)}. A module id ` +
        `is identity of record for the lifecycle registry, the settings namespace and every ` +
        `migration's owner, so it cannot be claimed twice.`,
    );
  }
}

/** Every directory a workspace glob reaches, so a duplicate id is found wherever it is. */
function memberDirectories(host: ScaffoldHost): readonly string[] {
  const found: string[] = [];
  for (const glob of workspaceGlobs(host.repoRoot)) {
    if (glob.startsWith('!')) continue;
    if (!glob.endsWith('/*')) {
      found.push(join(host.repoRoot, glob));
      continue;
    }
    const parent = join(host.repoRoot, glob.slice(0, -2));
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) found.push(join(parent, entry.name));
    }
  }
  return found;
}

/**
 * The steps that are the author's and not this command's.
 *
 * It never runs them. Running the repository's own tooling from a package is the
 * coupling this programme exists to remove, and `package.json` is the one
 * exception the byte-identity rule forces (see `host.ts`).
 */
function nextStepsFor(
  host: ScaffoldHost,
  packageName: string,
  packageDir: string,
  hasAdminLayer: boolean,
): readonly string[] {
  const where = relative(host.repoRoot, packageDir);
  const composerNote = hasAdminLayer
    ? `pnpm --filter backend run composer:generate && git add every artefact it wrote — an ` +
      `unregistered migration does not run, an unregistered manifest is a module the platform ` +
      `does not compose, and an unregistered admin contribution is a screen that exists and is ` +
      `reachable from nowhere.`
    : `pnpm --filter backend run composer:generate && git add every artefact it wrote — an ` +
      `unregistered migration does not run and an unregistered manifest is a module the ` +
      `platform does not compose.`;
  return [
    `declare "${packageName}": "workspace:*" in backend/package.json — the generated manifest ` +
      `index imports a packaged module by **bare specifier**, so an application that does not ` +
      `depend on it gets no node_modules link and every tool that loads that index dies with ` +
      `ERR_MODULE_NOT_FOUND.${
        hasAdminLayer
          ? ' The admin\'s own dependency on this package is not yours to add: the manifest ' +
            'generator reconciles it from the same layer inventory it renders `exports` from, ' +
            'so a module that grows or drops `src/admin/` moves both in one run.'
          : ''
      }`,
    `pnpm install, then commit pnpm-lock.yaml — a new workspace member changes what the ` +
      `workspace declares, and \`pnpm install --frozen-lockfile\` is the first thing every CI ` +
      `job does.`,
    `pnpm --filter ${packageName} run build — a module package resolves at its \`dist\`.`,
    composerNote,
    `pnpm --filter backend run manifests:check — confirms the manifest this command produced ` +
      `is the one the generator renders.`,
    `translate ${join(where, 'i18n/pl.json')} — both shipped languages carry the same keys, ` +
      `and its values are your English text because a translation is a human judgement.`,
    `copy each \`adminRoles.permission.<code>\` line into the platform's own \`_i18n\` bundles ` +
      `as well. A module owns its permission labels in its own bundle, and the platform's ` +
      `permission-inventory contract test additionally sweeps every **core-registered** ` +
      `module's assignable codes against \`_i18n\`'s en/pl bundles — so a module living in ` +
      `this repository needs both copies. A module installed from a package needs only its ` +
      `own, and takes the manifest \`label\` as its fallback.`,
    `pnpm --filter ${packageName} run test — the emitted test is a real one; add yours beside it.`,
  ];
}

/** The slug the emitted file names are built from, re-exported for the bin's messages. */
export { slugOf };
