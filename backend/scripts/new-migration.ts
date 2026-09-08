#!/usr/bin/env tsx
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BASELINE_THROUGH } from '@endora-commerce/platform/db';
import {
  ModuleLayoutUnresolvableError,
  resolveModuleLayout,
  type ModuleTreeLayout,
} from './lib/module-roots.js';
import { packageRelativePathOf, type ModulePackage } from './lib/module-packages.js';
import { platformSourceRootAt, PlatformRootUnresolvableError } from './lib/platform-root.js';
import {
  collectMigrations,
  coreSources,
  modulePackages,
  packageSources,
} from './generate-composer.js';

/**
 * Scaffolds a migration file in its owning module's `migrations/` directory.
 *
 * Usage:
 *   pnpm --filter backend run migration:new -- --module orders --name placement_intents
 *
 * The naming and registration rules are specified in
 * specs/065-manifest-aware-migrations/contracts/naming-convention.md §1, §2
 * and §6, as amended by
 * specs/081-per-module-migration-order/contracts/migration-identity.md. This
 * script implements them and nothing else.
 *
 * It writes the file and stops there. Registration used to be two printed lines
 * to paste into a hand-maintained registry; since feature 071's F2 the registry
 * is emitted from a filesystem walk, so registering the new migration is
 * `pnpm --filter backend run composer:generate`. A forgotten regeneration is a
 * CI failure twice over: the round-trip guard in
 * test/unit/db/migrations-registry.test.ts and `overlay:check`.
 *
 * `mikro-orm migration:create` / `migration:generate` are not sanctioned —
 * they write into a single configured path and cannot know the owning module.
 *
 * ## Where a module lives is resolved, never spelled
 *
 * This file rooted every one of its three filesystem questions — which ids are
 * valid, which stamps are taken, and where the new file goes — at
 * `backend/src/modules`. `specs/080-f4-real-scope/` emptied that directory on
 * 2026-08-28, and each question then answered wrongly in its own way: every
 * registered id was rejected with `core` named as the only valid one, the
 * stamp-uniqueness walk saw the core block alone, and the output path it would
 * have produced for an accepted id named a directory the packaged module does
 * not read — a migration that never runs, which is the one failure the registry
 * exists to prevent.
 *
 * All three now come off `lib/module-roots.ts`, the derivation the static-check
 * estate already shares: the generated manifest index is located, and a
 * module's directory is either one under the application's source root or the
 * workspace member declaring `endora: { type: 'module', id }`. Nothing here
 * spells a module root, and `main` refuses a target the registry generator
 * would not pick up rather than writing a file nothing will run.
 *
 * No new dependency (Principle IV).
 */

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, '..');
const repoRoot = resolve(backendRoot, '..');

/**
 * Where a `core` migration lands — the platform's own `migrations/` directory
 * (`specs/110-instance-repository/` T116, FR-013).
 *
 * It was `backend/src/db/migrations` until the twelve moved. The path is
 * **resolved** rather than spelled: the platform is the one workspace member
 * declaring `endora.type: "platform"`, and its source root comes off that
 * declaration exactly as every module directory in this script does. A member
 * that is not there is a refusal — a scaffolder that fell back to the old path
 * would write a migration into a directory nothing walks, and an unregistered
 * migration does not run.
 */
function resolveCoreMigrationsDir(): string {
  const platformRoot = platformSourceRootAt(repoRoot);
  if (platformRoot === null) {
    throw new PlatformRootUnresolvableError(
      'no workspace member declares `endora.type: "platform"`, so a `core` migration has ' +
        'nowhere to land. The twelve cross-cutting migrations are the platform\'s own ' +
        '(`specs/110-instance-repository/` R7.5) and a thirteenth joins them.',
    );
  }
  return join(platformRoot, MIGRATIONS_DIRECTORY);
}

/** contracts/naming-convention.md §1 — the only recognizer any tool may use. */
export const MIGRATION_FILE_RE = /^(\d{8}T\d{6})_([a-z0-9_]+)\.ts$/;

/** The cross-cutting pseudo-module owning the platform's own `migrations/`. */
const CORE_MODULE_ID = 'core';

/** contracts/naming-convention.md §1 — segment normalization. */
export function segmentFor(moduleId: string): string {
  return moduleId === CORE_MODULE_ID ? CORE_MODULE_ID : moduleId.replace(/^_/, '');
}

/** contracts/naming-convention.md §2. */
export function classNameFromFile(filename: string): string {
  const match = MIGRATION_FILE_RE.exec(filename);
  if (!match) throw new Error(`Unexpected migration filename: ${filename}`);
  const [, stamp, tail] = match;
  const pascal = tail!
    .split('_')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
  return `Migration${stamp}${pascal}`;
}

export function validateModuleId(moduleId: string, knownIds: ReadonlySet<string>): void {
  if (moduleId === CORE_MODULE_ID || knownIds.has(moduleId)) return;
  const valid = [CORE_MODULE_ID, ...knownIds].sort().join(', ');
  throw new Error(
    `Unknown module id "${moduleId}". Valid ids are: ${valid}. ` +
      `If the module is new, add its manifest.ts and run ` +
      `\`pnpm --filter backend run manifest-index:generate\`.`,
  );
}

export function normalizeSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  if (slug.length === 0) {
    throw new Error(`--name "${name}" produces an empty slug; use snake_case letters and digits.`);
  }
  return slug;
}

/** `YYYYMMDDTHHmmss`, UTC, fixed width, literal `T` at index 8. */
export function formatStamp(date: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

/** Inverse of {@link formatStamp}. */
export function parseStamp(stamp: string): Date {
  return new Date(
    Date.UTC(
      Number(stamp.slice(0, 4)),
      Number(stamp.slice(4, 6)) - 1,
      Number(stamp.slice(6, 8)),
      Number(stamp.slice(9, 11)),
      Number(stamp.slice(11, 13)),
      Number(stamp.slice(13, 15)),
    ),
  );
}

/**
 * Advances by whole seconds until the stamp is free anywhere in the core tree.
 *
 * Tree-wide freedom is a tidiness rule, not an ordering one: a timestamp
 * orders migrations only within their own module, so two modules may legally
 * share one. Keeping core stamps distinct just keeps the committed registry
 * readable.
 *
 * `after` is a floor the result must strictly exceed. The CLI passes
 * `BASELINE_THROUGH`: everything the core registry contributed at or before it
 * is the frozen historical prefix, whose order is history and is never
 * recomputed. A new migration landing inside that block would be ordered by
 * that history instead of by its module's `dependencies`, so the clamp keeps
 * every new core migration in the open block.
 */
export function nextFreeStamp(from: Date, taken: ReadonlySet<string>, after?: string): string {
  const cursor = new Date(from.getTime());
  cursor.setUTCMilliseconds(0);
  if (after !== undefined) {
    const floor = parseStamp(after).getTime();
    if (cursor.getTime() <= floor) cursor.setTime(floor + 1_000);
  }
  let stamp = formatStamp(cursor);
  while (taken.has(stamp)) {
    cursor.setUTCSeconds(cursor.getUTCSeconds() + 1);
    stamp = formatStamp(cursor);
  }
  return stamp;
}

/**
 * `<STAMP>_<SEGMENT>_<SLUG>.ts`. The segment is not repeated when the slug
 * already opens with it — that is what keeps `quote_requests_init` from
 * becoming `quote_requests_quote_requests_init`.
 */
export function migrationFileName(stamp: string, moduleId: string, slug: string): string {
  const segment = segmentFor(moduleId);
  const tail = slug === segment || slug.startsWith(`${segment}_`) ? slug : `${segment}_${slug}`;
  return `${stamp}_${tail}.ts`;
}

export interface ScaffoldInput {
  moduleId: string;
  slug: string;
  stamp: string;
}

export interface Scaffold {
  moduleId: string;
  stamp: string;
  filename: string;
  className: string;
  contents: string;
}

export function buildScaffold(input: ScaffoldInput): Scaffold {
  const slug = normalizeSlug(input.slug);
  const filename = migrationFileName(input.stamp, input.moduleId, slug);
  const className = classNameFromFile(filename);

  const contents =
    `import { Migration } from '@mikro-orm/migrations';\n` +
    `\n` +
    `/**\n` +
    ` * TODO describe the change this migration makes.\n` +
    ` *\n` +
    ` * Registration is a regeneration: run\n` +
    ` * \`pnpm --filter backend run composer:generate\` and commit the result. An\n` +
    ` * unregistered migration does not run, and the round-trip guard fails the\n` +
    ` * build for it.\n` +
    ` *\n` +
    ` * This stamp orders this migration against its own module's migrations and\n` +
    ` * against nothing else. What puts it after another module's table is that\n` +
    ` * module appearing in this one's manifest \`dependencies\` — declare it if\n` +
    ` * this migration references a table it owns.\n` +
    ` */\n` +
    `export class ${className} extends Migration {\n` +
    `  override async up(): Promise<void> {\n` +
    `    // this.addSql(\`…\`);\n` +
    `  }\n` +
    `\n` +
    `  override async down(): Promise<void> {\n` +
    `    // this.addSql(\`…\`);\n` +
    `  }\n` +
    `}\n`;

  return { moduleId: input.moduleId, stamp: input.stamp, filename, className, contents };
}

// ---------------------------------------------------------------------------
// Where the file goes
// ---------------------------------------------------------------------------

/** The directory every module keeps its own migrations in. */
const MIGRATIONS_DIRECTORY = 'migrations';

/**
 * The **source** file a package's `exports` target names, package-relative.
 *
 * `emittedPathOf`'s inverse, and it exists because a package's published
 * targets name its build output (D-164) while a scaffolder writes source. The
 * two are related by the package's own `tsconfig.build.json`, which
 * `ModulePackage.emit` already carries; a package that declares no build
 * publishes its sources where they are, and then the target *is* the source.
 */
function sourcePathOfTarget(pkg: ModulePackage, target: string): string {
  const published = target.replace(/^\.\//, '');
  if (pkg.emit === null) return published;
  const prefix = pkg.emit.outDir === '' ? '' : `${pkg.emit.outDir}/`;
  const within = published.startsWith(prefix) ? published.slice(prefix.length) : published;
  const source = within.replace(/\.[cm]?js$/, '.ts');
  return pkg.emit.rootDir === '' ? source : `${pkg.emit.rootDir}/${source}`;
}

/**
 * Where inside a package its migrations live — read off the package, not spelled.
 *
 * The `./migrations` subpath points at the barrel that sits in that directory,
 * so for a package that already ships migrations the answer is its own
 * declaration mapped back to source. A package that ships none yet publishes no
 * such subpath, and then the answer is the layer its **root** export sits in —
 * `module-package-layout.md` §1 puts every published layer under one directory,
 * and the manifest is the one export every module package has.
 */
function packageMigrationsDirectory(pkg: ModulePackage): string {
  const declared = pkg.exports.get(`./${MIGRATIONS_DIRECTORY}`);
  if (declared !== undefined) return join(pkg.dir, dirname(sourcePathOfTarget(pkg, declared)));
  const root = pkg.exports.get('.');
  if (root === undefined) {
    throw new Error(
      `${pkg.name} declares neither a './${MIGRATIONS_DIRECTORY}' subpath nor a root export, ` +
        `so nothing in it says which directory its published layers sit in. Render its ` +
        `manifest with \`pnpm --filter backend run manifests:generate\` first.`,
    );
  }
  return join(pkg.dir, dirname(sourcePathOfTarget(pkg, root)), MIGRATIONS_DIRECTORY);
}

export interface MigrationTarget {
  readonly moduleId: string;
  /** Absolute directory the migration file lands in. */
  readonly directory: string;
  /** The package that owns it, or `null` for core and the application's own tree. */
  readonly owner: ModulePackage | null;
}

/**
 * Where this module's migrations live — resolved from the module layout.
 *
 * Three shapes, and the module never has to say which it is in: `core` owns the
 * platform's own `migrations/`; a workspace **package** keeps its migrations
 * where its own `exports` map says (see {@link packageMigrationsDirectory});
 * anything else is a module directory under the application's source root, with
 * `migrations/` beside its `manifest.ts`.
 *
 * The package branch is decided by the package list rather than by
 * {@link ModuleTreeLayout.moduleDirectoryOf}'s answer alone, because that
 * answer is the member directory and the layer under it is the package's own
 * business (`module-package-layout.md` §1) — which is exactly the distinction
 * the layout's doc comment declines to make for `backend.ts` and for the same
 * reason.
 */
export function migrationTargetFor(
  moduleId: string,
  layout: ModuleTreeLayout,
  packages: readonly ModulePackage[],
  coreDirectory: string = resolveCoreMigrationsDir(),
): MigrationTarget {
  if (moduleId === CORE_MODULE_ID) {
    return { moduleId, directory: coreDirectory, owner: null };
  }
  const owner = packages.find((pkg) => pkg.moduleId === moduleId) ?? null;
  if (owner !== null) {
    return { moduleId, directory: packageMigrationsDirectory(owner), owner };
  }
  const moduleDirectory = layout.moduleDirectoryOf(moduleId);
  if (moduleDirectory === null) {
    throw new Error(
      `Module "${moduleId}" is registered in ${layout.manifestIndexPath} and no directory ` +
        `holds its sources. A migration has to land beside the module that owns it, so there ` +
        `is nowhere to write this one.`,
    );
  }
  return { moduleId, directory: join(moduleDirectory, MIGRATIONS_DIRECTORY), owner: null };
}

/**
 * Refuses a target the registry generator would not pick up.
 *
 * A scaffolder that writes where nothing reads is worse than one that refuses:
 * `collectMigrations` skips a `.ts` it does not recognise as a migration of a
 * module, so the file compiles, sits in the diff, reaches no registry and never
 * runs — D-149's *"a migration goes missing without a word"*, arriving through
 * the tool the checklist tells every author to use.
 *
 * The verdict is the generator's own, asked of a synthetic one-file source tree
 * keyed the way its walk keys the real one, so there is no second recognizer
 * here to drift from it. `_lifecycle` is what makes this reachable today: it is
 * a registered module whose sources the host owns, its directory is under the
 * platform package rather than under a module root, and a migration written
 * there matches neither the core nor the module nor the package shape.
 */
export function refuseUnregisterableTarget(
  target: MigrationTarget,
  absolutePath: string,
  scaffold: Scaffold,
  walkRoots: readonly string[],
): void {
  const collected = ((): ReturnType<typeof collectMigrations> => {
    if (target.owner !== null) {
      const key = packageRelativePathOf(target.owner, absolutePath);
      return collectMigrations(packageSources(target.owner, { [key]: scaffold.contents }));
    }
    // The application's own tree is walked from its source root and the
    // platform's from the platform root, each with no prefix, so a file under
    // neither has no key the generator's walk could ever produce.
    const root = walkRoots.find((candidate) => {
      const within = relative(candidate, absolutePath);
      return within !== '' && !within.startsWith('..') && !within.startsWith(sep);
    });
    if (root === undefined) return [];
    const key = relative(root, absolutePath).split(sep).join('/');
    return collectMigrations(coreSources({ [key]: scaffold.contents }));
  })();

  if (collected.length === 1 && collected[0]!.moduleId === target.moduleId) return;
  throw new Error(
    `${absolutePath} is where module "${target.moduleId}" keeps its sources, and a migration ` +
      `written there is registered by nothing: \`composer:generate\` does not recognise it, ` +
      `so it would never run and nothing would say so. Own the table from a module whose ` +
      `migrations the registry reads — \`--module core\` for schema the platform itself owns ` +
      `— and read it from here through that module's port.`,
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Every directory the stamp walk reads — core's, plus each registered module's.
 *
 * The same resolution the output path uses, so the two cannot come to disagree
 * about where a module keeps its migrations. It listed one directory while the
 * tree held fifty-seven before this: the walk was rooted at
 * `backend/src/modules`, which the F4 packaging sweep emptied, so a scaffolded
 * stamp was checked against the twelve core migrations and nothing else.
 */
export function listMigrationDirs(
  layout: ModuleTreeLayout,
  packages: readonly ModulePackage[],
): string[] {
  const dirs = [resolveCoreMigrationsDir()];
  for (const id of layout.registeredIds) {
    dirs.push(migrationTargetFor(id, layout, packages).directory);
  }
  return dirs;
}

/** Every `<STAMP>` already used anywhere in the tree. */
export function takenStamps(layout: ModuleTreeLayout, packages: readonly ModulePackage[]): Set<string> {
  const taken = new Set<string>();
  for (const dir of listMigrationDirs(layout, packages)) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const filename of readdirSync(dir)) {
      const match = MIGRATION_FILE_RE.exec(filename);
      if (match) taken.add(match[1]!);
    }
  }
  return taken;
}

function parseArgs(argv: readonly string[]): { module?: string; name?: string } {
  const parsed: { module?: string; name?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) continue;
    if (flag === '--module' || flag === '-m') parsed.module = value;
    if (flag === '--name' || flag === '-n') parsed.name = value;
  }
  return parsed;
}

/**
 * What the author has to do next, for the module this migration landed in.
 *
 * Derived rather than fixed, because the answer differs by where the file went.
 * `composer:generate` is enough for core; a module **package** registers its
 * classes through the `./migrations` barrel the emitted registry imports them
 * by name from, and a package that had no migrations until now publishes no
 * such subpath yet.
 */
function followUp(target: MigrationTarget, scaffold: Scaffold, repoRoot: string): string {
  const steps = [`  pnpm --filter backend run composer:generate`];
  if (target.owner === null) return steps.join('\n');

  const barrel = relative(repoRoot, join(target.directory, 'index.ts')).split(sep).join('/');
  const lines = [
    `Add ${scaffold.className} to ${barrel} — to the \`migrations\``,
    `array and to the named exports. The emitted registry imports it by name from`,
    `'${target.owner.name}/migrations', and the platform reads that array when`,
    `the module is installed.`,
    ``,
  ];
  if (![...target.owner.exports.keys()].includes('./migrations')) {
    lines.push(
      `${target.owner.name} publishes no './migrations' subpath yet, so render its`,
      `manifest and refresh the lockfile in the same commit:`,
      ``,
    );
    steps.unshift(
      `  pnpm --filter backend run manifests:generate`,
      `  pnpm install --lockfile-only`,
    );
  }
  return [...lines, ...steps].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.module || !args.name) {
    process.stderr.write(
      `usage: pnpm --filter backend run migration:new -- --module <id> --name <slug>\n`,
    );
    process.exit(64);
  }

  const layout = await resolveModuleLayout();
  const packages = modulePackages();
  validateModuleId(args.module, new Set(layout.registeredIds));

  const target = migrationTargetFor(args.module, layout, packages);
  const stamp = nextFreeStamp(new Date(), takenStamps(layout, packages), BASELINE_THROUGH);
  const scaffold = buildScaffold({ moduleId: args.module, slug: args.name, stamp });
  const absolutePath = join(target.directory, scaffold.filename);
  refuseUnregisterableTarget(target, absolutePath, scaffold, [
    layout.srcRoot,
    ...(layout.platformRoot === null ? [] : [layout.platformRoot]),
  ]);

  const display = relative(layout.repoRoot, absolutePath).split(sep).join('/');
  if (existsSync(absolutePath)) {
    process.stderr.write(`[migration:new] ${display} already exists\n`);
    process.exit(65);
  }
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, scaffold.contents, 'utf8');

  process.stdout.write(
    `[migration:new] wrote ${display}\n` +
      `\n` +
      `Register it, and commit every file the step below writes:\n` +
      `\n` +
      `${followUp(target, scaffold, layout.repoRoot)}\n` +
      `\n` +
      `An unregistered migration does not run — test/unit/db/migrations-registry.test.ts\n` +
      `fails the build for it. See docs/docs/architecture/migrations.md.\n`,
  );
}

// Only run when executed directly, so the pure helpers stay unit-testable.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    // A layout that will not resolve is "nothing was read", which is exit 2 for
    // the same reason it is throughout the check estate: the answer this tool
    // would otherwise give is a module list it never looked for.
    const unresolvable = error instanceof ModuleLayoutUnresolvableError;
    process.stderr.write(
      `[migration:new] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(unresolvable ? 2 : 65);
  });
}
