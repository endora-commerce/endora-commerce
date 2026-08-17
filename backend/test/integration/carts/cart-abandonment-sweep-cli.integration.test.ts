import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Cart } from '../../../src/modules/carts/entities/cart.entity.js';
import { CartAuditEntry } from '../../../src/modules/carts/entities/cart-audit-entry.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { sweepAbandonedCarts } from '../../../src/modules/carts/scripts/abandonment-sweep.js';
import { enterSystemScope } from '../../../src/kernel/scope.js';

/**
 * Issue #54 — the ops CLI decides module presence before it works.
 *
 * The entry point has no route to gate, no worker to gate and no port to
 * resolve, so nothing gated it: it ran whatever `module_registrations` said.
 * Constitution XVII item 3 names `requireModuleEnabled` for exactly that shape,
 * and these two cases are the two answers it can give.
 *
 * The tests drive {@link sweepAbandonedCarts}, not `runAbandonmentSweep`: the
 * latter owns the `initOrm` singleton the backend harness also boots, so
 * calling it here would close the server's ORM for the rest of the run.
 *
 * `registryCache` is a process singleton the harness seeds with
 * `__setEnabledForTesting`. Loading it from the database is the point of the
 * first assertion, so the seeded state is restored afterwards exactly as
 * `setupBackendServer` sets it.
 */

describe('cart abandonment sweep CLI — module presence', () => {
  let db: TestDb;
  let systemDefaultChannelId: string;

  beforeAll(async () => {
    db = await setupTestDb();
    const tmpEm = db.orm.em.fork();
    const ch = await tmpEm.findOne(SalesChannel, { systemDefault: true });
    systemDefaultChannelId = ch?.id ?? '';
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
    registryCache.__setEnabledForTesting(REGISTERED_MANIFESTS.map((e) => e.manifest.id));
  });

  /** An idle cart the sweep would take if it were allowed to run. */
  function seedIdleCart(token: string): Cart {
    const em = db.em();
    return em.create(Cart, {
      anonymousCartToken: token,
      ...(systemDefaultChannelId ? { salesChannelId: systemDefaultChannelId } : {}),
      lastActivityAt: new Date(Date.now() - 400 * 24 * 60 * 60_000),
    });
  }

  it('refuses with MODULE_DISABLED when the platform registry has no installed carts', async () => {
    const em = db.em();
    // Stated rather than assumed: both cases set the registry row they are
    // about, inside the test transaction, so neither depends on what a
    // developer's database happens to carry.
    await em.nativeDelete(ModuleRegistration, { moduleId: 'carts' });
    const cart = seedIdleCart(`cli-absent-${Date.now()}`);
    await em.flush();

    await expect(
      enterSystemScope('test: cli sweep', () => sweepAbandonedCarts(() => em), {
        entryPoint: 'cli',
      }),
    ).rejects.toMatchObject({ statusCode: 503, code: 'MODULE_DISABLED', moduleId: 'carts' });

    // Fail closed means nothing moved, not "moved and then complained".
    const reload = await em.findOneOrFail(Cart, { id: cart.id });
    expect(reload.status).toBe('active');
    expect(await em.find(CartAuditEntry, { cartId: cart.id })).toHaveLength(0);
  });

  it('sweeps once the platform registry has carts installed', async () => {
    const em = db.em();
    await em.nativeDelete(ModuleRegistration, { moduleId: 'carts' });
    em.create(ModuleRegistration, {
      moduleId: 'carts',
      state: 'installed',
      version: '2.0.0',
      installedAt: new Date(),
      lastStateChangeAt: new Date(),
    });
    const cart = seedIdleCart(`cli-present-${Date.now()}`);
    await em.flush();

    const result = await enterSystemScope(
      'test: cli sweep',
      () => sweepAbandonedCarts(() => em),
      { entryPoint: 'cli' },
    );

    expect(result.abandonedCount).toBeGreaterThanOrEqual(1);
    const reload = await em.findOneOrFail(Cart, { id: cart.id });
    expect(reload.status).toBe('abandoned');
    const audit = await em.find(CartAuditEntry, { cartId: cart.id });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorType).toBe('sweep');
  });
});
