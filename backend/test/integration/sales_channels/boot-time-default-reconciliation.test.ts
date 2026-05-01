import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { DefaultChannelReconciler } from '../../../src/modules/sales_channels/services/default-channel-reconciler.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';

/**
 * T021 — Boot-time idempotency for the default-channel reconciler (FR-002).
 *
 * The reconciler is the platform's single source of truth for the
 * `system_default` flag (research R-4). It runs from `composition.ts`
 * before HTTP comes up. Three distinct startup states + the idempotent
 * re-run case are exercised below.
 */
describe('boot-time default-channel reconciliation (T021)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
  });

  async function clearChannels(): Promise<void> {
    const em = db.em();
    const all = await em.find(SalesChannel, {});
    for (const c of all) em.remove(c);
    await em.flush();
  }

  it('inserts a fresh Default row when the table is empty', async () => {
    try {
      await clearChannels();
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
      expect(row.languages).toContain('en');
      expect(row.currencies).toContain('EUR');
    } finally {
      await db.rollbackTx();
    }
  });

  it('promotes the lexically-first row when no system_default exists', async () => {
    try {
      await clearChannels();
      const em = db.em();
      // Two channels — neither system_default. `default` wins the tie-break.
      const a = em.create(SalesChannel, {
        code: 'serwis-a',
        name: { en: 'Serwis A' },
        defaultLanguage: 'pl',
        defaultCurrency: 'PLN',
        languages: ['pl'],
        currencies: ['PLN'],
        isPublic: true,
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
        isPublic: false,
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
      await clearChannels();
      const em = db.em();
      const def = em.create(SalesChannel, {
        code: 'preexisting',
        name: { en: 'Pre-existing' },
        defaultLanguage: 'en',
        defaultCurrency: 'EUR',
        languages: ['en'],
        currencies: ['EUR'],
        isPublic: false,
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
      await clearChannels();
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
