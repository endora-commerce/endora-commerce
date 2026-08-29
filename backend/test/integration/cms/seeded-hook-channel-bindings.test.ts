import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { reconcileSeededHooks } from '../../../../packages/modules/cms/src/backend/services/seed-hooks.js';

/**
 * Feature 075 / D-87 — `reconcileSeededHooks` used to bind its system hooks to
 * every channel with `cross join "sales_channels"`, a raw reach into the
 * kernel's table. The channel ids now come from the kernel's `SalesChannel`
 * entity and the binding insert takes one ordinary binding per id.
 *
 * The rewrite is the reason this file exists: the binding half of the
 * reconciler had no direct coverage at all — `test/unit/cms/seed-hooks-reconciler.test.ts`
 * pins the static code list and nothing else, and the migration test only
 * asserts that running the migration twice does not duplicate rows. A wrong
 * placeholder order or a dropped `not exists` guard would have been invisible.
 */
const CHANNEL_A = '3b1f0d2a-0000-4000-8000-00000000ca01';
const CHANNEL_B = '3b1f0d2a-0000-4000-8000-00000000ca02';

describe('reconcileSeededHooks — channel bindings (D-87 rewrite)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
    await db.orm.em.execute(
      `insert into sales_channels (id, code, name, default_language, default_currency, created_at, updated_at)
       values
         (?, 'seed-hooks-a', '{"en-US":"A"}'::jsonb, 'en-US', 'USD', now(), now()),
         (?, 'seed-hooks-b', '{"en-US":"B"}'::jsonb, 'en-US', 'USD', now(), now())
       on conflict (id) do nothing`,
      [CHANNEL_A, CHANNEL_B],
    );
  });

  afterAll(async () => {
    await db.orm.em.execute(`delete from sales_channels where id in (?, ?)`, [
      CHANNEL_A,
      CHANNEL_B,
    ]);
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  async function bindingCountsByChannel(): Promise<Map<string, number>> {
    const rows = (await db.em().execute(
      `select x.sales_channel_id::text as channel_id, count(*)::int as bindings
         from cms_hook_sales_channels x
         join cms_hooks h on h.id = x.hook_id
        where h.is_system = true
        group by x.sales_channel_id`,
    )) as Array<{ channel_id: string; bindings: number }>;
    return new Map(rows.map((r) => [r.channel_id, r.bindings]));
  }

  it('binds every system hook to every channel', async () => {
    const result = await reconcileSeededHooks(() => db.em());
    const counts = await bindingCountsByChannel();
    const systemHooks = result.inserted + result.preservedExisting;

    expect(systemHooks).toBeGreaterThan(0);
    expect(counts.get(CHANNEL_A)).toBe(systemHooks);
    expect(counts.get(CHANNEL_B)).toBe(systemHooks);
    // The binding really is per (hook, channel) and not a row that landed on
    // one channel with another channel's id — a placeholder-order defect the
    // `count(*)` above would otherwise report as correct.
    expect(counts.get(db.systemDefaultChannelId)).toBe(systemHooks);
  });

  it('is idempotent — a second run inserts no binding', async () => {
    await reconcileSeededHooks(() => db.em());
    const before = await bindingCountsByChannel();
    await reconcileSeededHooks(() => db.em());
    const after = await bindingCountsByChannel();

    expect([...after.entries()].sort()).toEqual([...before.entries()].sort());
  });

  it('picks up a channel created after the first run', async () => {
    await reconcileSeededHooks(() => db.em());
    const lateChannel = '3b1f0d2a-0000-4000-8000-00000000ca03';
    await db.em().execute(
      `insert into sales_channels (id, code, name, default_language, default_currency, created_at, updated_at)
       values (?, 'seed-hooks-late', '{"en-US":"Late"}'::jsonb, 'en-US', 'USD', now(), now())`,
      [lateChannel],
    );

    await reconcileSeededHooks(() => db.em());

    const counts = await bindingCountsByChannel();
    expect(counts.get(lateChannel)).toBe(counts.get(CHANNEL_A));
  });
});
