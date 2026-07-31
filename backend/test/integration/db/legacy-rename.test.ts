import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MikroORM } from '@mikro-orm/postgresql';
import baseConfig from '../../../src/db/mikro-orm.config.js';
import { applyLegacyMigrationRenames } from '../../../src/db/legacy-migration-rename.js';
import {
  FROZEN_THROUGH,
  LEGACY_MIGRATION_RENAMES,
} from '../../../src/db/legacy-migration-names.js';
import { getMigrator } from '../../../src/db/migrator.js';

const MIGRATION_STAMP_RE = /^Migration(\d{8}T\d{6})/;

/**
 * Safety matrix for the legacy-name pre-flight — see
 * specs/065-manifest-aware-migrations/contracts/legacy-rename-map.md §3.2.
 *
 * The pre-flight is exercised against a dedicated bookkeeping table
 * (`mikro_orm_migrations_rename_test`) in the shared test database, so seeding
 * arbitrary executed-migration states can never disturb the real
 * `mikro_orm_migrations` table the suite's own schema depends on. The
 * pre-flight resolves its table from the ORM configuration, which is exactly
 * what makes this isolation possible.
 */

const TEST_TABLE = 'mikro_orm_migrations_rename_test';

let orm: MikroORM;
let connection: ReturnType<MikroORM['em']['getConnection']>;

async function dropTable(): Promise<void> {
  await connection.execute(`drop table if exists "public"."${TEST_TABLE}"`);
}

async function createTable(): Promise<void> {
  await dropTable();
  await connection.execute(
    `create table "public"."${TEST_TABLE}" (` +
      `"id" serial primary key, ` +
      `"name" varchar(255) not null, ` +
      `"executed_at" timestamptz not null default now())`,
  );
}

async function seed(names: readonly string[]): Promise<void> {
  for (const name of names) {
    await connection.execute(`insert into "public"."${TEST_TABLE}" ("name") values (?)`, [name]);
  }
}

async function storedNames(): Promise<string[]> {
  const rows = await connection.execute<{ name: string }[]>(
    `select "name" from "public"."${TEST_TABLE}" order by "id"`,
  );
  return rows.map((row) => row.name);
}

beforeAll(async () => {
  orm = await MikroORM.init({
    ...baseConfig,
    migrations: { ...baseConfig.migrations, tableName: TEST_TABLE },
  });
  connection = orm.em.getConnection();
});

afterAll(async () => {
  if (orm) {
    await dropTable();
    await orm.close(true);
  }
});

describe('applyLegacyMigrationRenames', () => {
  beforeEach(async () => {
    await dropTable();
  });

  it('is a no-op when the migrations table does not exist', async () => {
    const result = await applyLegacyMigrationRenames(orm);

    expect(result).toEqual({ renamed: 0, unknown: [], skipped: true });
  });

  it('renames nothing when the table is empty', async () => {
    await createTable();

    const result = await applyLegacyMigrationRenames(orm);

    expect(result.skipped).toBe(false);
    expect(result.renamed).toBe(0);
    expect(result.unknown).toEqual([]);
  });

  it('renames every row of a fully migrated legacy database', async () => {
    await createTable();
    await seed(LEGACY_MIGRATION_RENAMES.map((rename) => rename.legacyName));

    const result = await applyLegacyMigrationRenames(orm);

    expect(result.renamed).toBe(112);
    expect(result.unknown).toEqual([]);
    expect(await storedNames()).toEqual(LEGACY_MIGRATION_RENAMES.map((rename) => rename.name));

    // SC-001 — after the rename, none of the frozen (≤ FROZEN_THROUGH) migrations
    // are pending, so the 112 applied rows never re-run. Migrations stamped
    // after the freeze watermark (added post-cutover) may still be pending on a
    // DB that only ever applied the legacy set — that is expected.
    const migrator = await getMigrator(orm);
    const pending = await migrator.getPendingMigrations();
    const frozenPending = pending.filter((migration) => {
      const stamp = MIGRATION_STAMP_RE.exec(migration.name)?.[1];
      return stamp !== undefined && stamp <= FROZEN_THROUGH;
    });
    expect(frozenPending).toEqual([]);
  });

  it('is idempotent — a second run renames nothing and creates no duplicates', async () => {
    await createTable();
    await seed(LEGACY_MIGRATION_RENAMES.map((rename) => rename.legacyName));
    await applyLegacyMigrationRenames(orm);

    const second = await applyLegacyMigrationRenames(orm);

    expect(second.renamed).toBe(0);
    expect(second.unknown).toEqual([]);
    expect(await storedNames()).toHaveLength(112);
  });

  it('renames only the applied prefix of a partially migrated database', async () => {
    const cutoff =
      LEGACY_MIGRATION_RENAMES.findIndex(
        (rename) => rename.legacyName === 'Migration050CartsConsolidation',
      ) + 1;
    expect(cutoff).toBeGreaterThan(0);
    await createTable();
    await seed(LEGACY_MIGRATION_RENAMES.slice(0, cutoff).map((rename) => rename.legacyName));

    const result = await applyLegacyMigrationRenames(orm);

    expect(result.renamed).toBe(cutoff);
    expect(await storedNames()).toEqual(
      LEGACY_MIGRATION_RENAMES.slice(0, cutoff).map((rename) => rename.name),
    );
  });

  it('renames nothing when the rows already carry the new names', async () => {
    await createTable();
    await seed(LEGACY_MIGRATION_RENAMES.map((rename) => rename.name));

    const result = await applyLegacyMigrationRenames(orm);

    expect(result.renamed).toBe(0);
    expect(result.unknown).toEqual([]);
  });

  it('renames a row stored with a .ts suffix', async () => {
    await createTable();
    await seed(['Migration001FoundationInit.ts', 'Migration002QuoteRequestsInit.js']);

    const result = await applyLegacyMigrationRenames(orm);

    expect(result.renamed).toBe(2);
    expect(await storedNames()).toEqual([
      LEGACY_MIGRATION_RENAMES[0]!.name,
      LEGACY_MIGRATION_RENAMES[1]!.name,
    ]);
  });

  it('leaves an unrecognized row untouched and reports it', async () => {
    await createTable();
    await seed(['Migration001FoundationInit', 'MigrationXyzFromAbandonedBranch']);

    const result = await applyLegacyMigrationRenames(orm);

    expect(result.renamed).toBe(1);
    expect(result.unknown).toEqual(['MigrationXyzFromAbandonedBranch']);
    expect(await storedNames()).toEqual([
      LEGACY_MIGRATION_RENAMES[0]!.name,
      'MigrationXyzFromAbandonedBranch',
    ]);
  });

  it('does not duplicate a row when both the legacy and the new name are present', async () => {
    await createTable();
    await seed([LEGACY_MIGRATION_RENAMES[0]!.name, LEGACY_MIGRATION_RENAMES[0]!.legacyName]);

    const result = await applyLegacyMigrationRenames(orm);

    // The guard refuses to rewrite a legacy row whose new name already exists,
    // because `mikro_orm_migrations.name` has no unique index.
    expect(result.renamed).toBe(0);
    expect(await storedNames()).toEqual([
      LEGACY_MIGRATION_RENAMES[0]!.name,
      LEGACY_MIGRATION_RENAMES[0]!.legacyName,
    ]);
  });
});
