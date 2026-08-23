/**
 * "Is the host package the same platform this process is running?" — measured,
 * in a child process, one subpath at a time (feature 080, T040b).
 *
 * `@endora-commerce/platform` emits `dist/{kernel,http,tenancy,commands,events}`
 * from `rootDir: ../../backend/src` (T042a, !891), so its artefact is the same
 * five directories **compiled a second time**. A file in this repository reaches
 * them at `backend/src/…`; anything resolving the bare specifier reaches
 * `packages/platform/dist/…`. Two files, two module records, two of every value
 * they export.
 *
 * ## Why this runs in a child process
 *
 * Importing both sides puts every platform entity class into MikroORM's global
 * metadata storage twice — `MetadataStorage.metadata` is
 * `globalThis['mikro-orm-metadata']` under an unversioned key (D-160.6), so the
 * two registrations land in one registry and the next `MikroORM.init` in that
 * process throws `Duplicate entity names are not allowed`. The measurement must
 * not be able to do that to a suite that shares a fork, so it is spawned,
 * prints JSON, and exits.
 *
 * ## What it prints
 *
 * One record per published subpath: the exports whose value is the **same
 * object** on both sides, and the exports whose value is not. Names are read
 * off the two module namespaces rather than listed here, so a barrel that gains
 * or loses a symbol changes the measurement instead of going stale (D-100).
 * Type-only exports are absent from both namespaces by construction and so are
 * outside the population — which is exactly right: types are erased, and the
 * whole reason the acceptance fixture is unaffected by this is that everything
 * it takes from the host is a type
 * (`backend/scripts/acceptance/package-schema.ts`, `provisionHostPeers`).
 *
 * Exit 2 on anything that would make an empty answer look like a clean one: an
 * unbuilt host package, a subpath that would not import, a barrel that exported
 * nothing.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(HERE, '..', '..');
const REPO_ROOT = join(BACKEND_ROOT, '..');
const HOST_PACKAGE = join(REPO_ROOT, 'packages', 'platform');

/**
 * The subpaths the host publishes, read off its own `exports` map rather than
 * written here: a sixth published directory has to be measured the day it is
 * published, not the day somebody remembers this file.
 */
async function publishedSubpaths(): Promise<string[]> {
  const manifestPath = join(HOST_PACKAGE, 'package.json');
  if (!existsSync(manifestPath)) {
    refuse(`${manifestPath} does not exist — there is no host package to compare against`);
  }
  const manifest = (await import(pathToFileURL(manifestPath).href, { with: { type: 'json' } })) as {
    default: { exports?: Record<string, unknown> };
  };
  const keys = Object.keys(manifest.default.exports ?? {})
    .filter((key) => key.startsWith('./') && key !== './package.json')
    .map((key) => key.slice(2))
    .sort();
  if (keys.length === 0) refuse('the host package publishes no subpath');
  return keys;
}

function refuse(reason: string): never {
  process.stderr.write(`[host-package-copy] ${reason}\n`);
  process.exit(2);
}

/** Every export whose value can carry identity — a function, a class, an object. */
function identityBearingExports(namespace: Record<string, unknown>): string[] {
  return Object.keys(namespace)
    .filter((name) => {
      const value = namespace[name];
      return typeof value === 'function' || (typeof value === 'object' && value !== null);
    })
    .sort();
}

interface SubpathComparison {
  readonly subpath: string;
  /** Exports that are one object on both sides — nothing crosses a copy boundary. */
  readonly shared: readonly string[];
  /** Exports that are two objects: a consumer of the bare specifier gets the other one. */
  readonly distinct: readonly string[];
}

async function compare(subpath: string): Promise<SubpathComparison> {
  const built = join(HOST_PACKAGE, 'dist', subpath, 'index.js');
  if (!existsSync(built)) {
    refuse(
      `${built} does not exist — the host package is not built. Run ` +
        '`pnpm run build:packages`; an unbuilt package would report "nothing is duplicated".',
    );
  }
  const source = join(BACKEND_ROOT, 'src', subpath, 'index.ts');
  if (!existsSync(source)) {
    refuse(`${source} does not exist — the host publishes a subpath this application has no barrel for`);
  }

  const fromPackage = (await import(pathToFileURL(built).href)) as Record<string, unknown>;
  const fromApplication = (await import(pathToFileURL(source).href)) as Record<string, unknown>;

  const names = identityBearingExports(fromPackage).filter((name) => name in fromApplication);
  if (names.length === 0) {
    refuse(
      `neither side of '${subpath}' exports a value with identity — the comparison would ` +
        'report "no duplication" for a barrel it never read',
    );
  }

  const shared: string[] = [];
  const distinct: string[] = [];
  for (const name of names) {
    (fromPackage[name] === fromApplication[name] ? shared : distinct).push(name);
  }
  return { subpath, shared, distinct };
}

const comparisons: SubpathComparison[] = [];
for (const subpath of await publishedSubpaths()) comparisons.push(await compare(subpath));
process.stdout.write(`${JSON.stringify(comparisons)}\n`);
