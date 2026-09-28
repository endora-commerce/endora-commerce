/**
 * The release index — what this CLI's release published, written at build
 * (`specs/080-f4-real-scope/rulings.md` D-271 clause 2).
 *
 * ## Why the CLI carries it
 *
 * `endora install` run where nothing of ours is installed — the `npx` front
 * door, from an empty directory — has no module manifest to read: the platform,
 * the admin packages and every module are what the module set is derived from,
 * and none of them can be read without installing them. The install verb
 * therefore provisions a temporary host from this index (`install/host.ts`).
 * It is a fact the CLI publishes **about its own release**, so it is
 * `cli-product.md` R2.3's *"the CLI's own manifest"* class rather than a
 * registry query or a list.
 *
 * ## Derived, and never written by hand
 *
 * {@link publishablePackages} is the one rule: every workspace package under
 * `packages/` whose manifest is not `private` and has a name. The instance
 * acceptance criterion packs exactly that population and imports this function
 * rather than restating it; the index is the same population narrowed to the
 * CLI's own scope, each at the `version` its manifest declares at build time.
 * It lives in `dist` and is never committed, so nothing in the tree can go
 * stale: the publish job builds the versioned tree immediately before it
 * publishes, and a release that is not uniform is recorded as it is. A paid
 * package is in no index because it is not in this workspace (D-265).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The file's name under the CLI's `dist`. */
export const RELEASE_INDEX_FILE = 'release-index.json';

/** One publishable workspace package, with its directory and declared version. */
export interface PublishablePackage {
  readonly name: string;
  readonly dir: string;
  /** Absent when the manifest declares none; the index refuses such a package. */
  readonly version: string | undefined;
}

/** One entry of the index. */
export interface ReleaseIndexEntry {
  readonly name: string;
  readonly version: string;
}

/** The whole index: this CLI's release, sorted by name. */
export interface ReleaseIndex {
  readonly packages: readonly ReleaseIndexEntry[];
}

/**
 * Every publishable workspace package under `packagesRoot`, with its directory.
 *
 * A directory holding a `package.json` is a package and is not descended
 * into; one without is a grouping directory (`packages/modules/`) and is. A
 * manifest declaring `private: true`, or no `name`, is not publishable.
 */
export function publishablePackages(packagesRoot: string): readonly PublishablePackage[] {
  const found: PublishablePackage[] = [];
  const walk = (root: string): void => {
    if (!existsSync(root)) return;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      const manifestPath = join(dir, 'package.json');
      if (!existsSync(manifestPath)) {
        walk(dir);
        continue;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        name?: unknown;
        version?: unknown;
        private?: unknown;
      };
      if (manifest.private === true || typeof manifest.name !== 'string') continue;
      found.push({
        name: manifest.name,
        dir,
        version: typeof manifest.version === 'string' ? manifest.version : undefined,
      });
    }
  };
  walk(packagesRoot);
  return found;
}

/**
 * The index over `packagesRoot`, narrowed to `scope` (`@endora-commerce/`).
 *
 * A publishable package that declares no version is a throw rather than a
 * skip: an index short by a package is a host short by a module, and the
 * module set derived from it would be silently smaller than the release.
 */
export function releaseIndexOf(packagesRoot: string, scope: string): ReleaseIndex {
  const packages: ReleaseIndexEntry[] = [];
  for (const pkg of publishablePackages(packagesRoot)) {
    if (!pkg.name.startsWith(scope)) continue;
    if (pkg.version === undefined) {
      throw new Error(
        `${join(pkg.dir, 'package.json')} is publishable and declares no \`version\`, so the ` +
          'release index cannot say which version of it this release carries.',
      );
    }
    packages.push({ name: pkg.name, version: pkg.version });
  }
  packages.sort((a, b) => a.name.localeCompare(b.name));
  return { packages };
}

/** Read an index back, refusing anything that is not one. `source` names the file. */
export function parseReleaseIndex(text: string, source: string): ReleaseIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    throw new Error(
      `${source} is not JSON (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  const packages = (parsed as { packages?: unknown } | null)?.packages;
  if (!Array.isArray(packages)) {
    throw new Error(`${source} holds no \`packages\` list.`);
  }
  const entries: ReleaseIndexEntry[] = [];
  for (const entry of packages) {
    const name = (entry as { name?: unknown } | null)?.name;
    const version = (entry as { version?: unknown } | null)?.version;
    if (typeof name !== 'string' || typeof version !== 'string') {
      throw new Error(`${source} holds an entry with no string \`name\` or \`version\`.`);
    }
    entries.push({ name, version });
  }
  if (entries.length === 0) {
    throw new Error(`${source} names no package, so there is nothing to install from it.`);
  }
  return { packages: entries };
}

/**
 * Where this CLI's own index is: `dist/` of the nearest package root above
 * this module — the same file from `src/` in a checkout and from `dist/` in an
 * installed tarball.
 */
export function ownReleaseIndexPath(moduleUrl: string = import.meta.url): string {
  let current = dirname(fileURLToPath(moduleUrl));
  for (;;) {
    if (existsSync(join(current, 'package.json'))) return join(current, 'dist', RELEASE_INDEX_FILE);
    const parent = dirname(current);
    if (parent === current) return join(dirname(fileURLToPath(moduleUrl)), RELEASE_INDEX_FILE);
    current = parent;
  }
}

/**
 * The build step: derive the index for the CLI package at `cliDir` and write
 * it into its `dist`.
 *
 * The workspace is found by walking up to `pnpm-workspace.yaml`, and the
 * scope comes off the CLI's own name — nothing here is written down. Called by
 * `scripts/write-release-index.mjs`, which the package's `build` runs after
 * `tsc`; a failure fails the build rather than shipping a CLI with no index.
 */
export function writeReleaseIndex(cliDir: string): ReleaseIndex {
  const own = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8')) as { name?: unknown };
  const scope =
    typeof own.name === 'string' ? /^(@[^/]+\/)/.exec(own.name)?.[1] : undefined;
  if (scope === undefined) {
    throw new Error(`${join(cliDir, 'package.json')} declares no scoped name to derive a scope from.`);
  }
  let root = cliDir;
  while (!existsSync(join(root, 'pnpm-workspace.yaml'))) {
    const parent = dirname(root);
    if (parent === root) {
      throw new Error(`no pnpm-workspace.yaml above ${cliDir}: the release index is derived from a checkout.`);
    }
    root = parent;
  }
  const index = releaseIndexOf(join(root, 'packages'), scope);
  const platform = `${scope}platform`;
  if (!index.packages.some((entry) => entry.name === platform)) {
    throw new Error(`${platform} is not among the publishable packages under ${join(root, 'packages')}.`);
  }
  writeFileSync(join(cliDir, 'dist', RELEASE_INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return index;
}
