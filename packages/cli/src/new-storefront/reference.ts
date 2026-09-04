/**
 * The reference storefront, and every declaration in it that names something
 * above its own directory.
 *
 * **Nothing here is a list.** `specs/071-modular-packaging/roadmap.md` § *F7*
 * derived the transformation once, on 2026-09-02, and recorded it as *"four
 * `@endora-commerce/*` `workspace:` ranges and three monorepo-relative
 * configuration references"*. Re-derived against the tree on 2026-09-03 that is
 * already wrong in four ways — `@endora-commerce/api-client` has been dropped
 * from the storefront's manifest, the vitest configuration is `.mts` rather than
 * `.ts`, `app/globals.css` has grown a Tailwind `@source` glob into the
 * repository's package tree, and one test file imports a repository script. A
 * tool carrying the list would have copied three of those four out of the
 * repository unchanged and said nothing.
 *
 * So the population is computed on every run, from three sources that are each
 * an independent author of part of the answer:
 *
 *   * **`git ls-files`** for which files the reference storefront *is*. Build
 *     output, `node_modules` and a stray `.next` are excluded by construction
 *     rather than by an ignore list this file would have to keep current.
 *   * **the storefront's own `package.json`** for the `workspace:` ranges, in
 *     every dependency field rather than only `dependencies`.
 *   * **the copied text itself** for every relative reference that resolves
 *     outside the storefront directory, in the three shapes a Next application
 *     writes one: an ES module specifier, a JSON `extends`, and a CSS `@source`
 *     glob.
 *
 * A reference the transformation cannot make standalone is a **refusal**, never
 * a file copied out unchanged: that is the one property that keeps this command
 * from going stale the way the roadmap's own sentence did.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { isNextApplication } from '../lib/workspace-packages.js';

/** Raised when the reference storefront cannot be read. Exit 2. */
export class StorefrontHostError extends Error {}

/** Raised when the author asked for something this command refuses. Exit 1. */
export class StorefrontInputError extends Error {}

/** The dependency fields a manifest can declare a `workspace:` range in. */
export const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

export type DependencyField = (typeof DEPENDENCY_FIELDS)[number];

/** The reference storefront this run copies. */
export interface StorefrontReference {
  /** The directory holding `pnpm-workspace.yaml`. */
  readonly repoRoot: string;
  /** The reference storefront's directory, absolute. */
  readonly dir: string;
  /** Its files, storefront-relative, as git reports them. */
  readonly files: readonly string[];
  /** Its parsed manifest. */
  readonly manifest: Record<string, unknown>;
}

/** One `workspace:` range the copy has to rewrite. */
export interface WorkspaceRange {
  readonly field: DependencyField;
  readonly name: string;
  /** The range as written, e.g. `workspace:^`. */
  readonly declared: string;
}

/** The shapes a declaration can name a path in. */
export type ReferenceKind = 'module-specifier' | 'json-extends' | 'css-source';

/** One declaration naming something above the storefront directory. */
export interface OutwardReference {
  /** The file that writes it, storefront-relative. */
  readonly file: string;
  readonly kind: ReferenceKind;
  /** The specifier exactly as written. */
  readonly specifier: string;
  /** Where it resolves, absolute, before any glob segment. */
  readonly target: string;
}

/** The nearest ancestor of `start` holding a `pnpm-workspace.yaml`, or `null`. */
export function findRepoRoot(start: string): string | null {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * The reference storefront's files, from git.
 *
 * Git is the independent author here: the alternative is a walk plus an
 * exclusion list, and an exclusion list is a second answer to "what is this
 * application" that goes stale against `.gitignore` in silence. A checkout with
 * no git, or a storefront directory git does not track, is exit 2 — never a
 * partial copy.
 */
export function trackedFiles(repoRoot: string, storefrontDir: string): readonly string[] {
  const result = spawnSync('git', ['ls-files', '-z', '--', storefrontDir], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new StorefrontHostError(
      `\`git ls-files\` could not enumerate ${storefrontDir}: ` +
        `${result.error?.message ?? result.stderr}. The copy population is git's answer to ` +
        `"what is this application", so a run that cannot ask it copies nothing rather than ` +
        `walking the directory and guessing which artefacts are build output.`,
    );
  }
  const files = result.stdout
    .split('\0')
    .filter((line) => line.length > 0)
    .map((line) => relative(storefrontDir, join(repoRoot, line)));
  if (files.length === 0) {
    throw new StorefrontHostError(
      `git tracks no file under ${storefrontDir}. There is no reference storefront to copy.`,
    );
  }
  return files;
}

/**
 * Locate the reference storefront.
 *
 * It is found by the **one workspace member that is a Next application**, not by
 * a directory called `storefront`: the member's manifest declares `next` and a
 * `build` script that runs it, and `pnpm-workspace.yaml` says which directories
 * are members. A repository that renames the directory is followed; one that
 * grows a second Next application is exit 2 rather than a run over whichever
 * sorted first.
 */
export function resolveReference(cwd: string): StorefrontReference {
  const repoRoot = findRepoRoot(cwd);
  if (repoRoot === null) {
    throw new StorefrontHostError(
      `no pnpm-workspace.yaml above ${cwd}. \`endora new storefront\` copies the reference ` +
        `storefront out of a checkout of the platform repository, so it has to be run inside ` +
        `one. There is nothing for it to copy anywhere else.`,
    );
  }
  const candidates = nextApplications(repoRoot);
  if (candidates.length === 0) {
    throw new StorefrontHostError(
      `${repoRoot} declares no workspace member that is a Next application, so this checkout ` +
        `holds no reference storefront. A member qualifies by declaring \`next\` as a ` +
        `dependency and a \`build\` script that runs it.`,
    );
  }
  if (candidates.length > 1) {
    throw new StorefrontHostError(
      `${repoRoot} holds more than one Next application ` +
        `(${candidates.map((dir) => relative(repoRoot, dir)).join(', ')}). This command will ` +
        `not choose between them, because a run over whichever sorted first is a run whose ` +
        `subject nobody chose.`,
    );
  }
  const dir = candidates[0]!;
  const manifest = readManifest(join(dir, 'package.json'));
  return { repoRoot, dir, files: trackedFiles(repoRoot, dir), manifest };
}

function readManifest(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new StorefrontHostError(
      `${path} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Workspace member directories, from the `packages:` globs as written. */
export function memberDirectories(repoRoot: string): readonly string[] {
  const text = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
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
  const found: string[] = [];
  for (const glob of globs) {
    if (glob.startsWith('!')) continue;
    if (!glob.endsWith('/*')) {
      found.push(join(repoRoot, glob));
      continue;
    }
    found.push(...expand(join(repoRoot, glob.slice(0, -2))));
  }
  return found;
}

function expand(parent: string): readonly string[] {
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name));
}

function nextApplications(repoRoot: string): readonly string[] {
  const found: string[] = [];
  for (const dir of memberDirectories(repoRoot)) {
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    // The predicate lives in `lib/workspace-packages.ts` because
    // `check-release-intent.ts` asks the same question of the same population
    // — which member is the reference storefront — and two copies of it are two
    // answers waiting to disagree (feature 104, FR-001).
    if (isNextApplication(manifest)) found.push(dir);
  }
  return [...found].sort();
}

/** Every `workspace:` range the reference storefront declares, in field order. */
export function workspaceRanges(manifest: Record<string, unknown>): readonly WorkspaceRange[] {
  const found: WorkspaceRange[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const block = manifest[field];
    if (typeof block !== 'object' || block === null) continue;
    for (const [name, declared] of Object.entries(block as Record<string, unknown>)) {
      if (typeof declared !== 'string' || !declared.startsWith('workspace:')) continue;
      found.push({ field, name, declared });
    }
  }
  return found;
}

/** Files whose text this analysis reads for outward references. */
const TEXTUAL = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|css)$/;

/**
 * Every relative declaration in the reference storefront that resolves outside
 * it, in the three shapes an application writes one.
 *
 * The specifier's own leading `.` is what makes it a candidate: a bare specifier
 * names a package and is resolved by the installer, not by this copy. A glob is
 * resolved up to its first wildcard segment, because that prefix is the part
 * that has to exist.
 */
export function outwardReferences(reference: StorefrontReference): readonly OutwardReference[] {
  const found: OutwardReference[] = [];
  for (const file of reference.files) {
    if (!TEXTUAL.test(file)) continue;
    const absolute = join(reference.dir, file);
    if (!existsSync(absolute)) continue;
    const text = readFileSync(absolute, 'utf8');
    for (const raw of referencesIn(text)) {
      if (!raw.specifier.startsWith('.')) continue;
      const target = resolve(dirname(absolute), globPrefix(raw.specifier));
      if (target === reference.dir || target.startsWith(reference.dir + sep)) continue;
      found.push({ file, kind: raw.kind, specifier: raw.specifier, target });
    }
  }
  return found.sort((a, b) => a.file.localeCompare(b.file) || a.specifier.localeCompare(b.specifier));
}

/** The path prefix of a glob: everything up to the first wildcard segment. */
export function globPrefix(specifier: string): string {
  const segments = specifier.split('/');
  const wildcard = segments.findIndex((segment) => /[*?[{]/.test(segment));
  return wildcard === -1 ? specifier : segments.slice(0, wildcard).join('/');
}

interface RawReference {
  readonly kind: ReferenceKind;
  readonly specifier: string;
}

const MODULE_SPECIFIER =
  /(?:^|[\s;{(=])(?:import|export)\s[^'"()]*?from\s*['"]([^'"]+)['"]|(?:^|[^\w.])(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;{(])import\s*['"]([^'"]+)['"]/g;
const JSON_EXTENDS = /"extends"\s*:\s*"([^"]+)"/g;
const CSS_SOURCE = /@source\s+(?:not\s+)?['"]([^'"]+)['"]/g;

function referencesIn(text: string): readonly RawReference[] {
  const found: RawReference[] = [];
  for (const match of text.matchAll(MODULE_SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier !== undefined) found.push({ kind: 'module-specifier', specifier });
  }
  for (const match of text.matchAll(JSON_EXTENDS)) {
    found.push({ kind: 'json-extends', specifier: match[1]! });
  }
  for (const match of text.matchAll(CSS_SOURCE)) {
    found.push({ kind: 'css-source', specifier: match[1]! });
  }
  return found;
}
