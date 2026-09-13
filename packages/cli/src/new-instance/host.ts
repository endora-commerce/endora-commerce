/**
 * What `endora new instance` may read, and what it refuses when it cannot.
 *
 * `contracts/cli-product.md` R2.3 is the whole of this file's brief: a command
 * derives what it needs from **what a client's machine can see** — the CLI's
 * own manifest, the packages installed beside the target directory, and the
 * registry — and never from this repository's layout. So there is no
 * `findRepoRoot` here and no `pnpm-workspace.yaml` read: `endora new module`
 * has both and is therefore a command that only works inside a checkout, which
 * is the state T130 exists to end.
 *
 * ## Two error classes, and the split is the exit-code contract
 *
 * `contracts/instance-tree.md` §4 and `cli-surface.md` §2: **1** is a refusal
 * the operator can act on, **2** is an input the run could not read. F1–F4 are
 * the first, F5–F8 the second, and the reason F5–F8 are not merged into F1 is
 * the estate's own everywhere: *a run that could not read its input has said
 * nothing*, and a scaffold written from values it could not read is worse than
 * no scaffold. Each error carries its class as a field so a test asserts the
 * class rather than matching prose that a later edit will legitimately reword.
 *
 * ## Where the packages come from
 *
 * One mechanism, and it answers identically in a client's tree and in this
 * checkout: **the nearest `node_modules/<scope>` on the way up from the target
 * directory, then from the working directory.** That is R2.3's *"the packages
 * installed beside the target directory"*, and it is what
 * `installed-packages.ts` already reads at runtime — so the set this command
 * writes a manifest for is the set the platform will later discover, rather
 * than a second answer derived a second way (D-100).
 *
 * It is deliberately **not** a workspace walk. A workspace member is a fact
 * about a tree (D-149) and a client has no workspace above their instance; a
 * command that fell back to one would work here and refuse on the machine it
 * was written for, which is the failure `cli-product.md` §1 measures.
 *
 * The **scope** is derived from the CLI's own name rather than written down, so
 * a fork publishing under another scope needs no edit here.
 *
 * ## Where a `^` range comes from, which is a different question
 *
 * **From the package being ranged, and from no other.** {@link readPackage}
 * reads every resolved package's own `version`, so the answer is already here
 * for each of them; what it is *not* is a property of this build, of the
 * platform, or of the release as a whole. A release is not uniform and nothing
 * in the estate makes it so — of the packages this repository published on
 * 2026-09-11, 68 moved to `0.8.0` and 15 to `0.7.1` — so a range built from
 * another package's version is a range the registry answers
 * `ERR_PNPM_NO_MATCHING_VERSION` to, at the client's first install and nowhere
 * earlier.
 *
 * That is the version the package **installed beside the target directory**
 * declares, which is the right source for the same reason the module set is: it
 * is the manifest the platform will read when it composes this same install, so
 * the tree the client gets back is pinned to what they already have rather than
 * to a second answer derived a second way (D-100). It is deliberately not a
 * registry query — this command makes no network call and would otherwise
 * scaffold against a version nobody had installed.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A refusal the operator can act on — F1…F4, exit `1`. */
export class InstanceInputError extends Error {
  override readonly name = 'InstanceInputError';
  /** The refusal class from `instance-tree.md` §4, so a test asserts the class. */
  readonly refusal: 'F1' | 'F2' | 'F3' | 'F4';

  constructor(refusal: 'F1' | 'F2' | 'F3' | 'F4', message: string) {
    super(message);
    this.refusal = refusal;
  }
}

/** An input this run could not read — F5…F8, exit `2`. */
export class InstanceHostError extends Error {
  override readonly name = 'InstanceHostError';
  readonly refusal: 'F5' | 'F6' | 'F7' | 'F8';

  constructor(refusal: 'F5' | 'F6' | 'F7' | 'F8', message: string) {
    super(message);
    this.refusal = refusal;
  }
}

/** The platform package every instance depends on. */
export const PLATFORM_PACKAGE = 'platform';

/** The admin shell, when it resolves (`instance-tree.md` §2.4). */
export const ADMIN_SHELL_PACKAGE = 'admin-shell';

/**
 * The admin design system, §2.4's other package.
 *
 * Both are named because the member is mounted on both and neither is reachable
 * through the other: the shell is what `main.tsx` mounts and the kit is what
 * `index.css` imports the token and class vocabulary from. A build in which one
 * resolves and the other does not writes no admin member, and says which.
 */
export const ADMIN_KIT_PACKAGE = 'admin-kit';

/** One `@endora-commerce/*` package this run resolved, with its own manifest. */
export interface ResolvedPackage {
  /** The npm name, verbatim — this is what goes into `dependencies`. */
  readonly name: string;
  /** Where it resolved from, so a refusal can name a real path. */
  readonly dir: string;
  readonly version: string;
  /** The `endora` block a module package declares about itself, when it has one. */
  readonly endora?: { readonly type?: string; readonly id?: string } | undefined;
  readonly manifest: Readonly<Record<string, unknown>>;
}

/** Everything the command reads before it decides anything. */
export interface InstanceHost {
  /** `@endora-commerce/`, with its trailing slash, off the CLI's own name. */
  readonly scope: string;
  /**
   * The CLI's own version — F8's subject, and the source of **this package's
   * own** `^` range and of no other.
   *
   * This read *"the source of every `^` range"*, and the sentence was load-bearing
   * in the wrong direction: it says a range is a property of the build rather
   * than of the package being ranged, which is precisely the premise under which
   * every module came to be declared at the platform's version. Every `^` range
   * an instance's manifest carries is over the version of **the package it
   * names** — this one for `@endora-commerce/cli`, {@link platformVersion} for
   * the platform, and each module package's own for itself.
   */
  readonly cliVersion: string;
  /** The CLI's own `engines.node`, which the instance re-declares (R2.3). */
  readonly enginesNode: string;
  /** The CLI's own `packageManager`, when it declares one. Never invented. */
  readonly packageManager: string | undefined;
  /**
   * The CLI's own manifest, whole.
   *
   * Carried rather than picked apart here because R2.3 names it as a *source*
   * and the fields a later rule reads off it are that rule's business — the
   * `typescript` range `devDependenciesFor` needs is the standing example.
   */
  readonly ownManifest: Readonly<Record<string, unknown>>;
  /** The directories searched, in order, so a refusal names where it looked. */
  readonly searched: readonly string[];
  /** Every scope package this run resolved, keyed by npm name. */
  readonly packages: ReadonlyMap<string, ResolvedPackage>;
  /**
   * The platform's own version — F6's subject, and the range of the platform
   * entry alone.
   *
   * Every other `@endora-commerce/*` entry an instance declares is ranged at the
   * version its **own** package declares, which {@link packages} carries per
   * package. A release is not uniform and a range over the wrong package's
   * version is one no registry can satisfy.
   */
  readonly platformVersion: string;
}

/** `@endora-commerce/cli` -> `@endora-commerce/`. */
export function scopeOfPackageName(name: string): string | null {
  const match = /^(@[^/]+)\//.exec(name);
  return match === null ? null : `${match[1]!}/`;
}

/**
 * The CLI's own manifest, found by walking up from this module.
 *
 * Up from `import.meta.url` rather than from `process.cwd()`, for
 * `isDirectEntry`'s reason one layer over: an installed consumer's working
 * directory is their own and has no relation to where this package lives.
 */
export function readOwnManifest(
  moduleUrl: string = import.meta.url,
): Readonly<Record<string, unknown>> {
  let current = dirname(fileURLToPath(moduleUrl));
  for (;;) {
    const candidate = join(current, 'package.json');
    if (existsSync(candidate)) {
      try {
        return JSON.parse(readFileSync(candidate, 'utf8')) as Record<string, unknown>;
      } catch (error: unknown) {
        throw new InstanceHostError(
          'F8',
          `this build's own manifest at ${candidate} could not be parsed ` +
            `(${error instanceof Error ? error.message : String(error)}), so the npm scope an ` +
            `instance resolves and declares its packages under, the \`engines.node\` it ` +
            `re-declares and the \`^<version>\` it installs this CLI at all have no source. ` +
            `Nothing is written: a scaffold whose values the tool invented is a scaffold ` +
            `nobody reviewed.`,
        );
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new InstanceHostError(
        'F8',
        `this build has no \`package.json\` above ${dirname(fileURLToPath(moduleUrl))}, so it ` +
          `cannot determine its own version, its own npm scope or the \`engines.node\` an ` +
          `instance re-declares — and the scope is what every package it installs is resolved ` +
          `under. Reinstall \`@endora-commerce/cli\` rather than running it from a loose file.`,
      );
    }
    current = parent;
  }
}

/** Every `<dir>/node_modules/<scope>` on the way up from `start`, outermost last. */
function scopeRootsAbove(start: string, scope: string): readonly string[] {
  const roots: string[] = [];
  let current = resolve(start);
  for (;;) {
    const candidate = join(current, 'node_modules', scope.slice(0, -1));
    if (existsSync(candidate)) roots.push(candidate);
    const parent = dirname(current);
    if (parent === current) return roots;
    current = parent;
  }
}

/**
 * Read one package directory's manifest, or refuse.
 *
 * F7 rather than a skip: a package the run cannot read is a package whose id,
 * version and dependencies are unknown, and crediting it with none would put a
 * silently short module set into a manifest the client then installs.
 */
function readPackage(dir: string): ResolvedPackage | null {
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) return null;
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  } catch (error: unknown) {
    throw new InstanceHostError(
      'F7',
      `${manifestPath} could not be parsed ` +
        `(${error instanceof Error ? error.message : String(error)}). Nothing is written: a ` +
        `module set derived from packages this run could not read would be short by however ` +
        `many it could not read, and the shortfall would be invisible in the tree.`,
    );
  }
  const name = manifest['name'];
  const version = manifest['version'];
  if (typeof name !== 'string' || typeof version !== 'string') {
    throw new InstanceHostError(
      'F7',
      `${manifestPath} declares no \`name\` or no \`version\`, so no dependency entry can be ` +
        `written for it. Nothing is written.`,
    );
  }
  return {
    name,
    dir,
    version,
    endora: manifest['endora'] as ResolvedPackage['endora'],
    manifest,
  };
}

/**
 * What this run can see, or the refusal saying which input it could not read.
 *
 * Validate-then-write (R5.2) starts here: every F5–F8 condition is decided
 * before the plan is built, so a run that is going to refuse has written
 * nothing and has touched no directory.
 */
export function resolveInstanceHost(options: {
  readonly cwd: string;
  readonly targetDir: string;
  readonly moduleUrl?: string | undefined;
}): InstanceHost {
  const own = readOwnManifest(options.moduleUrl);
  const ownName = own['name'];
  const cliVersion = own['version'];
  if (typeof ownName !== 'string' || typeof cliVersion !== 'string') {
    throw new InstanceHostError(
      'F8',
      `this build's own manifest declares no \`name\` or no \`version\`, so the scope an ` +
        `instance installs from and the \`^<version>\` it installs this CLI at both have no ` +
        `source.`,
    );
  }
  const scope = scopeOfPackageName(ownName);
  if (scope === null) {
    throw new InstanceHostError(
      'F8',
      `this build's own name (${ownName}) carries no npm scope, so the scope an instance ` +
        `installs its packages from cannot be derived from it.`,
    );
  }
  const engines = own['engines'] as { readonly node?: unknown } | undefined;
  const enginesNode = typeof engines?.node === 'string' ? engines.node : undefined;
  if (enginesNode === undefined) {
    throw new InstanceHostError(
      'F8',
      `this build declares no \`engines.node\`, which is the value R2.3 says an instance ` +
        `re-declares from the CLI's own manifest. A version this command chose would be a ` +
        `value nobody reviewed.`,
    );
  }
  const packageManager = own['packageManager'];

  const searched = [
    ...scopeRootsAbove(options.targetDir, scope),
    ...scopeRootsAbove(options.cwd, scope),
  ];
  const packages = new Map<string, ResolvedPackage>();
  for (const root of searched) {
    for (const entry of readdirSync(root)) {
      if (entry.startsWith('.')) continue;
      const resolved = readPackage(join(root, entry));
      // First root wins: the nearest install to the target is the one whose
      // versions that tree will actually resolve.
      if (resolved !== null && !packages.has(resolved.name)) packages.set(resolved.name, resolved);
    }
  }

  const platform = packages.get(`${scope}${PLATFORM_PACKAGE}`);
  if (platform === undefined) {
    throw new InstanceHostError(
      'F6',
      `${scope}${PLATFORM_PACKAGE} does not resolve from ${options.targetDir} or ` +
        `${options.cwd}, so the version every \`^\` range in the instance's manifest would be ` +
        `taken from has no source, and neither do the module manifests the module set is ` +
        `closed over.` +
        (searched.length === 0
          ? ` No \`node_modules/${scope.slice(0, -1)}\` was found on the way up from either.`
          : ` Looked in: ${searched.join(', ')}.`) +
        ` Install the platform beside the directory you are scaffolding into — ` +
        `\`pnpm add ${scope}${PLATFORM_PACKAGE}\` in the parent of the target, or run this ` +
        `command from a directory that already has it — and try again.`,
    );
  }

  return {
    scope,
    cliVersion,
    ownManifest: own,
    enginesNode,
    packageManager: typeof packageManager === 'string' ? packageManager : undefined,
    searched,
    packages,
    platformVersion: platform.version,
  };
}
