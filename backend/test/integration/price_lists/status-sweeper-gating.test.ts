import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { PriceList } from '../../../src/modules/price_lists/entities/price-list.entity.js';
import { priceListsModule } from '../../../src/modules/price_lists/plugin.js';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Issue #126 — the status sweeper is an entry point, so it decides presence.
 *
 * `ctx.routes` gates *requests* through an `onRequest` hook. The plugin body is
 * not a request: it runs at boot whatever the module's effective state, and the
 * timer it starts goes on flipping `scheduled → active` and `active → expired`
 * long after an operator switched price lists off — which changes what
 * customers are charged.
 *
 * Two things make the defect invisible to the rest of the suite, and both are
 * worked around here deliberately:
 *
 *  - **the harness switches the sweeper off** (`priceListsEnableStatusSweeper:
 *    false` in `test/helpers/test-server.ts`), because a wall-clock interval per
 *    test file writes to the database at random moments. So this file composes
 *    the module itself with the sweeper **on**;
 *  - **the tick is a timer**, five minutes away and returning `void`. So
 *    `setInterval` is stubbed for the duration of the plugin's registration, the
 *    one callback it schedules is captured, and the test calls it — the same
 *    function the timer would call, without waiting or faking a clock.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);

/** How long a tick that must do nothing is given to prove it did nothing. */
const SETTLE_MS = 400;

interface SeededRows {
  readonly scheduledId: string;
  readonly activeId: string;
}

describe('price_lists status sweeper is gated on effective presence [real DB]', () => {
  let db: TestDb;
  /** The interval callback the plugin body scheduled. */
  let tick: () => void;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
    registryCache.__setEnabledForTesting(ALL_IDS);
    tick = await mountSweeper(() => db.em());
  });

  afterEach(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await db.rollbackTx();
  });

  it('does not flip a single row while the operator has the module switched off, and resumes when it is switched back on', async () => {
    const seeded = await seedRows(db);

    // Platform-available, operator-deactivated — the case an operator actually
    // drives from `/platform/modules`.
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['price_lists'] });
    tick();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    expect(await statusOf(db, seeded.scheduledId)).toBe('scheduled');
    expect(await statusOf(db, seeded.activeId)).toBe('active');

    // Switched back on: the same tick does the work it was always going to do,
    // so the assertion above is about the gate and not about a sweeper that
    // never ran.
    registryCache.__setEnabledForTesting(ALL_IDS);
    tick();
    await waitFor(async () => (await statusOf(db, seeded.scheduledId)) === 'active');

    expect(await statusOf(db, seeded.scheduledId)).toBe('active');
    expect(await statusOf(db, seeded.activeId)).toBe('expired');
  });

  it('does not flip a single row while the platform has the module disabled', async () => {
    const seeded = await seedRows(db);

    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'price_lists'));
    tick();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    expect(await statusOf(db, seeded.scheduledId)).toBe('scheduled');
    expect(await statusOf(db, seeded.activeId)).toBe('active');
  });
});

/**
 * Compose `price_lists` with the sweeper enabled and hand back the callback the
 * plugin body handed to `setInterval`.
 *
 * The stub is installed only around the registration, and it asserts that the
 * body schedules exactly one timer — a second one would make "the tick"
 * ambiguous, and silently testing the wrong callback is the failure mode this
 * whole file exists to rule out.
 */
async function mountSweeper(emFactory: () => ReturnType<TestDb['em']>): Promise<() => void> {
  const scheduled: Array<() => void> = [];
  const spy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((
    handler: () => void,
  ): NodeJS.Timeout => {
    scheduled.push(handler);
    // A handle with the two methods the plugin uses; the test drives the
    // callback itself, so nothing must actually be armed.
    return { unref: () => undefined, ref: () => undefined } as unknown as NodeJS.Timeout;
  }) as unknown as typeof setInterval);

  try {
    const { plugin } = priceListsModule({
      emFactory,
      requireAdmin: () => async () => undefined,
      enableStatusSweeper: true,
      pricingCacheTtlMs: 0,
    });
    await plugin(Fastify());
  } finally {
    spy.mockRestore();
  }

  expect(scheduled, 'the plugin body scheduled no interval, or more than one').toHaveLength(1);
  return scheduled[0] as () => void;
}

/** One row a sweep would activate and one it would expire, both already due. */
async function seedRows(db: TestDb): Promise<SeededRows> {
  const em = db.em();
  const suffix = randomUUID().slice(0, 8);
  const past = new Date(Date.now() - 2 * 86_400_000);
  // `price_lists_dates_check` wants `ends_at > starts_at`, so the expiring row
  // starts earlier still.
  const longPast = new Date(Date.now() - 4 * 86_400_000);

  const scheduled = em.create(PriceList, {
    code: `sweep-scheduled-${suffix}`,
    name: `Sweep scheduled ${suffix}`,
    currency: 'PLN',
    type: 'sale',
    status: 'scheduled',
    startsAt: past,
  });
  const active = em.create(PriceList, {
    code: `sweep-active-${suffix}`,
    name: `Sweep active ${suffix}`,
    currency: 'PLN',
    type: 'sale',
    status: 'active',
    startsAt: longPast,
    endsAt: past,
  });
  await em.persistAndFlush([scheduled, active]);

  return { scheduledId: scheduled.id, activeId: active.id };
}

/** The row's status as the database has it, never as the identity map has it. */
async function statusOf(db: TestDb, id: string): Promise<string | undefined> {
  const row = await db.em().findOne(PriceList, { id }, { refresh: true });
  return row?.status;
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
