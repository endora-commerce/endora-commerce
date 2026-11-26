/**
 * `endora build overlays [--watch]` — compile an instance's overlay modules
 * (`specs/190-overlay-full-modules/` FR-012 – FR-014, contract `overlay-build.md` §2, #1848).
 *
 * ## Why an instance builds its overlay code at all
 *
 * Overlay modules used to be loaded as TypeScript with the types stripped, which strips
 * decorators with them — and an overlay that owns a table needs the entity decorators a
 * module package uses. So the instance compiles `apps/` the way it compiles everything
 * else: with its own `tsc`, over one project, `backend/tsconfig.apps.json`, into
 * `backend/dist/apps/**`, which is where the loader looks (`resolveOverlayUnit` prefers a
 * `.js` beside a `.ts`). No new dependency: the instance's own `typescript`.
 *
 * ## The steps
 *
 * 1. **Layout** — every deployment's `apps/<deployment>/modules/<id>/` is flat and is not a
 *    package (`./layout.ts`, the platform's walk twice over). A finding is exit 1, before a
 *    compile: the build would otherwise emit a module nothing composes.
 * 2. **Compile** — `tsc -p tsconfig.apps.json --noEmit false --declaration false --sourceMap`
 *    from `backend/`. The flags turn the type-check project #1847 wrote into the emitting
 *    one, so an instance that has not re-rendered its `tsconfig.apps.json` builds too.
 *    `--watch` passes through.
 * 3. **Assets** — every overlay module's runtime assets (`i18n/*.json`, today) are mirrored
 *    into `backend/dist/apps/…` with the one classification (`../lib/runtime-assets.ts`,
 *    D-218). An unclassified file is a refusal, as it is for every other compiled tree. The
 *    admin layer is not mirrored: `tsconfig.apps.json` excludes it, and the admin build
 *    reads it from the sources.
 *
 * Exit 0 done, 1 a refusal or a compile error, 2 an input this run could not read.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, watch as watchTree } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { loadRuntimeAssets } from '../lib/runtime-assets.js';
import { layoutFindings, moduleIdsUnder, type LayoutFinding } from './layout.js';

/** Runs the compiler; resolves to its exit code. A seam, so a test can record the call. */
export type TscRunner = (cwd: string, args: readonly string[]) => number | Promise<number>;

export interface BuildOverlaysOptions {
  /** Where it was typed: the instance root, or its `backend/` member (the `build` script). */
  readonly cwd: string;
  readonly watch?: boolean;
  /** The compiler; defaults to the instance's own `tsc`, else this package's `typescript`. */
  readonly tsc?: TscRunner;
  readonly out?: (text: string) => void;
  readonly err?: (text: string) => void;
}

const PROJECT = 'tsconfig.apps.json';
const PREFIX = '[build:overlays]';

/** The instance root: the directory holding `backend/tsconfig.apps.json`. */
function instanceRootFrom(cwd: string): string | null {
  const here = resolve(cwd);
  if (existsSync(join(here, 'backend', PROJECT))) return here;
  if (existsSync(join(here, PROJECT)) && existsSync(join(here, 'package.json'))) {
    const parent = dirname(here);
    if (existsSync(join(parent, 'backend', PROJECT))) return parent;
  }
  return null;
}

/** `apps/<deployment>/modules` for every deployment on disk. */
function deploymentModuleRoots(root: string): string[] {
  const apps = join(root, 'apps');
  return moduleIdsUnder(apps)
    .map((deployment) => join(apps, deployment, 'modules'))
    .filter((modules) => existsSync(modules));
}

/** The instance's own `tsc`, else the one this package depends on. */
function resolveTsc(backendDir: string): string {
  for (const base of [join(backendDir, 'package.json'), import.meta.url]) {
    try {
      return createRequire(base).resolve('typescript/bin/tsc');
    } catch {
      // the next candidate
    }
  }
  throw new Error('no `typescript` is installed for the instance backend or for this CLI');
}

function defaultTsc(watch: boolean): TscRunner {
  return (cwd, args) => {
    const tsc = resolveTsc(cwd);
    if (!watch) {
      return spawnSync(process.execPath, [tsc, ...args], { cwd, stdio: 'inherit' }).status ?? 1;
    }
    return new Promise<number>((done) => {
      spawn(process.execPath, [tsc, ...args, '--watch', '--preserveWatchOutput'], {
        cwd,
        stdio: 'inherit',
      }).on('exit', (code) => done(code ?? 1));
    });
  };
}

function describeFinding(root: string, finding: LayoutFinding): string {
  return `  - [${finding.kind}] ${relative(root, finding.file).split(sep).join('/')}`;
}

/** Mirror every overlay module's runtime assets; the unclassified files when it refuses. */
async function mirrorAssets(root: string, modulesRoots: readonly string[]): Promise<string[]> {
  const assets = await loadRuntimeAssets();
  const apps = join(root, 'apps');
  const outApps = join(root, 'backend', 'dist', 'apps');
  const refused: string[] = [];
  const toCopy: string[] = [];
  for (const modulesRoot of modulesRoots) {
    for (const id of moduleIdsUnder(modulesRoot)) {
      const moduleDir = join(modulesRoot, id);
      const collected = assets.collectRuntimeAssets(moduleDir);
      const prefix = relative(apps, moduleDir).split(sep).join('/');
      const notAdmin = (rel: string): boolean => !rel.startsWith('admin/');
      refused.push(...collected.unclassified.filter(notAdmin).map((rel) => `apps/${prefix}/${rel}`));
      toCopy.push(...collected.assets.filter(notAdmin).map((rel) => `${prefix}/${rel}`));
    }
  }
  if (refused.length === 0) assets.copyRuntimeAssets(apps, outApps, toCopy);
  return refused;
}

export async function runBuildOverlays(options: BuildOverlaysOptions): Promise<number> {
  const out = options.out ?? ((text: string) => process.stdout.write(text));
  const err = options.err ?? ((text: string) => process.stderr.write(text));
  const root = instanceRootFrom(options.cwd);
  if (root === null) {
    err(
      `${PREFIX} ${resolve(options.cwd)} is not an instance: no backend/${PROJECT} here or one ` +
        'level up. Run it from the instance root or its backend member.\n',
    );
    return 2;
  }
  const backendDir = join(root, 'backend');

  // 1. Layout, over every deployment on disk.
  const modulesRoots = deploymentModuleRoots(root);
  const findings = modulesRoots.flatMap((modulesRoot) =>
    layoutFindings(modulesRoot, moduleIdsUnder(modulesRoot)),
  );
  if (findings.length > 0) {
    err(
      `${PREFIX} ${String(findings.length)} file(s) break the overlay module layout:\n` +
        `${findings.map((finding) => describeFinding(root, finding)).join('\n')}\n` +
        'A module is a direct child of `modules/` (a nested manifest is `nested-module`: make it ' +
        'a sibling module and declare the dependency) and has no package or build configuration ' +
        'of its own (`package-in-disguise`: every overlay module compiles in ' +
        `backend/${PROJECT}). Nothing was compiled.\n`,
    );
    return 1;
  }

  const watch = options.watch === true;
  const tsc = options.tsc ?? defaultTsc(watch);
  const args = [
    '-p',
    PROJECT,
    '--noEmit',
    'false',
    '--declaration',
    'false',
    '--sourceMap',
  ] as const;

  if (watch) {
    // Assets first, then on every change; the compiler watches the code itself.
    const refused = await mirrorAssets(root, modulesRoots);
    if (refused.length > 0) {
      err(unclassifiedMessage(refused));
      return 1;
    }
    const apps = join(root, 'apps');
    if (existsSync(apps)) {
      watchTree(apps, { recursive: true }, () => {
        void mirrorAssets(root, deploymentModuleRoots(root)).then((again) => {
          if (again.length > 0) err(unclassifiedMessage(again));
        });
      });
    }
    out(`${PREFIX} watching apps/ (compile and assets)\n`);
    return (await tsc(backendDir, args)) === 0 ? 0 : 1;
  }

  // 2. Compile.
  let compiled: number;
  try {
    compiled = await tsc(backendDir, args);
  } catch (error) {
    err(`${PREFIX} ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  if (compiled !== 0) {
    err(`${PREFIX} tsc -p backend/${PROJECT} exited ${String(compiled)}; nothing was mirrored.\n`);
    return 1;
  }

  // 3. Assets.
  const refused = await mirrorAssets(root, modulesRoots);
  if (refused.length > 0) {
    err(unclassifiedMessage(refused));
    return 1;
  }
  out(`${PREFIX} compiled ${String(modulesRoots.length)} deployment(s) into backend/dist/apps\n`);
  return 0;
}

function unclassifiedMessage(files: readonly string[]): string {
  return (
    `${PREFIX} ${String(files.length)} file(s) in overlay modules are neither code nor a runtime ` +
    `asset this build ships:\n${files.map((file) => `  - ${file}`).join('\n')}\n` +
    'A runtime asset is `.json` or `.txt`; anything else the module opens at run time has to be ' +
    'classified before it can ship. Nothing was mirrored.\n'
  );
}
