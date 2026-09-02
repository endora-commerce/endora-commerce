/**
 * Where `package.json` comes from, and why this file is a delegation rather
 * than a renderer (`contracts/module-scaffold-output.md` §2).
 *
 * **The scaffold does not author `package.json`.** Every field of that file is
 * already derived from the sources — `exports` from which layers exist,
 * `peerDependencies` from the bare specifiers the sources actually name, the
 * ranges from the application that composes the modules, `files` from which
 * asset directories exist, `scripts` from whether the package ships runtime
 * assets and a test configuration — and the derivation has an author:
 * `pnpm --filter backend run manifests:generate`. A scaffold that rendered its
 * own would be a second author for a file that already has one, which is D-100's
 * subject, and the drift would be silent in both of the ways the generator's own
 * header names: a missing peer builds identically inside a workspace that hoists
 * it, and a wrong `exports` key answers `ERR_PACKAGE_PATH_NOT_EXPORTED` at the
 * first import that needs it — which for `./migrations` is the platform's boot.
 *
 * **So the command writes the sources and then runs that generator**, and takes
 * the file it writes. It is a delegation to a *repository* tool and it is
 * therefore only available inside a checkout of this repository — which is
 * exactly what the run refuses to guess about. Outside one, the three inputs the
 * derivation reads (the workspace file for the scope, the application's manifest
 * for the version ranges, the root manifest for `engines.node`) do not exist,
 * and the command exits 2 naming them rather than inventing a manifest nobody
 * will reproduce. Publishing those three facts as an artefact a stranger's
 * install carries is `contracts/host-facts.md`, and it is a later phase of this
 * feature.
 *
 * The in-process form of this delegation — importing the derivation instead of
 * spawning it — needs the shared library to be a package rather than part of an
 * application, which is a relocation deliberately deferred. When it lands, this
 * file becomes a function call and everything above it stays true.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { ScaffoldHostError } from './spec.js';

/** The checkout the scaffold is running inside, and the tool that renders manifests. */
export interface ScaffoldHost {
  /** The directory holding `pnpm-workspace.yaml`. */
  readonly repoRoot: string;
  /** The npm scope this workspace publishes under, with its trailing slash. */
  readonly scope: string;
  /** Where a module package lives, absolute, when the author names no `--dir`. */
  readonly defaultModulesRoot: string;
}

/** The generator this delegation runs, relative to the checkout root. */
export const MANIFEST_GENERATOR = 'backend/scripts/generate-module-manifests.ts';

/** The workspace file whose globs decide what is a member at all. */
export const WORKSPACE_FILE = 'pnpm-workspace.yaml';

/** The nearest ancestor of `start` holding a `pnpm-workspace.yaml`, or `null`. */
export function findRepoRoot(start: string): string | null {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, WORKSPACE_FILE))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * The `packages:` globs a workspace declares, as written.
 *
 * A deliberately small reader: block-sequence entries under a `packages:` key,
 * which is the shape this repository's file has and the shape every workspace
 * tool in it reads. A flow-style list yields none, and a run with no glob is
 * refused rather than treated as an empty workspace.
 */
export function workspaceGlobs(repoRoot: string): readonly string[] {
  const text = readFileSync(join(repoRoot, WORKSPACE_FILE), 'utf8');
  const globs: string[] = [];
  let inPackages = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const entry = /^\s+-\s+['"]?([^'"\s]+)['"]?\s*$/.exec(line);
    if (entry === null) {
      if (line.trim().length > 0 && !line.startsWith(' ')) inPackages = false;
      continue;
    }
    globs.push(entry[1]!);
  }
  return globs;
}

/**
 * Where a new module package goes when the author names no directory.
 *
 * Derived from the workspace globs, never written down: the module tree is
 * whichever glob ends in `/*` and whose directory already holds module packages.
 * A repository that moves that tree moves this answer with it, in the merge
 * request that does it.
 */
export function defaultModulesRootOf(repoRoot: string, globs: readonly string[]): string | null {
  const candidates = globs
    .filter((glob) => glob.endsWith('/*') && !glob.startsWith('!'))
    .map((glob) => glob.slice(0, -2))
    .filter((dir) => dir.includes('/'))
    .sort();
  const deepest = candidates[candidates.length - 1];
  if (deepest === undefined) return null;
  const dir = join(repoRoot, deepest);
  return existsSync(dir) ? dir : null;
}

/**
 * The single npm scope this workspace publishes under.
 *
 * Read off the members' own names rather than assumed, and refused when there is
 * more than one — the npm name of a module package is `<scope>/mod-<id>` and this
 * derivation may not choose between two scopes or invent one, which is the same
 * refusal the manifest generator makes.
 */
export function workspaceScopeOf(repoRoot: string, globs: readonly string[]): string | null {
  const scopes = new Set<string>();
  for (const glob of globs) {
    if (glob.startsWith('!')) continue;
    const dirs = glob.endsWith('/*')
      ? listDirectories(join(repoRoot, glob.slice(0, -2)))
      : [join(repoRoot, glob)];
    for (const dir of dirs) {
      const manifestPath = join(dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const name = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown }).name;
      if (typeof name !== 'string' || !name.startsWith('@')) continue;
      const slash = name.indexOf('/');
      if (slash > 0) scopes.add(name.slice(0, slash + 1));
    }
  }
  const only = [...scopes];
  return only.length === 1 ? only[0]! : null;
}

function listDirectories(path: string): readonly string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(path, entry.name));
}

/**
 * The host this run has, or a refusal naming what it could not read.
 *
 * Every branch is exit 2, never exit 1: none of them is something the author
 * typed wrong.
 */
export function resolveHost(cwd: string): ScaffoldHost {
  const repoRoot = findRepoRoot(cwd);
  if (repoRoot === null) {
    throw new ScaffoldHostError(
      `no ${WORKSPACE_FILE} above ${cwd}. \`endora new module\` derives the package manifest ` +
        `through the platform's own manifest generator, which reads the workspace file for ` +
        `the npm scope, the application's manifest for the peer version ranges and the root ` +
        `manifest for \`engines.node\`. Outside a checkout of the platform repository none of ` +
        `the three exists, and inventing them would ship a package whose peers nothing ` +
        `resolves. Run this inside the platform repository.`,
    );
  }
  if (!existsSync(join(repoRoot, MANIFEST_GENERATOR))) {
    throw new ScaffoldHostError(
      `${join(repoRoot, MANIFEST_GENERATOR)} is not there. It is the one author of a module ` +
        `package's package.json, and this command writes that file by running it rather than ` +
        `composing a second copy of the same derivation.`,
    );
  }
  const globs = workspaceGlobs(repoRoot);
  if (globs.length === 0) {
    throw new ScaffoldHostError(
      `${join(repoRoot, WORKSPACE_FILE)} declares no workspace member. A module package is ` +
        `one, so a package written here would be reached by no glob — not a member, not ` +
        `discovered, and absent from every generated artefact, in silence.`,
    );
  }
  const scope = workspaceScopeOf(repoRoot, globs);
  if (scope === null) {
    throw new ScaffoldHostError(
      `${repoRoot}: the workspace members publish under no single npm scope. The name of a ` +
        `module package is '<scope>mod-<id>' and this cannot choose between two scopes or ` +
        `invent one.`,
    );
  }
  const modulesRoot = defaultModulesRootOf(repoRoot, globs);
  if (modulesRoot === null) {
    throw new ScaffoldHostError(
      `${repoRoot}: no workspace glob names a module tree, so there is no default directory ` +
        `for a new module package. Name one with --dir.`,
    );
  }
  return { repoRoot, scope, defaultModulesRoot: modulesRoot };
}

/** How far below the checkout root a package directory sits. */
export function depthOf(repoRoot: string, packageDir: string): number {
  return relative(repoRoot, packageDir).split(sep).filter(Boolean).length;
}

/** What the generator did: the manifests it wrote, checkout-relative. */
export interface ManifestRenderResult {
  readonly wrote: readonly string[];
  readonly output: string;
}

/**
 * Run the platform's manifest generator over the checkout.
 *
 * It renders every module package and writes the ones that differ, which is what
 * makes the new package's manifest **the generator's own render** rather than a
 * copy of it. A refusal is surfaced verbatim and exits 2: the emitted sources are
 * already on disk, and a fallback manifest of this command's own would be exactly
 * the second author the delegation exists to avoid.
 */
export async function renderPackageManifest(host: ScaffoldHost): Promise<ManifestRenderResult> {
  const result = await run('pnpm', ['--filter', 'backend', 'run', 'manifests:generate'], host.repoRoot);
  if (result.code !== 0) {
    throw new ScaffoldHostError(
      `the platform's manifest generator refused (exit ${String(result.code)}). The emitted ` +
        `sources are on disk; this command will not write a package.json of its own.\n` +
        result.output,
    );
  }
  const wrote = [...result.output.matchAll(/^\[module-manifests\] wrote (.+)$/gm)].map(
    (match) => match[1]!,
  );
  return { wrote, output: result.output };
}

interface RunResult {
  readonly code: number;
  readonly output: string;
}

function run(command: string, args: readonly string[], cwd: string): Promise<RunResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('error', (error: Error) => {
      rejectRun(
        new ScaffoldHostError(
          `could not run \`${command} ${args.join(' ')}\`: ${error.message}. The platform's ` +
            `manifest generator is what writes a module package's package.json.`,
        ),
      );
    });
    child.on('close', (code) => {
      resolveRun({ code: code ?? 1, output });
    });
  });
}
