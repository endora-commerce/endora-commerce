/**
 * "Do the two specifier shapes reach the same platform?" — measured, in a child
 * process, one published subpath at a time (feature 080, the platform
 * relocation).
 *
 * ## What it used to measure, and why it is inverted
 *
 * Until the relocation `@endora-commerce/platform` emitted its `dist` from
 * `rootDir: ../../backend/src` (T042a, !891), so its artefact was
 * `backend/src/{kernel,http,tenancy,commands,events}` **compiled a second
 * time**. The application ran the originals through `tsx`; anything resolving
 * the bare specifier ran the copy. This probe reported that: 59 identity-bearing
 * exports across the five subpaths, **none** of them shared, and
 * `instanceof HttpError` false across the boundary.
 *
 * The five directories now live in the package, and the application reaches them
 * through re-export shims at their old paths, each forwarding to the same build
 * output the `exports` map serves. So the measurement is the same and the
 * expected answer is the opposite — this file measures it, and
 * `test/unit/kernel/platform-single-copy.test.ts` asserts it.
 *
 * ## The two sides, and why they are these two
 *
 * **Side one is the bare specifier** — `@endora-commerce/platform/<subpath>` —
 * which is what an installed extension package writes and the only route its
 * `exports` map permits. It is imported by name rather than by file path
 * deliberately: the resolution under test is the one a customer's install
 * performs.
 *
 * **Side two is the application's own reach**, which is every re-export shim
 * under `backend/src/<subpath>/`. A module in this repository still writes
 * `../../kernel/lifecycle/registry-cache.js`, so the shim is the file it lands
 * on and the value it ends up holding is whatever the shim forwards. Merging the
 * shims of one subpath gives the names the application can hold out of that
 * directory; intersecting with the barrel's gives the population to compare.
 *
 * A name both sides carry must be the **same object**. Anything else means two
 * module records for one source file, which is the defect in full: an
 * `instanceof` that is false, a module-scoped singleton the host never
 * populates, an `AsyncLocalStorage` nobody enters, and a second `SalesChannel`
 * that `MikroORM.init` refuses outright (D-160.6).
 *
 * ## Why this runs in a child process
 *
 * It imports every shim in the tree, which pulls the whole platform — including
 * its six entity classes — into MikroORM's global metadata storage. That is
 * harmless once (the point of the exercise) and cannot be undone, so it must not
 * happen inside a fork the rest of the suite shares.
 *
 * Exit 2 on anything that would make an empty answer look like a clean one: an
 * unbuilt host package, a subpath that would not import, a subpath the
 * application reaches through no shim at all, a barrel that exported nothing.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(HERE, '..', '..');
const SRC_ROOT = join(BACKEND_ROOT, 'src');

/** The package name is the specifier under test; there is nothing to derive it from. */
const HOST_PACKAGE = '@endora-commerce/platform';

function refuse(reason: string): never {
  process.stderr.write(`[platform-single-copy] ${reason}\n`);
  process.exit(2);
}

/**
 * The subpaths the host publishes, read off its own `exports` map rather than
 * written here: a sixth published directory has to be measured the day it is
 * published, not the day somebody remembers this file.
 */
async function publishedSubpaths(): Promise<string[]> {
  const manifest = (await import(`${HOST_PACKAGE}/package.json`, { with: { type: 'json' } })) as {
    default: { exports?: Record<string, unknown> };
  };
  const keys = Object.keys(manifest.default.exports ?? {})
    .filter((key) => key.startsWith('./') && key !== './package.json')
    .map((key) => key.slice(2))
    .sort();
  if (keys.length === 0) refuse('the host package publishes no subpath');
  return keys;
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

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

interface SubpathComparison {
  readonly subpath: string;
  /** How many shim files the application reaches this subpath through. */
  readonly shims: number;
  /** Exports that are the **same object** on both sides — one copy. */
  readonly shared: readonly string[];
  /** Exports that are two objects: the duplication, back. */
  readonly distinct: readonly string[];
}

async function compare(subpath: string): Promise<SubpathComparison> {
  const fromPackage = (await import(`${HOST_PACKAGE}/${subpath}`).catch((error: unknown) => {
    refuse(
      `'${HOST_PACKAGE}/${subpath}' did not import (${String(error)}). The host package is ` +
        'probably not built — run `pnpm run build:packages`; an unbuilt package would ' +
        'report "nothing to compare".',
    );
  })) as Record<string, unknown>;

  const shimFiles = walk(join(SRC_ROOT, subpath));
  if (shimFiles.length === 0) {
    refuse(
      `the application reaches '${subpath}' through no file under ${join(SRC_ROOT, subpath)}. ` +
        'The comparison would have one side and would report "no duplication" for a ' +
        'subpath it never read.',
    );
  }

  /** Name → value, merged over the subpath's shims, with disagreement reported. */
  const fromApplication = new Map<string, unknown>();
  for (const file of shimFiles) {
    const namespace = (await import(pathToFileURL(file).href).catch((error: unknown) => {
      refuse(`${relative(BACKEND_ROOT, file)} did not import: ${String(error)}`);
    })) as Record<string, unknown>;
    for (const name of Object.keys(namespace)) {
      const already = fromApplication.get(name);
      if (already !== undefined && already !== namespace[name]) {
        // Two shims of one directory handing out two objects for one name is
        // the duplication in miniature, and it would otherwise be hidden by
        // whichever import happened to come last.
        refuse(
          `two files under src/${subpath} export '${name}' as different objects — ` +
            'the application does not agree with itself about the platform',
        );
      }
      fromApplication.set(name, namespace[name]);
    }
  }

  const names = identityBearingExports(fromPackage).filter((name) => fromApplication.has(name));
  if (names.length === 0) {
    refuse(
      `no value with identity is reachable both ways for '${subpath}' — the comparison ` +
        'would report "one copy" for a barrel it never compared',
    );
  }

  const shared: string[] = [];
  const distinct: string[] = [];
  for (const name of names) {
    (fromPackage[name] === fromApplication.get(name) ? shared : distinct).push(name);
  }
  return { subpath, shims: shimFiles.length, shared, distinct };
}

const comparisons: SubpathComparison[] = [];
for (const subpath of await publishedSubpaths()) comparisons.push(await compare(subpath));
process.stdout.write(`${JSON.stringify(comparisons)}\n`);
