/**
 * Migration naming — the one implementation every scaffolder uses
 * (`specs/190-overlay-full-modules/` T100, FR-056, FR-057).
 *
 * The rules are `specs/065-manifest-aware-migrations/contracts/naming-convention.md`
 * §1, §2 and §6, as amended by
 * `specs/081-per-module-migration-order/contracts/migration-identity.md`. They
 * lived in this repository's `backend/scripts/new-migration.ts` until
 * `endora new migration` needed them in an instance, which holds no copy of that
 * script. An application may depend on a tool and a tool may not depend on an
 * application, so they moved here and the script imports them: three
 * scaffolders — `migration:new`, `endora new migration` and `endora new module
 * --entities` — and one answer to what a migration is called.
 *
 * Pure: nothing here reads a filesystem. Where a migration goes, and which
 * stamps are taken, is each host's own question.
 */

/**
 * The frozen historical prefix's watermark
 * (`@endora-commerce/platform/db`'s `BASELINE_THROUGH`).
 *
 * A migration stamped at or below it is ordered by history rather than by its
 * module's manifest `dependencies`, so every scaffolder clamps above it. This is
 * this package's copy of a fact the platform owns, and it is a copy because this
 * package depends on no part of the platform —
 * `backend/test/unit/packages/cli-migration-identity.test.ts` holds the two to
 * each other, so the copy cannot go stale in silence.
 */
export const BASELINE_THROUGH = '20260801T000000';

/** naming-convention.md §1 — the only recognizer any tool may use. */
export const MIGRATION_FILE_RE = /^(\d{8}T\d{6})_([a-z0-9_]+)\.ts$/;

/** The cross-cutting pseudo-module owning the platform's own `migrations/`. */
export const CORE_MODULE_ID = 'core';

/** naming-convention.md §1 — segment normalization. */
export function segmentFor(moduleId: string): string {
  return moduleId === CORE_MODULE_ID ? CORE_MODULE_ID : moduleId.replace(/^_/, '');
}

/** naming-convention.md §2 — `Migration<STAMP><PascalCaseTail>`, off the filename. */
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

/** `Add Index!` → `add_index`; an empty result is refused. */
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
 * Advances by whole seconds until the stamp is free in `taken`.
 *
 * Freedom is a tidiness rule, not an ordering one: a timestamp orders
 * migrations only within their own module, so two modules may legally share
 * one. `after` is a floor the result must strictly exceed — every caller passes
 * {@link BASELINE_THROUGH}, because a new migration landing inside the frozen
 * block would be ordered by history instead of by its module's `dependencies`.
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

export interface MigrationScaffoldInput {
  readonly moduleId: string;
  /** Normalised by {@link normalizeSlug}. */
  readonly slug: string;
  readonly stamp: string;
}

export interface MigrationScaffold {
  readonly moduleId: string;
  readonly stamp: string;
  readonly filename: string;
  readonly className: string;
  readonly contents: string;
}

/**
 * An empty migration: the named class extending `Migration` from
 * `@mikro-orm/migrations`, with empty `up()` / `down()`.
 *
 * `doc` is the class comment, one entry per line — what registering it takes
 * differs by host (a regeneration here, nothing in an instance), so the host
 * says it. The body is plain TypeScript an instance's overlay program accepts
 * under `erasableSyntaxOnly`.
 */
export function buildMigrationScaffold(
  input: MigrationScaffoldInput,
  doc: readonly string[],
): MigrationScaffold {
  const slug = normalizeSlug(input.slug);
  const filename = migrationFileName(input.stamp, input.moduleId, slug);
  const className = classNameFromFile(filename);
  const comment =
    doc.length === 0
      ? ''
      : `/**\n${doc.map((line) => (line === '' ? ' *' : ` * ${line}`)).join('\n')}\n */\n`;
  const contents =
    `import { Migration } from '@mikro-orm/migrations';\n` +
    `\n` +
    comment +
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
