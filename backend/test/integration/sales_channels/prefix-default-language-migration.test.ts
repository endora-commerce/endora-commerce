import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261029T152922CoreSalesChannelsPrefixDefaultLanguage } from '@endora-commerce/platform/migrations';
import { DefaultChannelReconciler } from '@endora-commerce/platform/composition';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupTestDb, type FirstBootTestDb } from '../../helpers/test-db.js';

/**
 * Feature 167 — `sales_channels.prefix_default_language`
 * (`specs/167-storefront-locale-path/data-model.md` M1; FR-001, FR-001a, OR-1, OR-10).
 *
 * Every channel that exists when the migration runs keeps its unprefixed
 * default-language URLs (`false`, OR-10); every channel created afterwards — by a
 * writer that does not name the column, or by the boot-time reconciler on a fresh
 * database — is prefixed (`true`, OR-1). Each case runs in a transaction that is rolled
 * back, so the database the other files share never sees the dropped column or the
 * probe rows. The statements come from the migration class.
 *
 * The file runs on a database of its own with no channel in it,
 * `setupTestDb({ firstBoot })`: the third case needs an empty table, and the first
 * counts every prefixed row in it, so on the shared database the one would
 * have to empty the platform's default channel and the other would be a claim
 * about every channel another file had left (issue #115).
 */
describe('sales_channels.prefix_default_language migration', () => {
  let db: FirstBootTestDb;

  beforeAll(async () => {
    db = await setupTestDb({ firstBoot: 'prefix_default_language' });
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
  });

  function migration(em: EntityManager): Migration20261029T152922CoreSalesChannelsPrefixDefaultLanguage {
    return new Migration20261029T152922CoreSalesChannelsPrefixDefaultLanguage(em.getDriver(), em.config);
  }

  async function up(em: EntityManager): Promise<void> {
    const m = migration(em);
    await m.up();
    for (const query of m.getQueries()) await em.execute(query as string);
  }

  async function down(em: EntityManager): Promise<void> {
    const m = migration(em);
    await m.down();
    for (const query of m.getQueries()) await em.execute(query as string);
  }

  async function rawInsert(em: EntityManager, code: string): Promise<void> {
    await em.execute(
      `insert into "sales_channels"
         ("id", "code", "name", "languages", "default_language", "currencies", "default_currency",
          "active", "anonymous_access", "system_default", "version", "status", "created_at", "updated_at")
       values (gen_random_uuid(), ?, '{"en-US":"Raw"}', '["en-US"]', 'en-US',
               '["PLN"]', 'PLN', true, true, false, 1, 'active', now(), now())`,
      [code],
    );
  }

  async function flagOf(em: EntityManager, code: string): Promise<boolean> {
    const rows = await em.execute<Array<{ prefix_default_language: boolean }>>(
      `select "prefix_default_language" from "sales_channels" where "code" = ?`,
      [code],
    );
    return rows[0]!.prefix_default_language;
  }

  async function columnShape(em: EntityManager): Promise<unknown[]> {
    return em.execute(
      `select data_type, is_nullable, column_default from information_schema.columns
        where table_name = 'sales_channels' and column_name = 'prefix_default_language'`,
    );
  }

  it('switches every pre-existing channel off and prefixes every later one (OR-10, OR-1)', async () => {
    try {
      const em = db.em();
      await down(em);
      await rawInsert(em, 'm167-before');
      await up(em);

      expect(await flagOf(em, 'm167-before')).toBe(false);
      const on = await em.execute<Array<{ n: string }>>(
        `select count(*)::text as n from "sales_channels" where "prefix_default_language" = true`,
      );
      expect(on[0]!.n).toBe('0');

      await rawInsert(em, 'm167-after');
      expect(await flagOf(em, 'm167-after')).toBe(true);
      expect(await columnShape(em)).toEqual([{ data_type: 'boolean', is_nullable: 'NO', column_default: 'true' }]);
    } finally {
      await db.rollbackTx();
    }
  });

  it('down() drops the column', async () => {
    try {
      const em = db.em();
      await down(em);
      expect(await columnShape(em)).toEqual([]);
    } finally {
      await db.rollbackTx();
    }
  });

  it('on an empty table the reconciler inserts a prefixed default channel', async () => {
    try {
      const em = db.em();
      expect(await em.count(SalesChannel, {})).toBe(0);
      await down(em);
      await up(em);

      const result = await new DefaultChannelReconciler(() => em).run();
      expect(result.action).toBe('inserted');
      const all = await em.find(SalesChannel, {});
      expect(all).toHaveLength(1);
      expect(all[0]!.prefixDefaultLanguage).toBe(true);
      expect(await flagOf(em, all[0]!.code)).toBe(true);
    } finally {
      await db.rollbackTx();
    }
  });
});
