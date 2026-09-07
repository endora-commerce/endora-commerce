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
 * ## A barrel spanning directories, and a directory that is not all shims
 *
 * `backend/src/<subpath>/**` was the whole of side two until
 * `specs/115-lifecycle-container-move/` Phase 2, and it is wrong for a
 * **host-internal** subpath in both directions.
 *
 * `./composition` re-exports out of `http/`, `kernel/` and `tenancy/` because a
 * composition root does, so its application spelling is a shim under one of
 * *those* directories and there is no `backend/src/composition/` for the walk to
 * find. It was therefore recorded `unshimmed` — a fair description of the walk
 * and a false one of the tree: `registryCache` is reachable at
 * `backend/src/kernel/lifecycle/registry-cache.ts` and at
 * `@endora-commerce/platform/composition`, two spellings of the module-scoped
 * singleton whose second copy *"no `state-changed` message reaches"*, and
 * nothing in the repository compared them.
 *
 * `./lifecycle` is the other direction. `backend/src/lifecycle/` holds twelve
 * shims **and seven real application files**, five of which are `module:*` CLI
 * entry points that open an ORM and `process.exit` at import. A walk that
 * imported the directory whole would not measure a duplication, it would run a
 * lifecycle command against whatever `DATABASE_URL` names.
 *
 * So side two is the **union** of two derivations, and neither is a list:
 *
 *  1. every file under `backend/src/<subpath>/` that forwards to the platform,
 *     which is exactly the shims — a file that does not forward holds the
 *     application's own values, which are not a second spelling of anything, and
 *     is never imported;
 *  2. for each name the barrel re-exports, the application file at the barrel's
 *     own target path, if there is one and it forwards.
 *
 * Measured when it landed: the five published subpaths' shared count is
 * unchanged at 57 — the second derivation adds no name the first did not already
 * reach — and `./composition` gains 22 comparable values, `registryCache` among
 * them.
 *
 * ## A declared subpath the application really does not reach
 *
 * `./migrations` is one: the frozen historical prefix is data the platform
 * carries with no second copy anywhere in the application. One route is not a
 * duplication, so there is nothing here to compare and reporting "no
 * duplication" over it would be reporting on a comparison that never happened.
 *
 * The discriminator is **structural and not an empty walk**: a subpath neither
 * derivation finds a forwarding file for is recorded as `unshimmed`, while a
 * `backend/src/<subpath>` directory that *is* there and yields no source file at
 * all stays exit 2 — that second state is the #113 shape, and it is the one a
 * deleted shim produces. Both lists are in the output and
 * `test/unit/kernel/platform-single-copy.test.ts` holds each of them to an
 * expected set, so a subpath moving between them fails in both directions.
 *
 * Exit 2 on anything that would make an empty answer look like a clean one: an
 * unbuilt host package, a subpath that would not import, a shim directory that
 * is there and holds no source, a barrel that could not be read, a subpath whose
 * forwarding files yielded no comparable value, and a run in which no subpath
 * was comparable at all.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { barrelKeyOf, parseBarrel } from '../../scripts/lib/platform-surface.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(HERE, '..', '..');
const SRC_ROOT = join(BACKEND_ROOT, 'src');
const PLATFORM_SRC = join(BACKEND_ROOT, '..', 'packages', 'platform', 'src');

/**
 * A file that forwards to the platform — the shim shape, in either spelling.
 *
 * Read off the source text rather than assumed from the path, because the
 * discrimination this makes is the one that keeps a `module:*` entry point out
 * of a walk that would execute it. A file naming neither the package nor its
 * directory is the application's own and is not a second spelling of a platform
 * value.
 *
 * **It is a re-export, not any mention of the specifier**, and that narrowing is
 * `specs/115-lifecycle-container-move/` Phase 5's. This read
 * `/from\s*'…platform…'/`, which matches an `import` exactly as well as an
 * `export … from` — harmless only for as long as no application file *consumed*
 * the package by bare specifier. D115-1's five entry points do: each imports
 * `run<Verb>Command` from `@endora-commerce/platform/lifecycle`. So the file
 * this header names as the one the filter exists to exclude walked straight back
 * into the population, and the walk's next step imported it — an ORM opened
 * against an unreachable service and a `process.exit` at import, in the probe.
 * A consumer holds no second spelling of anything; only a re-export does.
 * `[^;]` is what keeps the match inside one statement, so an `export` earlier in
 * the file cannot reach an `import` further down.
 */
const FORWARDS_TO_THE_PLATFORM =
  /export\s+(?:\*|type\s|\{)[^;]*?from\s*'[^']*(?:packages\/platform\/(?:dist|src)|@endora-commerce\/platform)[^']*'/;

/** The package name is the specifier under test; there is nothing to derive it from. */
const HOST_PACKAGE = '@endora-commerce/platform';

function refuse(reason: string): never {
  process.stderr.write(`[platform-single-copy] ${reason}\n`);
  process.exit(2);
}

/**
 * The subpaths the host declares, read off its own `exports` map rather than
 * written here: a sixth subpath has to be measured — or explicitly recorded as
 * unshimmed — the day it is declared, not the day somebody remembers this file.
 */
async function declaredSubpaths(): Promise<string[]> {
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

/**
 * The application files that are a second spelling of this subpath's platform
 * files: derivation 1 (the subpath's own directory) ∪ derivation 2 (the barrel's
 * targets, mirrored into `backend/src`), both filtered to files that forward.
 *
 * The forwarding filter is what keeps `backend/src/lifecycle/scripts/install.ts`
 * — a `module:*` entry point that opens an ORM and `process.exit`s at import —
 * out of a walk whose next step is to import everything it found. Since Phase 5
 * that entry point *names* the package by bare specifier, so the filter's shape
 * — a re-export and not a mention — is what does the keeping out.
 */
function applicationReachesOf(subpath: string): string[] {
  const forwarding = (file: string): boolean =>
    existsSync(file) && FORWARDS_TO_THE_PLATFORM.test(readFileSync(file, 'utf8'));

  const directory = join(SRC_ROOT, subpath);
  const files = new Set(walk(directory).filter(forwarding));
  if (existsSync(directory) && walk(directory).length === 0) {
    // The directory is there and holds no source at all. That is the walk coming
    // back empty, never a subpath the application does not reach — see the
    // header. A directory of files that merely do not forward is a different
    // state and a legitimate one: it is what a fully drained subpath looks like.
    refuse(
      `the application reaches '${subpath}' through no file under ${directory}, ` +
        'though the directory is there. The comparison would have one side and would ' +
        'report "no duplication" for a subpath it never read.',
    );
  }

  const barrel = join(PLATFORM_SRC, barrelKeyOf(subpath));
  if (existsSync(barrel)) {
    const parsed = parseBarrel(readFileSync(barrel, 'utf8'), barrelKeyOf(subpath));
    if (parsed.unreadable.length > 0) {
      // A barrel whose names cannot be enumerated silently narrows derivation 2
      // to the names it could read, which is a shorter comparison reported as a
      // complete one.
      refuse(
        `${barrelKeyOf(subpath)} holds a re-export this parse cannot enumerate ` +
          `(${parsed.unreadable.map((u) => u.reason).join('; ')})`,
      );
    }
    for (const symbol of parsed.published) {
      const mirrored = join(SRC_ROOT, symbol.target);
      if (forwarding(mirrored)) files.add(mirrored);
    }
  }
  return [...files].sort();
}

async function compare(subpath: string, shimFiles: readonly string[]): Promise<SubpathComparison> {
  const fromPackage = (await import(`${HOST_PACKAGE}/${subpath}`).catch((error: unknown) => {
    refuse(
      `'${HOST_PACKAGE}/${subpath}' did not import (${String(error)}). The host package is ` +
        'probably not built — run `pnpm run build:packages`; an unbuilt package would ' +
        'report "nothing to compare".',
    );
  })) as Record<string, unknown>;

  /** Name → value, merged over the subpath's shims, with disagreement reported. */
  const fromApplication = new Map<string, unknown>();
  for (const file of shimFiles) {
    const namespace = (await import(pathToFileURL(file).href).catch((error: unknown) => {
      refuse(`${relative(BACKEND_ROOT, file)} did not import: ${String(error)}`);
    })) as Record<string, unknown>;
    for (const name of Object.keys(namespace)) {
      const already = fromApplication.get(name);
      if (already !== undefined && already !== namespace[name]) {
        // Two of a subpath's shims handing out two objects for one name is the
        // duplication in miniature, and it would otherwise be hidden by
        // whichever import happened to come last.
        refuse(
          `two of '${subpath}'s application reaches export '${name}' as different objects — ` +
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

const declared = await declaredSubpaths();
const comparisons: SubpathComparison[] = [];
const unshimmed: string[] = [];
for (const subpath of declared) {
  // Structural, not an empty walk: no forwarding file by either derivation means
  // the application has one route to this subpath and there is no second copy
  // for one to disagree with.
  const reaches = applicationReachesOf(subpath);
  if (reaches.length > 0) comparisons.push(await compare(subpath, reaches));
  else unshimmed.push(subpath);
}
if (comparisons.length === 0) {
  refuse(
    'no declared subpath is reached through a shim, so nothing was compared. The ' +
      'application reaches the platform through re-export shims; a run that found none ' +
      'of them read one side of every comparison.',
  );
}
process.stdout.write(`${JSON.stringify({ declared, comparisons, unshimmed })}\n`);
