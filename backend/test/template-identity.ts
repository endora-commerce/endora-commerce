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
import { join, relative } from 'node:path';
import { MIGRATION_FILE_RE } from '../scripts/new-migration.js';
import type { RegisteredMigration } from '../src/db/configured-migrations.js';
import type { MigrationOrigin } from '../src/db/migration-order.js';
import { templateDigest, type TemplateInputs, type TemplateSource } from './run-isolation.js';

/** `backend/`, the root every recorded path is relative to. */
const BACKEND_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** A place migration sources are read from, and who produced what is in it. */
export interface MigrationSourceRoot {
  /** Which producer's floor the files under this root count toward. */
  readonly origin: MigrationOrigin;
  /** `backend/`-relative. */
  readonly path: string;
  /** `directory` walks the path itself; `module-tree` walks `<path>/<child>/migrations`. */
  readonly kind: 'directory' | 'module-tree';
}

/**
 * Where migrations live — every root, with the origin that owns it.
 *
 * Both are the roots `scripts/generate-composer.ts` walks to emit
 * `src/db/migrations-registry.generated.ts`, so both are `core`. There is no
 * `external` root **yet**: an extension package may ship entities and
 * migrations (D-106.2), and the mechanism that discovers them is Wave 3 of
 * `specs/080-f4-real-scope/tasks.md`, so today no file on disk belongs to that
 * origin. That is a fact about this month, not a rule — this list used to cite
 * the retired D-105 ("an overlay ships no migration") as the reason there could
 * never be a third root, which D-106 narrowed and D-106.2 reversed.
 *
 * Until that root exists, the per-origin floor below is what stands in for it:
 * a package migration that reaches the registry with no root to be read from
 * stops the run by name, instead of being digested around.
 */
export const MIGRATION_SOURCE_ROOTS: readonly MigrationSourceRoot[] = [
  { origin: 'core', path: 'src/db/migrations', kind: 'directory' },
  { origin: 'core', path: 'src/modules', kind: 'module-tree' },
];

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
  const walk = async (absolute: string, origin: MigrationOrigin): Promise<void> => {
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(absolute, entry.name);
      if (entry.isDirectory()) {
        await walk(child, origin);
      } else if (entry.name.endsWith('.ts')) {
        found.push({ origin, absolute: child, migration: MIGRATION_FILE_RE.test(entry.name) });
      }
    }
  };
  for (const source of roots) {
    const absolute = join(root, source.path);
    if (source.kind === 'module-tree') {
      // Only the modules' own `migrations/` directories — walking all of
      // `src/modules` would fold every module's source into the digest and
      // rebuild the template on any backend change.
      const children = await readdir(absolute, { withFileTypes: true }).catch(() => []);
      for (const child of children) {
        if (child.isDirectory())
          await walk(join(absolute, child.name, 'migrations'), source.origin);
      }
    } else {
      await walk(absolute, source.origin);
    }
  }
  return found.sort((a, b) => (a.absolute < b.absolute ? -1 : 1));
}

async function sha256Of(root: string, absolute: string): Promise<TemplateSource> {
  const content = await readFile(absolute);
  return {
    path: relative(root, absolute),
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
  // that brought its own set never pays to build the platform's.
  const registered =
    options.migrations ??
    (await import('../src/db/configured-migrations.js')).REGISTERED_MIGRATIONS;
  const roots = options.sourceRoots ?? MIGRATION_SOURCE_ROOTS;
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

  const sources = await Promise.all(walked.map((source) => sha256Of(root, source.absolute)));
  for (const declared of TEMPLATE_SEED_SOURCES) {
    const absolute = join(root, declared);
    try {
      sources.push(await sha256Of(root, absolute));
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
