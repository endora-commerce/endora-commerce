import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type FirstBootTestDb } from '../../helpers/test-db.js';
import { DefaultChannelReconciler } from '@endora-commerce/platform/composition';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * T021 — Boot-time idempotency for the default-channel reconciler (FR-002).
 *
 * The reconciler is the platform's single source of truth for the
 * `system_default` flag (research R-4). It runs from `composition.ts`
 * before HTTP comes up. Three distinct startup states + the idempotent
 * re-run case are exercised below.
 *
 * Every state starts from an **empty** `sales_channels` table, and the shared
 * database never has one — the platform guarantees a default channel
 * (D-47…D-51) and the files after this one rely on it. So the file runs on a
 * database of its own in first-boot state, `setupTestDb({ firstBoot })`, rather
 * than emptying the shared table and trusting a rollback to put it back
 * (issue #115).
 */
describe('boot-time default-channel reconciliation (T021)', () => {
  let db: FirstBootTestDb;

  beforeAll(async () => {
    db = await setupTestDb({ firstBoot: 'boot_default_channel' });
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
  });

  /** The first-boot precondition, asserted rather than arranged. */
  async function expectNoChannels(): Promise<void> {
    expect(await db.em().count(SalesChannel, {})).toBe(0);
  }

  it('inserts a fresh Default row when the table is empty', async () => {
    try {
      await expectNoChannels();
      const em = db.em();
      const reconciler = new DefaultChannelReconciler(() => em);

      const result = await reconciler.run();

      expect(result.action).toBe('inserted');
      const all = await em.find(SalesChannel, {});
      expect(all).toHaveLength(1);
      const row = all[0]!;
      expect(row.code).toBe('default');
      expect(row.systemDefault).toBe(true);
      expect(row.active).toBe(true);
      // Feature 154 (FR-003, A5) — the reconciler's default channel is open to
      // anonymous visitors, so a fresh shop answers its storefront as before.
      expect(row.anonymousAccess).toBe(true);
      expect(row.currencies).toContain('EUR');

      // Every language the inserted channel names must be a row of the
      // languages dictionary, or the channel is born unwritable: the admin
      // PATCH validates each listed code against that dictionary and answered
      // `409 DICTIONARY_ENTRY_NOT_FOUND` for the bare `en` this used to insert,
      // while the dictionary seeds `en-US`.
      expect(row.languages).toEqual(['en-US']);
      expect(row.defaultLanguage).toBe('en-US');
      const known = (await em.execute(
        'select "code" from "languages" where "code" in (?)',
        [row.languages],
      )) as Array<{ code: string }>;
      expect(known.map((r) => r.code)).toEqual(row.languages);
    } finally {
      await db.rollbackTx();
    }
  });

  it('promotes the lexically-first row when no system_default exists', async () => {
    try {
      await expectNoChannels();
      const em = db.em();
      // Two channels — neither system_default. `default` wins the tie-break.
      const a = em.create(SalesChannel, {
        code: 'serwis-a',
        name: { en: 'Serwis A' },
        defaultLanguage: 'pl',
        defaultCurrency: 'PLN',
        languages: ['pl'],
        currencies: ['PLN'],
        active: true,
        systemDefault: false,
        version: 1,
      });
      const def = em.create(SalesChannel, {
        code: 'default',
        name: { en: 'Default' },
        defaultLanguage: 'en',
        defaultCurrency: 'EUR',
        languages: ['en'],
        currencies: ['EUR'],
        active: true,
        systemDefault: false,
        version: 1,
      });
      await em.persistAndFlush([a, def]);

      const reconciler = new DefaultChannelReconciler(() => em);
      const result = await reconciler.run();

      expect(result.action).toBe('promoted');
      const promoted = await em.findOneOrFail(SalesChannel, { code: 'default' });
      expect(promoted.systemDefault).toBe(true);
      const other = await em.findOneOrFail(SalesChannel, { code: 'serwis-a' });
      expect(other.systemDefault).toBe(false);
    } finally {
      await db.rollbackTx();
    }
  });

  it('is a no-op when exactly one row already has system_default=true', async () => {
    try {
      await expectNoChannels();
      const em = db.em();
      const def = em.create(SalesChannel, {
        code: 'preexisting',
        name: { en: 'Pre-existing' },
        defaultLanguage: 'en',
        defaultCurrency: 'EUR',
        languages: ['en'],
        currencies: ['EUR'],
        active: true,
        systemDefault: true,
        version: 5,
      });
      await em.persistAndFlush(def);

      const reconciler = new DefaultChannelReconciler(() => em);
      const result = await reconciler.run();

      expect(result.action).toBe('no_change');
      const reloaded = await em.findOneOrFail(SalesChannel, { code: 'preexisting' });
      expect(reloaded.systemDefault).toBe(true);
      // Version unchanged on the no-op path.
      expect(reloaded.version).toBe(5);
    } finally {
      await db.rollbackTx();
    }
  });

  it('is idempotent when run twice in a row', async () => {
    try {
      await expectNoChannels();
      const em = db.em();
      const reconciler = new DefaultChannelReconciler(() => em);

      const first = await reconciler.run();
      expect(first.action).toBe('inserted');

      // Re-fork EM to simulate a fresh boot.
      const second = await reconciler.run();
      expect(second.action).toBe('no_change');

      const all = await em.find(SalesChannel, {});
      expect(all).toHaveLength(1);
    } finally {
      await db.rollbackTx();
    }
  });
});
