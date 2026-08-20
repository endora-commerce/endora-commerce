#!/usr/bin/env tsx
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BASELINE_THROUGH } from '../src/db/migration-order.js';

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
 * tsx + node:fs/node:path only, no new dependency (Principle IV).
 */

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, '..');
const modulesRoot = resolve(backendRoot, 'src/modules');
const coreMigrationsDir = resolve(backendRoot, 'src/db/migrations');

/** contracts/naming-convention.md §1 — the only recognizer any tool may use. */
export const MIGRATION_FILE_RE = /^(\d{8}T\d{6})_([a-z0-9_]+)\.ts$/;

/** The cross-cutting pseudo-module owning src/db/migrations/. */
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
  /** Path relative to `backend/`. */
  relativePath: string;
  contents: string;
}

export function buildScaffold(input: ScaffoldInput): Scaffold {
  const slug = normalizeSlug(input.slug);
  const filename = migrationFileName(input.stamp, input.moduleId, slug);
  const className = classNameFromFile(filename);
  const isCore = input.moduleId === CORE_MODULE_ID;
  const relativeDir = isCore ? 'src/db/migrations' : `src/modules/${input.moduleId}/migrations`;

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

  return {
    moduleId: input.moduleId,
    stamp: input.stamp,
    filename,
    className,
    relativePath: `${relativeDir}/${filename}`,
    contents,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function listMigrationDirs(): string[] {
  const dirs = [coreMigrationsDir];
  if (existsSync(modulesRoot)) {
    for (const entry of readdirSync(modulesRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(join(modulesRoot, entry.name, 'migrations'));
    }
  }
  return dirs;
}

/** Every `<STAMP>` already used anywhere in the tree. */
function takenStamps(): Set<string> {
  const taken = new Set<string>();
  for (const dir of listMigrationDirs()) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const filename of readdirSync(dir)) {
      const match = MIGRATION_FILE_RE.exec(filename);
      if (match) taken.add(match[1]!);
    }
  }
  return taken;
}

function knownModuleIds(): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(modulesRoot)) return ids;
  for (const entry of readdirSync(modulesRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(modulesRoot, entry.name, 'manifest.ts'))) {
      ids.add(entry.name);
    }
  }
  return ids;
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

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.module || !args.name) {
    process.stderr.write(
      `usage: pnpm --filter backend run migration:new -- --module <id> --name <slug>\n`,
    );
    process.exit(64);
  }

  validateModuleId(args.module, knownModuleIds());
  const stamp = nextFreeStamp(new Date(), takenStamps(), BASELINE_THROUGH);
  const scaffold = buildScaffold({ moduleId: args.module, slug: args.name, stamp });

  const absolutePath = resolve(backendRoot, scaffold.relativePath);
  if (existsSync(absolutePath)) {
    process.stderr.write(`[migration:new] ${scaffold.relativePath} already exists\n`);
    process.exit(65);
  }
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, scaffold.contents, 'utf8');

  process.stdout.write(
    `[migration:new] wrote backend/${scaffold.relativePath}\n` +
      `\n` +
      `Register it by regenerating the committed registry, and commit both files:\n` +
      `\n` +
      `  pnpm --filter backend run composer:generate\n` +
      `\n` +
      `An unregistered migration does not run — test/unit/db/migrations-registry.test.ts\n` +
      `fails the build for it. See docs/docs/architecture/migrations.md.\n`,
  );
}

// Only run when executed directly, so the pure helpers stay unit-testable.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
