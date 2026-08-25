import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { CmsBlockSeedService } from '../../../../packages/modules/cms/src/backend/services/cms-block-seed-port.js';
import {
  ensureNewsletterConsentBlock,
  NEWSLETTER_CONSENT_BLOCK_CODE,
} from '../../../../packages/modules/newsletter/src/backend/services/consent-block-seeder.js';

/**
 * Feature 075 / D-87 — the seeder used to bind its block to every channel with
 * `select ?, sc.id, ? from sales_channels sc`, a raw reach into the kernel's
 * table, and to insert the block itself with SQL naming `cms`' two tables. The
 * channel ids come from the kernel's `SalesChannel` entity, and the writing has
 * moved behind `cmsBlockSeedPort`, which `cms` owns.
 *
 * The end-to-end path is what this file exercises, and it is why the real
 * `CmsBlockSeedService` stands in for the port rather than a double: every
 * channel bound, nothing inserted twice, and a channel created later picked up
 * on the next boot are claims about the SQL, not about the seam. The off state
 * is proven at the unit level, in `test/unit/newsletter/consent-block-seeder.ts`.
 */
const CHANNEL_A = '3b1f0d2a-0000-4000-8000-0000000b1c01';
const CHANNEL_B = '3b1f0d2a-0000-4000-8000-0000000b1c02';

describe('ensureNewsletterConsentBlock — channel bindings (D-87 rewrite)', () => {
  let db: TestDb;
  // Whatever this fork's presence happens to be, so restoring it leaves the
  // shared singleton as this file found it (the pattern
  // `test/contract/kernel/port-fail-closed.test.ts` uses). The loaded flag is
  // restored too: "unloaded" is a state of its own — an unloaded read is an
  // error rather than an empty answer — and handing the next file a loaded
  // empty set instead would be a quieter lie than the one it replaces.
  let seededPresence: readonly string[] = [];
  let presenceWasLoaded = false;

  beforeAll(async () => {
    db = await setupTestDb();
    presenceWasLoaded = registryCache.isLoaded();
    seededPresence = presenceWasLoaded ? registryCache.enabledIds() : [];
    await db.orm.em.execute(
      `insert into sales_channels (id, code, name, default_language, default_currency, created_at, updated_at)
       values
         (?, 'nl-consent-a', '{"en-US":"A"}'::jsonb, 'en-US', 'USD', now(), now()),
         (?, 'nl-consent-b', '{"en-US":"B"}'::jsonb, 'en-US', 'USD', now(), now())
       on conflict (id) do nothing`,
      [CHANNEL_A, CHANNEL_B],
    );
  });

  afterAll(async () => {
    if (presenceWasLoaded) registryCache.__setEnabledForTesting(seededPresence);
    else registryCache.__resetForTesting();
    await db.orm.em.execute(`delete from sales_channels where id in (?, ?)`, [
      CHANNEL_A,
      CHANNEL_B,
    ]);
    await db.close();
  });

  beforeEach(async () => {
    registryCache.__setEnabledForTesting([...seededPresence, 'newsletter', 'cms']);
    await db.beginTx();
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  /** The real owner-side implementation, on this test's transaction. */
  function seedPort(): CmsBlockSeedService {
    return new CmsBlockSeedService(() => db.em());
  }

  async function boundChannelIds(): Promise<string[]> {
    const rows = (await db.em().execute(
      `select sales_channel_id::text as id
         from cms_block_sales_channels
        where code = ?
        order by sales_channel_id`,
      [NEWSLETTER_CONSENT_BLOCK_CODE],
    )) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  it('binds the block to every channel, under the block code', async () => {
    await expect(ensureNewsletterConsentBlock(seedPort())).resolves.toBe('seeded');
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
      [NEWSLETTER_CONSENT_BLOCK_CODE],
    )) as Array<{ block_code: string }>;
    expect(rows.length).toBe(bound.length);
    expect(new Set(rows.map((r) => r.block_code))).toEqual(
      new Set([NEWSLETTER_CONSENT_BLOCK_CODE]),
    );
  });

  it('is idempotent — a second run binds nothing new', async () => {
    await ensureNewsletterConsentBlock(seedPort());
    const before = await boundChannelIds();
    await ensureNewsletterConsentBlock(seedPort());

    expect(await boundChannelIds()).toEqual(before);
  });

  it('picks up a channel created after the first run', async () => {
    await ensureNewsletterConsentBlock(seedPort());
    const lateChannel = '3b1f0d2a-0000-4000-8000-0000000b1c03';
    await db.em().execute(
      `insert into sales_channels (id, code, name, default_language, default_currency, created_at, updated_at)
       values (?, 'nl-consent-late', '{"en-US":"Late"}'::jsonb, 'en-US', 'USD', now(), now())`,
      [lateChannel],
    );

    await ensureNewsletterConsentBlock(seedPort());

    expect(await boundChannelIds()).toContain(lateChannel);
  });

  it('writes nothing at all while `cms` is switched off, and seeds once it is back', async () => {
    // Principle XVII item 6, against the database rather than a double: off is
    // non-destructive *and* inert, and the restoration has to leave the rows a
    // platform that was never switched off would have.
    //
    // The witness is a channel created **inside this test's transaction**, and
    // that is not decoration. The invocation's database is shared with every
    // other file in the run, several of which boot the whole platform and run
    // this very seeder, so `cms_blocks` and `cms_block_sales_channels` may
    // already hold this block by the time this file runs. Asserting the tables
    // are empty is a claim about the platform; asserting this channel is not
    // bound is a claim about this call, and it is the one under test.
    const witness = '3b1f0d2a-0000-4000-8000-0000000b1c04';
    await db.em().execute(
      `insert into sales_channels (id, code, name, default_language, default_currency, created_at, updated_at)
       values (?, 'nl-consent-offstate', '{"en-US":"Off"}'::jsonb, 'en-US', 'USD', now(), now())`,
      [witness],
    );

    registryCache.__setEnabledForTesting([...seededPresence, 'newsletter', 'cms'], {
      deactivated: ['cms'],
    });

    await expect(ensureNewsletterConsentBlock(seedPort())).resolves.toBe('cms-absent');
    expect(await boundChannelIds()).not.toContain(witness);

    registryCache.__setEnabledForTesting([...seededPresence, 'newsletter', 'cms']);

    await expect(ensureNewsletterConsentBlock(seedPort())).resolves.toBe('seeded');
    expect(await boundChannelIds()).toContain(witness);
  });
});
