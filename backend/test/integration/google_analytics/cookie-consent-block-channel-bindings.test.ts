import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import {
  ensureCookieConsentBlock,
  COOKIE_CONSENT_BLOCK_CODE,
} from '../../../src/modules/google_analytics/services/cookie-consent-block-seeder.js';

/**
 * Feature 075 / D-87 — the seeder used to bind its block to every channel with
 * `select ?, sc.id, ? from sales_channels sc`, a raw reach into the kernel's
 * table. The channel ids now come from the kernel's `SalesChannel` entity and
 * the binding insert takes one ordinary binding per id.
 *
 * The seeder had no test of any kind, so the rewrite ships with the coverage
 * the statement always needed: every channel bound, nothing inserted twice, and
 * a channel created later picked up on the next boot.
 */
const CHANNEL_A = '3b1f0d2a-0000-4000-8000-0000000c0c01';
const CHANNEL_B = '3b1f0d2a-0000-4000-8000-0000000c0c02';

describe('ensureCookieConsentBlock — channel bindings (D-87 rewrite)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
    await db.orm.em.execute(
      `insert into sales_channels (id, code, name, default_language, default_currency, created_at, updated_at)
       values
         (?, 'ga-consent-a', '{"en-US":"A"}'::jsonb, 'en-US', 'USD', now(), now()),
         (?, 'ga-consent-b', '{"en-US":"B"}'::jsonb, 'en-US', 'USD', now(), now())
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

  async function boundChannelIds(): Promise<string[]> {
    const rows = (await db.em().execute(
      `select sales_channel_id::text as id
         from cms_block_sales_channels
        where code = ?
        order by sales_channel_id`,
      [COOKIE_CONSENT_BLOCK_CODE],
    )) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  it('binds the block to every channel, under the block code', async () => {
    await ensureCookieConsentBlock(() => db.em());
    const bound = await boundChannelIds();

    expect(bound).toContain(CHANNEL_A);
    expect(bound).toContain(CHANNEL_B);
    expect(bound).toContain(db.systemDefaultChannelId);
    // The binding points at the block the seeder inserted, not at whatever row
    // the first placeholder happened to carry.
    const rows = (await db.em().execute(
      `select b.code as block_code
         from cms_block_sales_channels x
         join cms_blocks b on b.id = x.block_id
        where x.code = ?`,
      [COOKIE_CONSENT_BLOCK_CODE],
    )) as Array<{ block_code: string }>;
    expect(rows.length).toBe(bound.length);
    expect(new Set(rows.map((r) => r.block_code))).toEqual(
      new Set([COOKIE_CONSENT_BLOCK_CODE]),
    );
  });

  it('is idempotent — a second run binds nothing new', async () => {
    await ensureCookieConsentBlock(() => db.em());
    const before = await boundChannelIds();
    await ensureCookieConsentBlock(() => db.em());

    expect(await boundChannelIds()).toEqual(before);
  });

  it('picks up a channel created after the first run', async () => {
    await ensureCookieConsentBlock(() => db.em());
    const lateChannel = '3b1f0d2a-0000-4000-8000-0000000c0c03';
    await db.em().execute(
      `insert into sales_channels (id, code, name, default_language, default_currency, created_at, updated_at)
       values (?, 'ga-consent-late', '{"en-US":"Late"}'::jsonb, 'en-US', 'USD', now(), now())`,
      [lateChannel],
    );

    await ensureCookieConsentBlock(() => db.em());

    expect(await boundChannelIds()).toContain(lateChannel);
  });
});
