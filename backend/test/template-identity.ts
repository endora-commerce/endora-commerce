/**
 * Which migration template this run's platform is, read off the tree (issue #289).
 *
 * The template is shared by every invocation on the machine that has the same
 * platform, and by construction none that has a different one — so what
 * "the same platform" means has to be *computed*, not assumed, and the answer
 * has to be wrong-proof in one direction: two trees that differ anywhere the
 * template can see must not agree here.
 *
 * So the inputs are the ordered migration class names — from
 * `src/db/configured-migrations.ts`, which is the order the ORM config itself
 * runs and carries the manifest graph's effect on it — plus the SHA-256 of
 * every file that writes into the template: every migration source, and the
 * declared seed sources below. `templateDigest` folds them; nothing here knows
 * about databases.
 *
 * **What it does not cover, deliberately.** A migration is free to call into
 * `src/`, and hashing everything reachable would rebuild the template on any
 * change to the backend at all. The rule the tree actually follows is that a
 * migration is self-contained SQL, and the two seed sources are the exception
 * that is declared rather than discovered. A seeding step added anywhere else
 * is invisible here — which is why `template-seed.ts` exists and says so.
 *
 * Everything below fails loudly rather than quietly returning less: a digest
 * over a partial read names a template that holds more than the digest says,
 * which is the defect this file exists to close.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join, relative } from 'node:path';
import { MIGRATION_FILE_RE } from '../scripts/new-migration.js';
import { discoverModulePackages } from '../scripts/lib/module-packages.js';
import { platformSourceRootAt } from '../scripts/lib/platform-root.js';
import type { RegisteredMigration } from '../src/db/configured-migrations.js';
import type { MigrationOrigin } from '@endora-commerce/platform/db';
import { templateDigest, type TemplateInputs, type TemplateSource } from '@endora-commerce/test-kit/database';

/** `backend/`, the root every recorded path is relative to. */
const BACKEND_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** A place migration sources are read from, and who produced what is in it. */
export interface MigrationSourceRoot {
  /** Which producer's floor the files under this root count toward. */
  readonly origin: MigrationOrigin;
  /** `backend/`-relative, or absolute for a root outside this repository. */
  readonly path: string;
  /**
   * `directory` walks the path itself; `module-tree` walks
   * `<path>/<child>/migrations`; `package` walks every `migrations/` directory
   * anywhere under a module package, which is the same predicate
   * `generate-composer.ts`'s `PACKAGE_MIGRATION_RE` applies — a package's
   * internal layout is its own, so neither names `src/migrations`.
   */
  readonly kind: 'directory' | 'module-tree' | 'package';
  /**
   * The extension a producer publishes its migration sources with. `.ts` for
   * this repository; `.js` for an installed package, which ships compiled
   * output (D-06) and has no TypeScript source to read.
   *
   * The recognizer stays the one in `contracts/naming-convention.md` §1 — see
   * {@link isMigrationSource}. A second regex would be a second answer to
   * "what is a migration".
   */
  readonly sourceExtension?: '.ts' | '.js';
  /**
   * What the digest records in place of the on-disk path.
   *
   * Absent for a root inside this repository, whose `backend/`-relative path is
   * already stable across checkouts. **Required** for an installed package,
   * whose absolute path is a property of *the instance* — a tmpdir, a container
   * mount — so recording it would give the same package a different digest in
   * every instance and disable template reuse outright. `<name>@<version>` is
   * what goes in instead, which is also how the package's identity enters the
   * digest at all.
   */
  readonly recordAs?: string;
}

/**
 * Where **this repository's** migrations live — the roots
 * `scripts/generate-composer.ts` walks to emit
 * `src/db/migrations-registry.generated.ts`, so both are `core`.
 *
 * The `external` roots are not here and cannot be: an installed extension
 * package ships migrations (D-106.2) from a directory that exists only in the
 * instance that installed it, so that half is *discovered*, per run, by
 * {@link migrationSourceRoots}. This list used to say there could never be a
 * third root at all, citing the retired D-105 ("an overlay ships no
 * migration") — which D-106 narrowed and D-106.2 reversed.
 */
export const MIGRATION_SOURCE_ROOTS: readonly MigrationSourceRoot[] = [
  // The platform's own twelve, `backend/`-relative and **resolved** rather than
  // spelled: they were `src/db/migrations` until
  // `specs/110-instance-repository/` T116 moved them beside the `./migrations`
  // barrel that publishes them, and the platform is the one workspace member
  // declaring `endora.type: "platform"`. Still `core` — their classes are in
  // the committed registry and the committed registry configures them.
  { origin: 'core', path: platformMigrationsRoot(), kind: 'directory' },
  { origin: 'core', path: 'src/modules', kind: 'module-tree' },
  // A module this repository has already moved into a workspace package
  // (feature 080, T040b). Still `core`: its migrations are committed here and
  // the committed registry configures them, so they count toward core's floor —
  // the `external` origin is for a package *installed* into an instance, whose
  // sources this checkout does not contain. Derived rather than listed, because
  // there are 64 more moves to come and a list would be a fresh
  // `came up short by 1` each time.
  ...workspaceModulePackageRoots(),
];

/**
 * The platform's own `migrations/` directory, `backend/`-relative.
 *
 * A checkout with no platform member is a refusal rather than a root the walk
 * quietly drops: the twelve are the only migrations that create `settings`,
 * `module_registrations` and `sales_channels`, so a digest computed without
 * them would reuse a template built from a different schema.
 */
function platformMigrationsRoot(): string {
  const repoRoot = join(BACKEND_ROOT, '..');
  const platformRoot = platformSourceRootAt(repoRoot);
  if (platformRoot === null) {
    throw new Error(
      '[template-identity] no workspace member declares `endora.type: "platform"`, so the ' +
        "platform's own migrations have no root. A digest without them would reuse a " +
        'template built from a different schema.',
    );
  }
  return relative(BACKEND_ROOT, join(platformRoot, 'migrations'));
}

/**
 * One root per workspace module package, `backend/`-relative so the digest is
 * the same in every checkout.
 *
 * Read through `discoverModulePackages`, which answers from each member's own
 * `endora: { type: 'module', id }` block — the same declaration `lib/module-roots.ts`
 * and the composer read, so the harness and the generator cannot come to
 * disagree about which packages exist.
 */
function workspaceModulePackageRoots(): readonly MigrationSourceRoot[] {
  const repoRoot = join(BACKEND_ROOT, '..');
  return discoverModulePackages(repoRoot).map((pkg) => ({
    origin: 'core' as const,
    path: relative(BACKEND_ROOT, pkg.dir),
    kind: 'package' as const,
  }));
}

/**
 * Every root this run reads migration sources from: the core pair above, plus
 * one per installed extension package (feature 080, T033).
 *
 * A package contributes to the identity as **content**, not as a name: the
 * ordered class names are already in through `MIGRATION_NAMES`, and a changed
 * migration body under an unchanged class name is exactly what the digest
 * exists to separate (D-155.5). So the input is the files its `./migrations`
 * subpath resolves into, hashed, recorded under `<name>@<version>` rather than
 * under the instance's absolute path.
 *
 * A package that ships no migrations contributes no root and needs none: it
 * registers nothing, so its floor is zero and there is nothing to be short of.
 */
export async function migrationSourceRoots(
  packages: readonly {
    readonly packageName: string;
    readonly version: string;
    readonly migrationsDirectory: string | null;
  }[],
): Promise<readonly MigrationSourceRoot[]> {
  return [
    ...MIGRATION_SOURCE_ROOTS,
    ...packages
      .filter((contribution) => contribution.migrationsDirectory !== null)
      .map((contribution) => ({
        origin: 'external' as const,
        path: contribution.migrationsDirectory as string,
        kind: 'directory' as const,
        sourceExtension: '.js' as const,
        recordAs: `${contribution.packageName}@${contribution.version}`,
      })),
  ];
}

/**
 * Whether a filename is a migration's, under the extension its producer
 * publishes.
 *
 * §1 of the naming convention is the **only** recognizer any tool in this tree
 * may use, and it is written for `.ts`. A published package ships the compiled
 * twin of the same filename (D-06), so the answer is the same question asked of
 * the `.ts` name — never a second regex, which would be a second definition of
 * what a migration is.
 */
function isMigrationSource(name: string, extension: '.ts' | '.js'): boolean {
  if (!name.endsWith(extension)) return false;
  return MIGRATION_FILE_RE.test(`${name.slice(0, -extension.length)}.ts`);
}

/**
 * The files that seed a migrated template, beyond its migrations.
 *
 * Anything added here becomes part of the template's identity, so changing one
 * of these gives the next run a template of its own instead of a database
 * somebody else's branch seeded. A missing entry is a hard failure, not a
 * skipped input.
 */
export const TEMPLATE_SEED_SOURCES = [
  'test/template-seed.ts',
  'src/kernel/sales-channels/default-channel-reconciler.ts',
] as const;

/** One file read out of a migration root. */
interface WalkedSource {
  readonly origin: MigrationOrigin;
  readonly absolute: string;
  /**
   * What the digest records for this file: `backend/`-relative for a root in
   * this repository, `<name>@<version>/<inside the package>` for an installed
   * one. Never an absolute path — two checkouts, and two instances of one
   * package, must agree.
   */
  readonly recordedPath: string;
  /**
   * Whether the filename is a migration's, by the one recognizer every tool in
   * this tree uses — contracts/naming-convention.md §1, imported rather than
   * re-spelled so the harness and the generator cannot disagree about what a
   * migration is. §4 permits non-migration helpers beside them
   * (`quote_requests/migrations/status-mapping.ts` is the tree's one), and the
   * distinction is the point: a helper is **read** into the digest, because a
   * migration may import it, and it settles no origin's floor, because it is
   * not a migration. Excluding it by name, or by the count happening to work
   * out, would be two ways of deciding the same thing twice.
   */
  readonly migration: boolean;
}

async function walkSources(
  root: string,
  roots: readonly MigrationSourceRoot[],
): Promise<WalkedSource[]> {
  const found: WalkedSource[] = [];
  const walk = async (
    absolute: string,
    source: MigrationSourceRoot,
    recordRoot: string,
    recordPrefix: string,
  ): Promise<void> => {
    const extension = source.sourceExtension ?? '.ts';
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(absolute, entry.name);
      if (entry.isDirectory()) {
        await walk(child, source, recordRoot, recordPrefix);
      } else if (entry.name.endsWith(extension)) {
        found.push({
          origin: source.origin,
          absolute: child,
          recordedPath: join(recordPrefix, relative(recordRoot, child)),
          migration: isMigrationSource(entry.name, extension),
        });
      }
    }
  };
  for (const source of roots) {
    // An `external` root is absolute — it lives in the instance's
    // `node_modules`, not under `backend/` — and records itself under
    // `<name>@<version>` so the digest is a property of the package rather than
    // of where the instance happens to sit on disk.
    const external = isAbsolute(source.path);
    const absolute = external ? source.path : join(root, source.path);
    const recordRoot = external ? source.path : root;
    const recordPrefix = source.recordAs ?? '';
    if (external && source.recordAs === undefined) {
      throw new Error(
        `[test-setup] the migration source root "${source.path}" is outside this repository and ` +
          `declares no 'recordAs'. Its absolute path is a property of this instance, so ` +
          `recording it would give one package a different digest in every instance and no two ` +
          `runs would ever share a template.`,
      );
    }
    if (source.kind === 'package') {
      // Every `migrations/` directory the package holds, wherever it keeps it.
      // Walking the package whole would fold its services into the digest and
      // rebuild the template on any change to the module at all, which is the
      // same reason `module-tree` narrows to `migrations/`.
      for (const directory of await migrationDirectoriesUnder(absolute)) {
        await walk(directory, source, recordRoot, recordPrefix);
      }
    } else if (source.kind === 'module-tree') {
      // Only the modules' own `migrations/` directories — walking all of
      // `src/modules` would fold every module's source into the digest and
      // rebuild the template on any backend change.
      const children = await readdir(absolute, { withFileTypes: true }).catch(() => []);
      for (const child of children) {
        if (child.isDirectory())
          await walk(join(absolute, child.name, 'migrations'), source, recordRoot, recordPrefix);
      }
    } else {
      await walk(absolute, source, recordRoot, recordPrefix);
    }
  }
  return found.sort((a, b) => (a.recordedPath < b.recordedPath ? -1 : 1));
}

/**
 * Every directory named `migrations` under `dir`, skipping build output.
 *
 * `dist` is excluded because a package's compiled migrations are the same files
 * a second time: folding both into the digest would make the identity depend on
 * whether the package happened to be built, and the run reads the `.ts` the
 * committed registry was generated from.
 */
async function migrationDirectoriesUnder(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'dist' || entry.name === 'node_modules') continue;
    const child = join(dir, entry.name);
    if (entry.name === 'migrations') out.push(child);
    else await migrationDirectoriesUnder(child, out);
  }
  return out;
}

async function sha256Of(path: string, absolute: string): Promise<TemplateSource> {
  const content = await readFile(absolute);
  return {
    path,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

export interface TemplateIdentityOptions {
  /**
   * `backend/` unless a test points this at a fixture tree. The refusals below
   * are the reason it is here: a proof that a partial read is refused has to
   * enter above the read (issue #130), not below it.
   */
  readonly root?: string;
  /**
   * The configured order with each entry's origin; read from
   * `src/db/configured-migrations.ts` unless supplied.
   */
  readonly migrations?: readonly RegisteredMigration[];
  /** Where sources are read from; `MIGRATION_SOURCE_ROOTS` unless supplied. */
  readonly sourceRoots?: readonly MigrationSourceRoot[];
}

/** What one producer contributed, and what the walk found of it. */
export interface OriginPopulation {
  readonly origin: MigrationOrigin;
  /** Migrations the registry says this origin contributed. */
  readonly registered: number;
  /** Files under this origin's roots named like a migration. */
  readonly migrationFiles: number;
  /** Every file read from this origin's roots — its migrations and the helpers beside them. */
  readonly sourceFiles: number;
}

export interface TemplateIdentity extends TemplateInputs {
  readonly digest: string;
  /** For the log line: what was read, so a digest is never a number with no population behind it. */
  readonly migrationFiles: number;
  /** The same population, per producer — the floor below is applied to each on its own. */
  readonly origins: readonly OriginPopulation[];
}

/**
 * Reconciles the walk against the registry — **per origin, never as one total.**
 *
 * They are independent derivations of the same population, so a walk that came
 * back short is a digest over less than the template holds, and the whole point
 * of the digest is that it cannot be over less than the template holds.
 *
 * One comparison against one total is not that reconciliation, and this file
 * shipped one: the tree carries a file of slack (§4's helper), so a set short by
 * one migration cleared a floor of `files.length < migrations.length` and got a
 * digest computed over everything *except* the file that differed. Two platforms,
 * one digest, one template — issue #289, one layer out. A total can only be
 * short by the sum, so a producer whose files are unreadable is paid for out of
 * another producer's surplus; a per-origin floor has nowhere to take it from.
 */
function floorEachOrigin(
  populations: readonly OriginPopulation[],
  roots: readonly MigrationSourceRoot[],
): void {
  for (const population of populations) {
    if (population.migrationFiles >= population.registered) continue;
    const paths = roots
      .filter((root) => root.origin === population.origin)
      .map((root) => root.path);
    throw new Error(
      `[test-setup] the '${population.origin}' migration origin came up short by ` +
        `${population.registered - population.migrationFiles}: the registry configures ` +
        `${population.registered} migration(s) from it and the walk found ` +
        `${population.migrationFiles} file(s) named like one, under ` +
        `${paths.length > 0 ? paths.join(', ') : 'no source root at all'}. Refusing to identify ` +
        `a migration template from a partial read — the template would hold more than its ` +
        `digest says, which is issue #289. Each origin is floored on its own, so a surplus in ` +
        `another one cannot cover this: give '${population.origin}' a root in ` +
        `MIGRATION_SOURCE_ROOTS, or stop registering migrations this harness cannot read.`,
    );
  }
}

/**
 * This run's template identity.
 *
 * Imported dynamically and only on the provisioning path: a run that declared
 * `BACKEND_TEST_SERVICES=none` reads no files and computes no digest, because
 * it provisions nothing.
 */
export async function templateIdentity(
  options: TemplateIdentityOptions = {},
): Promise<TemplateIdentity> {
  const root = options.root ?? BACKEND_ROOT;
  // Imported here rather than at the top, as the order always was: a caller
  // that brought its own set never pays to build the platform's — and since
  // T033 building it means scanning `node_modules`, so the saving is real.
  const configured =
    options.migrations !== undefined && options.sourceRoots !== undefined
      ? undefined
      : await (await import('../src/db/configured-migrations.js')).configuredMigrations();
  const registered = options.migrations ?? configured?.registered ?? [];
  // The `external` roots come from the same answer the registrations did, so a
  // package cannot be registered by one and unread by the other.
  const roots =
    options.sourceRoots ?? (await migrationSourceRoots(configured?.packages ?? []));
  const walked = await walkSources(root, roots);

  // The origins are derived from the two inputs on every call rather than
  // listed here: an origin that registers a migration is floored whether or not
  // anything on disk claims to answer for it, which is exactly the case a
  // package creates before its root exists.
  const origins = [
    ...new Set([...registered.map((entry) => entry.origin), ...roots.map((entry) => entry.origin)]),
  ];
  const populations = origins.map((origin) => {
    const files = walked.filter((source) => source.origin === origin);
    return {
      origin,
      registered: registered.filter((entry) => entry.origin === origin).length,
      migrationFiles: files.filter((source) => source.migration).length,
      sourceFiles: files.length,
    };
  });
  floorEachOrigin(populations, roots);

  const sources = await Promise.all(walked.map((source) => sha256Of(source.recordedPath, source.absolute)));
  for (const declared of TEMPLATE_SEED_SOURCES) {
    const absolute = join(root, declared);
    try {
      sources.push(await sha256Of(declared, absolute));
    } catch (error) {
      throw new Error(
        `[test-setup] the declared template seed source "${declared}" could not be read ` +
          `(${(error as Error).message}). It is part of what a template holds, so a run cannot ` +
          `identify one without it — fix the path in test/template-identity.ts.`,
      );
    }
  }

  const inputs: TemplateInputs = { migrations: registered.map((entry) => entry.name), sources };
  return {
    ...inputs,
    digest: templateDigest(inputs),
    migrationFiles: walked.length,
    origins: populations,
  };
}
