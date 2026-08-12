import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineModuleSettingsManifest } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { SettingValue } from '../../../src/kernel/settings/setting-value.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * T047 — Redis cache + EventBus invalidator test for the universal getter.
 *
 * The cache is wired through `composeApp()` and the test server, so
 * `getSettingsService.get()` reads through Redis. After an admin write
 * fires `settings.value_changed`, the invalidator drops the matching key
 * and the next read materialises the new value.
 */
describe('SettingsService cache invalidation (T047)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await new ManifestReconciler(h.em()).apply([
      defineModuleSettingsManifest({
        moduleCode: 'us3_cache',
        groups: [],
        settings: [
          {
            code: 'us3_cache.url',
            name: 'URL',
            valueType: 'string',
            defaultValue: 'https://default.example',
          },
          // The invalidation-failure tests need their own codes: the per-process
          // LRU is not reset between tests, only the Redis namespace is.
          {
            code: 'us3_cache.raced_url',
            name: 'Raced URL',
            valueType: 'string',
            defaultValue: 'https://default.example',
          },
          {
            code: 'us3_cache.unreachable_url',
            name: 'Unreachable URL',
            valueType: 'string',
            defaultValue: 'https://default.example',
          },
          {
            code: 'us3_cache.cleared_url',
            name: 'Cleared URL',
            valueType: 'string',
            defaultValue: 'https://default.example',
          },
        ],
      }),
    ]);
  });

  afterAll(async () => {
    const em = h.em();
    for (const s of await em.find(Setting, { ownerModule: 'us3_cache' })) em.remove(s);
    await em.flush();
    h.settings.cacheInvalidator?.dispose();
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    // Clear cache + setting_values so each test starts blank.
    const keys = await h.redis.keys('settings:v1:us3_cache.url:*');
    if (keys.length > 0) await h.redis.del(...keys);
    const em = h.em();
    const setting = await em.findOneOrFail(Setting, { code: 'us3_cache.url' });
    for (const v of await em.find(SettingValue, { setting })) em.remove(v);
    await em.flush();
  });

  it('invalidates after an admin value write', async () => {
    const channel = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });

    // First read populates cache with the default.
    const first = await h.settings.settingsService.get(
      'us3_cache.url',
      channel.id,
      z.string(),
    );
    expect(first).toBe('https://default.example');

    // Admin write — emits settings.value_changed → invalidator drops the key.
    await h.settings.adminService.setValueForSubset(
      'us3_cache.url',
      ['pl_retail'],
      'https://chosen.example',
      null,
      { actorAdminUserId: null },
    );

    // EventBus.emit is fire-and-forget; in production the next request
    // arrives after the handler completes, but the test reads in the next
    // tick. Drain the microtask + Redis I/O queue before re-reading.
    await flushAsyncDispatch();

    // Read again. The previous Redis value would still say "default" if the
    // invalidator did not drop the key; passing here proves the path.
    const second = await h.settings.settingsService.get(
      'us3_cache.url',
      channel.id,
      z.string(),
    );
    expect(second).toBe('https://chosen.example');
  });

  it('does not serve the pre-write value to a read that races the invalidation', async () => {
    const channel = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });

    expect(
      await h.settings.settingsService.get('us3_cache.raced_url', channel.id, z.string()),
    ).toBe('https://default.example');

    await h.settings.adminService.setValueForSubset(
      'us3_cache.raced_url',
      ['pl_retail'],
      'https://raced.example',
      null,
      { actorAdminUserId: null },
    );

    // Deliberately NO `flushAsyncDispatch()`: this is the shape that made
    // `test/integration/mfa/customer-oauth.test.ts` flaky. The invalidation is
    // still on the wire, so the LRU is already dropped while Redis still holds
    // the pre-write value — the read must not be served from either layer.
    expect(
      await h.settings.settingsService.get('us3_cache.raced_url', channel.id, z.string()),
    ).toBe('https://raced.example');
  });

  it('does not serve the pre-write value when the Redis drop fails', async () => {
    const channel = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });

    expect(
      await h.settings.settingsService.get('us3_cache.unreachable_url', channel.id, z.string()),
    ).toBe('https://default.example');

    // The exact failure the flaky run logged: `event handler threw ...
    // Error: Connection is closed.` The shared layer keeps the stale value.
    const del = vi
      .spyOn(h.redis, 'del')
      .mockRejectedValue(new Error('Connection is closed.'));
    try {
      await h.settings.adminService.setValueForSubset(
        'us3_cache.unreachable_url',
        ['pl_retail'],
        'https://unreachable-redis.example',
        null,
        { actorAdminUserId: null },
      );
      await flushAsyncDispatch();

      expect(
        await h.settings.settingsService.get('us3_cache.unreachable_url', channel.id, z.string()),
      ).toBe('https://unreachable-redis.example');
    } finally {
      del.mockRestore();
    }

    // Once Redis answers again the cache heals itself instead of staying
    // bypassed for the process lifetime.
    expect(
      await h.settings.settingsService.get('us3_cache.unreachable_url', channel.id, z.string()),
    ).toBe('https://unreachable-redis.example');
    expect(await h.redis.keys('settings:v1:us3_cache.unreachable_url:*')).not.toHaveLength(0);
  });

  it('lets an operator cache clear reach the in-process layer, not only Redis', async () => {
    const channel = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });

    // Warm both layers with the default.
    expect(
      await h.settings.settingsService.get('us3_cache.cleared_url', channel.id, z.string()),
    ).toBe('https://default.example');

    // Another process changed the value and this one never heard about it: the
    // EventBus is in-process, so a missed notification leaves the LRU holding
    // the pre-change value with nothing to expire it. Writing the row straight
    // through the EM reproduces that state exactly.
    const em = h.em();
    const setting = await em.findOneOrFail(Setting, { code: 'us3_cache.cleared_url' });
    em.create(SettingValue, {
      setting,
      salesChannel: em.getReference(SalesChannel, channel.id),
      value: 'https://written-elsewhere.example',
    });
    await em.flush();

    // This is the button the operator presses when a value "did not take".
    // Dropping Redis alone leaves every warm process serving the stale value —
    // and re-pinning it into Redis on the next read.
    await h.settings.cacheAdminService.clear(['settings']);

    expect(
      await h.settings.settingsService.get('us3_cache.cleared_url', channel.id, z.string()),
    ).toBe('https://written-elsewhere.example');
  });

  it('caches the "not registered" outcome and invalidates it on subsequent group changes', async () => {
    const channel = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });
    // Unknown codes get a sentinel cached so repeated typos do not hammer
    // Postgres.
    const before = await h.settings.settingsService
      .get('us3_cache.unknown', channel.id, z.string())
      .catch((err: unknown) => err);
    expect((before as { name?: string }).name).toBe('SettingNotRegistered');

    // Cache the sentinel: a second call follows the same path.
    const second = await h.settings.settingsService
      .get('us3_cache.unknown', channel.id, z.string())
      .catch((err: unknown) => err);
    expect((second as { name?: string }).name).toBe('SettingNotRegistered');

    // A group-level change wipes everything; the next call still throws but
    // re-checks Postgres rather than serving the sentinel from cache.
    await h.settings.adminService.createGroup(
      { code: 'us3_cache_group', name: 'Cache invalidation' },
      { actorAdminUserId: null },
    );
    const third = await h.settings.settingsService
      .get('us3_cache.unknown', channel.id, z.string())
      .catch((err: unknown) => err);
    expect((third as { name?: string }).name).toBe('SettingNotRegistered');

    // Cleanup the group so other tests don't see it.
    await h.settings.adminService.deleteGroup('us3_cache_group', { actorAdminUserId: null });
  });
});

async function flushAsyncDispatch(): Promise<void> {
  // Two ticks + a brief setTimeout cover the chain:
  //   emit → dispatch microtask → handler awaits Redis → resolves.
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
}
