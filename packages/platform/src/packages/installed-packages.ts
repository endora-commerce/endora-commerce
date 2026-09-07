// Installed extension packages — the enumeration half (feature 080, T031).
//
// This answers one question: which `node_modules` directories does this
// platform read, and which of the packages in them claim to be Endora modules?
// Turning those claims into composer entries is `package-runtime.ts`'s job.
//
// ## What it can see
//
//   - a package installed from a registry or from a tarball, in any layout that
//     leaves the package inside the `node_modules` tree it was found under:
//     npm/yarn's hoisted layout (a real directory), and pnpm's isolated layout
//     (`node_modules/<name>` → `node_modules/.pnpm/<name>@<v>/node_modules/<name>`);
//   - scoped and unscoped names alike, one level of `@scope/` deep, which is
//     the whole of npm's namespace shape;
//   - packages in **every** root {@link nodeModulesRootsFor} returns: the
//     declared instance root first, then the `node_modules` chain above the
//     running platform, which is Node's own resolution directory list.
//
// ## What it cannot see, deliberately
//
//   - **a workspace member.** pnpm links one into `node_modules` from outside,
//     so `<root>/node_modules/@endora-commerce/contracts` really is `packages/contracts`.
//     Every such link is refused, and that is the point: this repository's own
//     five `packages/*` must never be discovered as installed packages, and a
//     module package that is a workspace member is a fact about *the tree* and
//     belongs in the committed registry (D-149), not here. The predicate is
//     where the link **lands** — the same property assertion A8 of D-110
//     measures on the acceptance instance — and never "is there a symlink",
//     which would refuse the only layout a real pnpm instance has;
//   - **a `link:` or `file:` dependency onto a directory**, for the same reason
//     and by the same rule. An author developing a module against a live
//     instance has to `pnpm pack` and install the tarball, or point
//     `ENDORA_INSTANCE_ROOT` at a directory whose `node_modules` holds a real
//     install;
//   - **anything nested inside another package's `node_modules`.** Only the top
//     level of each root is enumerated. A transitive dependency that happens to
//     carry an `endora` field is not something this instance installed;
//   - **`.pnpm`, and any other dot-directory.** The store's contents are
//     reached through the top-level link, so descending would find each package
//     twice;
//   - **a package that is installed but whose `package.json` cannot be read or
//     parsed.** It is reported as `skipped`, never composed and never thrown
//     at: one unreadable stranger must not stop a shop from booting.
//
// ## The containment test is over real paths on both sides, and that is load-bearing
//
// A workspace link is **relative** — `backend/node_modules/@endora-commerce/contracts ->
// ../../../packages/contracts` — so it re-roots with whatever directory it
// physically sits in. Issue #255 is that fact biting from the other side: a
// `node_modules` symlinked at another checkout's makes every `@endora-commerce/*` resolve
// into that checkout, while `pnpm ls` cheerfully reports the local path,
// because it answers from the manifest's `link:` declaration and never reads
// the symlink.
//
// So the predicate here `realpath`s the **root** as well as the candidate. What
// it asks is "did this package's install stay inside the directory the roots
// really are", never "does its path start with the string we were handed" — a
// prefix test over the declared path would accept a `node_modules` that is
// itself a link into somebody else's tree. Both wirings of the `@endora-commerce/*` case
// come out the same and correct: the link lands on `packages/<name>`, which is
// outside whichever `node_modules` it was reached through, so a workspace
// member is refused whether the instance's `node_modules` is its own, a copy,
// or a link at another checkout's.
//
// ## Cost
//
// One `readdir` per root, one `readdir` per `@scope`, one `lstat` + one
// `readFile` per candidate. `package-runtime.ts` memoises the result for the
// process, because an instance's `node_modules` does not change while the
// platform runs.

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The environment variable naming the **instance** — the directory whose
 * `node_modules` holds this platform's installed extension packages.
 *
 * Unset is the ordinary case and is not a degraded one: a deployed instance
 * *is* the directory the platform runs from, so the chain above the running
 * code already names it. The variable exists for the case where the two are not
 * the same — a platform executed out of a checkout against an instance built
 * somewhere else, which is exactly what D-110's acceptance criterion does.
 */
export const INSTANCE_ROOT_ENV = 'ENDORA_INSTANCE_ROOT';

/** One installed package claiming to be an Endora module. */
export interface InstalledPackage {
  /** The module id it claims — `endora.id` (D-142), never the folder name. */
  readonly id: string;
  /** The npm package name. Identity for humans; never identity for the platform. */
  readonly name: string;
  readonly version: string;
  /** The package directory as installed, symlinks unfollowed. */
  readonly directory: string;
  /** `<directory>/package.json` — the file that claims {@link id}. */
  readonly manifestPath: string;
  /** The `node_modules` directory it was found under. */
  readonly foundUnder: string;
}

/** A candidate that was read and not accepted, with the reason. */
export type SkippedPackage =
  | {
      readonly kind: 'links-out-of-node-modules';
      readonly name: string;
      readonly at: string;
      readonly realPath: string;
    }
  | { readonly kind: 'not-an-endora-module'; readonly name: string; readonly at: string }
  | { readonly kind: 'unreadable'; readonly at: string; readonly reason: string };

export interface InstalledPackageScan {
  /** Accepted packages, ordered by npm name so composition is deterministic. */
  readonly packages: readonly InstalledPackage[];
  readonly skipped: readonly SkippedPackage[];
  /** The roots that existed and were walked — never the roots that were asked for. */
  readonly rootsRead: readonly string[];
}

/** `true` when `child` is inside `parent` (and is not `parent` itself). */
function isUnder(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

/**
 * Every `node_modules` directory this platform reads, nearest first.
 *
 * The declared instance root comes first, then the chain above the running
 * platform — in an instance, `<instance>/node_modules/@endora-commerce/platform`
 * upward to the instance root; in this checkout, the platform package's own and
 * the repository's. The chain is Node's own module-resolution directory list,
 * which is the honest answer to "where would an installed package be": wherever
 * `import` would find it. Roots that do not exist are dropped, so an empty
 * result means *nothing to read* rather than *nothing found*.
 *
 * **The chain is derived from this file's own location and therefore moved with
 * it** (`specs/110-instance-repository/` T113). It read from
 * `backend/src/packages/` until the relocation, so `backend/node_modules` was on
 * it and the platform package's was not; it now reads from
 * `@endora-commerce/platform`, which is where the platform actually runs from in
 * an instance, and is the reading `ENDORA_INSTANCE_ROOT` exists to override. No
 * discovery is lost in this checkout: every `@endora-commerce/*` entry under
 * `backend/node_modules` is a workspace link and is refused as one a few
 * hundred lines down, which is what `installed-packages.test.ts` asserts either
 * side of the move.
 */
export function nodeModulesRootsFor(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots: string[] = [];
  const push = (candidate: string): void => {
    if (!roots.includes(candidate)) roots.push(candidate);
  };

  const declared = env[INSTANCE_ROOT_ENV];
  if (typeof declared === 'string' && declared.trim().length > 0) {
    push(join(resolve(declared.trim()), 'node_modules'));
  }

  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (basename(directory) !== 'node_modules') push(join(directory, 'node_modules'));
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return roots.filter((root) => {
    try {
      return statSync(root).isDirectory();
    } catch {
      return false;
    }
  });
}

/** The `endora` field, as far as this file cares about it. */
interface EndoraField {
  readonly type?: unknown;
  readonly id?: unknown;
}

interface PackageJson {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly endora?: EndoraField;
}

/**
 * Read one candidate directory and classify it.
 *
 * `null` means "not a candidate at all" — no `package.json`, or one with no
 * `endora` field. That is the overwhelmingly common case in any `node_modules`
 * and is deliberately silent: reporting every ordinary dependency as `skipped`
 * would bury the three answers that matter.
 */
function classify(
  directory: string,
  root: string,
): { package: InstalledPackage } | { skipped: SkippedPackage } | null {
  const manifestPath = join(directory, 'package.json');
  if (!existsSync(manifestPath)) return null;

  let parsed: PackageJson;
  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch (error) {
    return {
      skipped: {
        kind: 'unreadable',
        at: manifestPath,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
  try {
    parsed = JSON.parse(raw) as PackageJson;
  } catch (error) {
    return {
      skipped: {
        kind: 'unreadable',
        at: manifestPath,
        reason: `package.json is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    };
  }

  const endora = parsed.endora;
  if (endora === undefined || endora === null || typeof endora !== 'object') return null;

  const name = typeof parsed.name === 'string' ? parsed.name : basename(directory);

  if (endora.type !== 'module') {
    // A theme, a kit, a distribution meta-package. Reported rather than
    // silent: it carries the field, so its author meant the platform to see it.
    return { skipped: { kind: 'not-an-endora-module', name, at: manifestPath } };
  }

  if (typeof endora.id !== 'string' || endora.id.trim().length === 0) {
    return {
      skipped: {
        kind: 'unreadable',
        at: manifestPath,
        reason:
          '`endora.type` is "module" but `endora.id` is missing or empty, so the package claims ' +
          'no module id. The id is the platform\'s identity for a module (D-142); the npm name ' +
          'is not, because an author may rename a package.',
      },
    };
  }

  // Where the install really landed. See the header: this is the whole of "a
  // workspace member is not an installed package", and it is a property of the
  // install rather than a claim the package makes about itself.
  //
  // `realpath` on **both** sides, unconditionally. Not "resolve the candidate
  // if it happens to be a symlink and compare it to the path we were handed":
  // a `node_modules` that is itself a link — a copied or aliased tree, issue
  // #255's shape — would then refuse every real directory under it, and a
  // declared root that is a link into another checkout would be trusted on its
  // spelling.
  let realPath: string;
  let realRoot: string;
  try {
    realPath = realpathSync(directory);
    realRoot = realpathSync(root);
  } catch (error) {
    return {
      skipped: {
        kind: 'unreadable',
        at: manifestPath,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
  if (!isUnder(realPath, realRoot)) {
    return { skipped: { kind: 'links-out-of-node-modules', name, at: directory, realPath } };
  }

  return {
    package: {
      id: endora.id.trim(),
      name,
      version: typeof parsed.version === 'string' ? parsed.version : '0.0.0',
      directory,
      manifestPath,
      foundUnder: root,
    },
  };
}

/** Top-level candidate directories in one `node_modules`, `@scope/` expanded. */
function candidatesIn(root: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of entries.sort()) {
    // `.pnpm`, `.bin`, `.modules.yaml` — the store is reached through the
    // top-level link, so descending finds every package a second time.
    if (name.startsWith('.')) continue;
    const full = join(root, name);
    if (!name.startsWith('@')) {
      out.push(full);
      continue;
    }
    let scoped: string[];
    try {
      scoped = readdirSync(full);
    } catch {
      continue;
    }
    for (const inner of scoped.sort()) {
      if (inner.startsWith('.')) continue;
      out.push(join(full, inner));
    }
  }
  return out;
}

/**
 * Scan the given `node_modules` roots for installed Endora module packages.
 *
 * A package found in more than one root is taken from the nearest one — the
 * same precedence Node's resolver applies, so what the platform composes is
 * what an `import` of that name in the instance would load.
 */
export function scanNodeModulesRoots(roots: readonly string[]): InstalledPackageScan {
  const packages = new Map<string, InstalledPackage>();
  const skipped: SkippedPackage[] = [];
  const rootsRead: string[] = [];

  for (const root of roots) {
    try {
      if (!statSync(root).isDirectory()) continue;
    } catch {
      continue;
    }
    rootsRead.push(root);
    for (const directory of candidatesIn(root)) {
      const verdict = classify(directory, root);
      if (verdict === null) continue;
      if ('skipped' in verdict) {
        skipped.push(verdict.skipped);
        continue;
      }
      // Nearest root wins; a farther copy of the same npm package is shadowed
      // exactly as it would be for an `import`.
      if (!packages.has(verdict.package.name)) packages.set(verdict.package.name, verdict.package);
    }
  }

  return {
    packages: [...packages.values()].sort((a, b) => a.name.localeCompare(b.name)),
    skipped,
    rootsRead,
  };
}
