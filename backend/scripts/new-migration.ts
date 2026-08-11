#!/usr/bin/env tsx
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UNCORRECTED_THROUGH } from '../src/db/migration-order.js';

/**
 * Scaffolds a migration file in its owning module's `migrations/` directory.
 *
 * Usage:
 *   pnpm --filter backend run migration:new -- --module orders --name placement_intents
 *
 * The naming and registration rules are specified once, in
 * specs/065-manifest-aware-migrations/contracts/naming-convention.md §1, §2
 * and §6. This script implements them and nothing else.
 *
 * It writes the file and **prints** the import line, the registry entry line
 * and the module group they belong in. It deliberately does not edit
 * `src/db/migrations-registry.ts`: text-munging a source file for a two-line
 * paste is fragile and can land in the wrong module block, and a forgotten
 * registration is already a CI failure via the round-trip guard in
 * test/unit/db/migrations-registry.test.ts.
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
 * Advances by whole seconds until the stamp is free anywhere in the tree.
 *
 * `after` is a floor the result must strictly exceed. The CLI passes
 * `UNCORRECTED_THROUGH`: everything at or before it is emitted in plain
 * chronological order and is never dependency-corrected, so a new migration
 * landing inside that block would silently opt out of the correction its
 * module's `dependencies` are supposed to buy it. Clamping here keeps every
 * new migration in the corrected region.
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
  /** The line to paste into the registry's import block. */
  importLine: string;
  /** The line to paste into the registry's entry array. */
  entryLine: string;
  /** The `// ── <id> ──` banner the two lines belong under. */
  groupBanner: string;
}

function bannerFor(moduleId: string): string {
  const prefix = `// ── ${moduleId} `;
  return `${prefix}${'─'.repeat(Math.max(3, 78 - prefix.length))}`;
}

export function buildScaffold(input: ScaffoldInput): Scaffold {
  const slug = normalizeSlug(input.slug);
  const filename = migrationFileName(input.stamp, input.moduleId, slug);
  const className = classNameFromFile(filename);
  const isCore = input.moduleId === CORE_MODULE_ID;
  const relativeDir = isCore ? 'src/db/migrations' : `src/modules/${input.moduleId}/migrations`;
  const importPath = isCore
    ? `./migrations/${filename.replace(/\.ts$/, '.js')}`
    : `../modules/${input.moduleId}/migrations/${filename.replace(/\.ts$/, '.js')}`;

  const contents =
    `import { Migration } from '@mikro-orm/migrations';\n` +
    `\n` +
    `/**\n` +
    ` * TODO describe the change this migration makes.\n` +
    ` *\n` +
    ` * Register it in src/db/migrations-registry.ts — an unregistered migration\n` +
    ` * does not run, and the round-trip guard fails the build for it.\n` +
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
    importLine: `import { ${className} } from '${importPath}';`,
    entryLine: `  migration('${input.moduleId}', ${className}),`,
    groupBanner: bannerFor(input.moduleId),
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
  const stamp = nextFreeStamp(new Date(), takenStamps(), UNCORRECTED_THROUGH);
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
      `Add these two lines to backend/src/db/migrations-registry.ts, under the\n` +
      `"${scaffold.moduleId}" group (chronological inside the group):\n` +
      `\n` +
      `  ${scaffold.importLine}\n` +
      `\n` +
      `  ${scaffold.groupBanner}\n` +
      `${scaffold.entryLine}\n` +
      `\n` +
      `An unregistered migration does not run — test/unit/db/migrations-registry.test.ts\n` +
      `fails the build for it. See docs/docs/architecture/migrations.md.\n`,
  );
}

// Only run when executed directly, so the pure helpers stay unit-testable.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
