import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { Migration } from '@mikro-orm/migrations';
import { migrateUpVerified } from '@endora-commerce/platform/db';
import { configuredMigrations } from '../../../src/db/configured-migrations.js';
import {
  fixtureMigrations,
  openFixtureOrm,
  revertMigration,
  throwawayDatabase,
  type FixtureOptions,
  type ThrowawayDatabase,
} from '../../helpers/schema-extension-fixture.js';

/**
 * Issue #1860 (part of #1073). This pins, on MikroORM 6, what the migrator
 * writes into `mikro_orm_migrations`, and it must stay green after the move to
 * MikroORM 7.
 *
 * The platform treats a migration's identity as its **class name**:
 * `migration-order.ts` computes the order the list is handed over in, the
 * lifecycle orchestrator reverts by name, and `schema-extension-verifier.ts`
 * and the instance probe read names back. So `name` must be exactly `cls.name`,
 * with no extension, path or prefix, including for a package migration wrapped
 * by the foreign-schema guard. Rows must be written in the order the platform
 * handed over, not re-sorted by the migrator. A revert must remove exactly its
 * own row.
 *
 * Two halves. A throwaway database migrated through the platform's real
 * configuration path, where the configured order deliberately differs from name
 * order. And the run's own database, migrated by `global-setup.ts` with every
 * configured migration of this platform.
 */

/** A host migration stamped after the package's: per-module order runs it first anyway. */
class Migration20261110T000002FixtureHostSecond extends Migration {
  override async up(): Promise<void> {
    this.addSql('select 1');
  }

  override async down(): Promise<void> {
    this.addSql('select 1');
  }
}

/**
 * The declaring package's migration, `external` and so wrapped by the guard.
 * Stamped **before** every `fixture_host` migration. `acme_erp` depends on
 * `fixture_host`, so it runs after them, and its name sorts before theirs.
 */
class Migration20260101T000000AcmeErpEarly extends Migration {
  override async up(): Promise<void> {
    this.addSql('create table "acme_early" ("id" uuid primary key)');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "acme_early"');
  }
}

const OPTIONS: FixtureOptions = {
  hostMigrations: [Migration20261110T000002FixtureHostSecond],
  packageMigrations: [Migration20260101T000000AcmeErpEarly],
};

describe('migration names as the migrator records them (#1860)', () => {
  describe('on a throwaway database, through the platform configuration', () => {
    let db: ThrowawayDatabase;
    beforeEach(async () => {
      db = await throwawayDatabase('x1860names');
    });
    afterEach(async () => {
      await db.drop();
    });

    const recorded = async (): Promise<Array<{ name: string; executed_at: Date | null }>> =>
      db.query<{ name: string; executed_at: Date | null }>('select name, executed_at from mikro_orm_migrations order by id');

    it('records each class name, in the configured order, and a revert removes exactly its own row', async () => {
      const configured = fixtureMigrations([], OPTIONS);
      // The point of the fixture: the configured order is not name order.
      expect(configured).not.toEqual([...configured].sort());
      expect(configured.at(-1)).toBe('Migration20260101T000000AcmeErpEarly');

      const orm = await openFixtureOrm(db.url, [], OPTIONS);
      try {
        const applied = await migrateUpVerified(orm);
        expect(applied.map((migration) => migration.name)).toEqual(configured);

        const rows = await recorded();
        expect(rows.map((row) => row.name)).toEqual(configured);
        expect(rows.every((row) => row.executed_at !== null)).toBe(true);

        await revertMigration(orm, 'Migration20260101T000000AcmeErpEarly');
        expect((await recorded()).map((row) => row.name)).toEqual(configured.slice(0, -1));
        expect(await db.query(`select to_regclass('acme_early') as t`)).toEqual([{ t: null }]);
      } finally {
        await orm.close(true);
      }
    });
  });

  describe("on the run's database", () => {
    it('holds every configured migration under its class name, in the configured order', async () => {
      const { names } = await configuredMigrations();
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) expect(name).toMatch(/^Migration\d{8}T\d{6}[A-Za-z0-9]+$/);

      const client = new Client({ connectionString: process.env['DATABASE_URL'] });
      await client.connect();
      try {
        const rows = (await client.query<{ name: string }>('select name from mikro_orm_migrations order by id')).rows;
        expect(rows.map((row) => row.name)).toEqual([...names]);
      } finally {
        await client.end();
      }
    });
  });
});
