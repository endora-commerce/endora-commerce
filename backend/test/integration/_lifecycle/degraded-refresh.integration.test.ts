import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import {
  FALLBACK_TTL_MS,
  ModuleRegistryCache,
} from '../../../src/kernel/lifecycle/registry-cache.js';
import { ModuleEffectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { SettingGroup } from '../../../src/kernel/settings/setting-group.entity.js';

/**
 * Feature 073 / research R-2b — the degraded-mode refresh.
 *
 * Before this feature `FALLBACK_TTL_MS` governed `maybeRefresh`, which had
 * **zero call sites**, and `isEnabled` never consulted `degraded`. A process
 * whose subscriber connection dropped therefore served a permanently stale
 * enabled-set until ioredis reconnected *and* somebody published.
 *
 * This test drives that exact case: drop the subscriber, change the registry
 * behind the cache's back, publish nothing at all, and require the cache to
 * recover a correct enabled-set on its own.
 *
 * It also pins the semantics of "fail closed": degraded means **stale**, not
 * "everything is off". PostgreSQL is the authority and stays reachable during
 * a Redis outage, so blanking the set would take the platform down on a blip.
 */

const MODULE_ID = 'fixture_degraded';

/**
 * One MikroORM instance for the whole file. `setupTestDb()` boots its own
 * connection pool on every call, and this feature's own baseline shows the
 * suite running out of PostgreSQL connections — so a second one here would be
 * the very regression SC-010 exists to catch.
 */
let db: TestDb;

beforeAll(async () => {
  db = await setupTestDb();
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe('ModuleRegistryCache — degraded-mode refresh without a publish (integration)', () => {
  let subscriberRedis: Redis;
  let cache: ModuleRegistryCache;

  beforeAll(async () => {
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    subscriberRedis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });

    const em = db.orm.em.fork();
    await em.nativeDelete(ModuleRegistration, { moduleId: MODULE_ID });
    em.create(ModuleRegistration, {
      moduleId: MODULE_ID,
      state: 'installed',
      version: '1.0.0',
      installedAt: new Date(),
      lastStateChangeAt: new Date(),
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
    await em.flush();

    cache = new ModuleRegistryCache();
    // Feature 072 (D-38) — load from PostgreSQL first, arm the pub/sub side
    // after: the degraded mode below is precisely what makes the second half
    // safe to fail.
    await cache.load({ em: () => db.orm.em.fork() as never });
    await cache.watch({
      redisSubscriber: subscriberRedis,
      em: () => db.orm.em.fork() as never,
    });
  }, 60_000);

  afterAll(async () => {
    cache.stopFallbackRefresh();
    await db.orm.em.fork().nativeDelete(ModuleRegistration, { moduleId: MODULE_ID });
    subscriberRedis.disconnect();
  });

  it('recovers a correct enabled-set after the subscriber drops, with no publish', async () => {
    expect(cache.isEnabled(MODULE_ID)).toBe(true);
    expect(cache.isDegraded()).toBe(false);

    // The subscriber connection dies. Nothing tells the cache what changed.
    subscriberRedis.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cache.isDegraded()).toBe(true);

    // Stale, not blank: an outage on the notification channel must not read
    // as "every module is off".
    expect(cache.isEnabled(MODULE_ID)).toBe(true);

    // Another process disables the module. No publish reaches us.
    const em = db.orm.em.fork();
    const row = await em.findOne(ModuleRegistration, { moduleId: MODULE_ID });
    if (!row) throw new Error('fixture registration row disappeared');
    row.state = 'disabled';
    row.lastStateChangeAt = new Date();
    await em.flush();

    // The background timer must notice within a couple of fallback windows.
    const deadline = Date.now() + FALLBACK_TTL_MS * 2 + 1_000;
    while (Date.now() < deadline && cache.isEnabled(MODULE_ID)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(cache.isEnabled(MODULE_ID)).toBe(false);

    // A successful refresh clears the degraded flag again.
    expect(cache.isDegraded()).toBe(false);
  }, 30_000);
});

/**
 * The activation axis against a real database.
 *
 * Every other test of the resolver fakes the EntityManager, so this is the one
 * place the actual SQL runs: `Setting` is a `@GlobalEntity()`, and the refresh
 * happens at boot with no ambient TenantContext, which is exactly the shape
 * that the tenancy guard would reject if the classification were wrong.
 *
 * Co-located with the degraded test rather than given its own file on purpose:
 * both need a real `TestDb`, and the measured baseline leaves no connection
 * headroom for another one (`specs/073-lifecycle-gating-completion/baseline.md`).
 */
describe('ModuleRegistryCache — activation axis against PostgreSQL (integration)', () => {
  const MODULE = 'fixture_activated';
  const CODE = 'fixture_activated.activation';

  beforeAll(async () => {
    const em = db.orm.em.fork();
    await em.nativeDelete(ModuleRegistration, { moduleId: MODULE });
    em.create(ModuleRegistration, {
      moduleId: MODULE,
      state: 'installed',
      version: '1.0.0',
      installedAt: new Date(),
      lastStateChangeAt: new Date(),
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
    await em.flush();
  }, 60_000);

  afterAll(async () => {
    const em = db.orm.em.fork();
    await em.nativeDelete(Setting, { code: CODE });
    await em.nativeDelete(SettingGroup, { code: 'fixture_activation_group' });
    await em.nativeDelete(ModuleRegistration, { moduleId: MODULE });
  });

  async function seedActivationSetting(globalValue: unknown, defaultValue: unknown): Promise<void> {
    const em = db.orm.em.fork();
    await em.nativeDelete(Setting, { code: CODE });
    let group = await em.findOne(SettingGroup, { code: 'fixture_activation_group' });
    if (!group) {
      group = em.create(SettingGroup, {
        code: 'fixture_activation_group',
        name: 'Fixture activation',
        isSystemProtected: false,
        ownerModule: MODULE,
      });
    }
    em.create(Setting, {
      code: CODE,
      name: 'Fixture activation',
      group,
      valueType: 'boolean',
      defaultValue,
      globalValue,
      ownerModule: MODULE,
    });
    await em.flush();
  }

  it('resolves the stored activation with no tenant context, and the platform axis stays independent', async () => {
    await seedActivationSetting(false, true);

    const cache = new ModuleRegistryCache();
    cache.setActivationDeclarations([
      { moduleId: MODULE, settingCode: CODE, default: true, nonDeactivatableReason: null },
    ]);
    const state = new ModuleEffectiveState(cache);
    await cache.refreshFromDb(() => db.orm.em.fork() as never);

    // Platform available, operator switched it off.
    expect(cache.isEnabled(MODULE)).toBe(true);
    expect(state.isPresent(MODULE)).toBe(false);
    expect(state.presence(MODULE)).toMatchObject({
      platformAvailable: true,
      platformState: 'installed',
      operatorActivated: false,
      deactivatable: true,
    });

    // The operator switches it back on. Nothing about the platform axis moved.
    await seedActivationSetting(true, true);
    await cache.refreshFromDb(() => db.orm.em.fork() as never);
    expect(state.isPresent(MODULE)).toBe(true);
    expect(cache.platformStateOf(MODULE)).toBe('installed');
  }, 30_000);

  it('falls back to default_value, and fails closed on a non-boolean', async () => {
    const cache = new ModuleRegistryCache();
    cache.setActivationDeclarations([
      { moduleId: MODULE, settingCode: CODE, default: true, nonDeactivatableReason: null },
    ]);
    const state = new ModuleEffectiveState(cache);

    await seedActivationSetting(null, true);
    await cache.refreshFromDb(() => db.orm.em.fork() as never);
    expect(state.isPresent(MODULE)).toBe(true);

    await seedActivationSetting(null, 'yes');
    await cache.refreshFromDb(() => db.orm.em.fork() as never);
    expect(state.isPresent(MODULE)).toBe(false);
  }, 30_000);
});
