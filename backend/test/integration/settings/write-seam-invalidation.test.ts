import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineModuleSettingsManifest } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { EventBus } from '@endora-commerce/platform/events';
import { subscribeForModule } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { SettingValue } from '../../../src/kernel/settings/setting-value.entity.js';
import { SettingsCache } from '../../../src/kernel/settings/settings-cache.js';
import { SettingsService } from '../../../src/kernel/settings/settings.service.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { SettingsAdminService } from '../../../../packages/modules/settings/src/backend/services/settings-admin.service.js';

/**
 * Issue #45 — the settings cache is dropped by the **write**, not by whoever
 * the EventBus happens to reach first.
 *
 * Until this landed the drop was a subscriber: `attachSettingsCacheInvalidator`
 * subscribed to `settings.value_changed`, and it was in time only because two
 * accidents held.
 *
 *  1. `EventBus.dispatch` awaits handlers in **registration order**, and both
 *     composition roots composed the invalidator before `composeModules(…)`, so
 *     it was handler zero and its synchronous prologue reached
 *     `SharedDropMarks.begin` before `emit()` returned. Since feature 072 all 65
 *     modules register in one pass whose order is meaningless by design (D-45),
 *     so nothing preserved that and nothing would have noticed it changing.
 *  2. `emit()` outside a scope is fire-and-forget. Inside one —
 *     `CommandBus.run` opens exactly one per command — emissions are **buffered
 *     until the scope's function returns**, so the drop could not happen until
 *     after the whole command, read-backs included.
 *
 * Both are gone: `SettingsAdminService` calls `SettingsCacheInvalidation` and
 * awaits it, after the flush and before the emit. The three tests below are the
 * three ways the old arrangement could be wrong, and each was red before the
 * fix (measured 2026-08-17: all three returned `https://default.example`).
 */

const CHANNEL = 'pl_retail';
const DEFAULT_VALUE = 'https://default.example';

describe('settings cache invalidation happens at the write seam (#45)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await new ManifestReconciler(h.em()).apply([
      defineModuleSettingsManifest({
        moduleCode: 'seam_probe',
        groups: [],
        settings: [
          // One code per test: the per-process LRU is not reset between them.
          {
            code: 'seam_probe.scoped',
            name: 'Scoped',
            valueType: 'string',
            defaultValue: DEFAULT_VALUE,
          },
          {
            code: 'seam_probe.subscribed',
            name: 'Subscribed',
            valueType: 'string',
            defaultValue: DEFAULT_VALUE,
          },
          {
            code: 'seam_probe.unsubscribed',
            name: 'Unsubscribed',
            valueType: 'string',
            defaultValue: DEFAULT_VALUE,
          },
        ],
      }),
    ]);
  }, 60_000);

  afterAll(async () => {
    const em = h.em();
    for (const s of await em.find(Setting, { ownerModule: 'seam_probe' })) {
      for (const v of await em.find(SettingValue, { setting: s })) em.remove(v);
      em.remove(s);
    }
    await em.flush();
    await teardownBackendServer(h);
  });

  const channelId = async (): Promise<string> =>
    (await h.em().findOneOrFail(SalesChannel, { code: CHANNEL })).id;

  it('a write and a read back inside one command scope see the new value', async () => {
    const id = await channelId();
    expect(await h.settings.settingsService.get('seam_probe.scoped', id, z.string())).toBe(
      DEFAULT_VALUE,
    );

    // `EventBus.run` is what `CommandBus.run` opens around every command, so
    // this is the shape of any Command that writes a setting and then reads it —
    // its own read-back, or any service it calls. Buffered emissions cannot
    // reach a subscriber until the scope ends, so a cache that is dropped by a
    // subscriber is not dropped here at all.
    const observed = await h.eventBus.run(async () => {
      await h.settings.adminService.setValueForSubset(
        'seam_probe.scoped',
        [CHANNEL],
        'https://scoped.example',
        null,
        { actorAdminUserId: null },
      );
      return h.settings.settingsService.get('seam_probe.scoped', id, z.string());
    });

    expect(observed).toBe('https://scoped.example');
  });

  it('a gated subscriber cannot defer the drop past a read', async () => {
    const id = await channelId();
    const bus = new EventBus();
    const cache = new SettingsCache(h.redis);
    const reader = new SettingsService(h.em, cache);
    const admin = new SettingsAdminService(h.em, bus, cache);

    // A module's own `ctx.subscribe` handler, and the first thing on this bus —
    // the position that used to put it ahead of the kernel's invalidator. It
    // awaits, so under the old arrangement `emit()` returned with the drop
    // still queued behind it and the read below was served the pre-write value.
    subscribeForModule('search', bus, 'settings.value_changed', async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    });

    expect(await reader.get('seam_probe.subscribed', id, z.string())).toBe(DEFAULT_VALUE);
    await admin.setValueForSubset(
      'seam_probe.subscribed',
      [CHANNEL],
      'https://subscribed.example',
      null,
      { actorAdminUserId: null },
    );

    expect(await reader.get('seam_probe.subscribed', id, z.string())).toBe(
      'https://subscribed.example',
    );
  });

  it('drops the cache with nothing subscribed to the bus at all', async () => {
    const id = await channelId();
    const bus = new EventBus();
    const cache = new SettingsCache(h.redis);
    const reader = new SettingsService(h.em, cache);
    const admin = new SettingsAdminService(h.em, bus, cache);

    // The property stated on its own: freshness after a write owes nothing to
    // the bus. A composition that never wires a listener — a worker process, a
    // CLI, a future root — invalidates exactly the same.
    expect(await reader.get('seam_probe.unsubscribed', id, z.string())).toBe(DEFAULT_VALUE);
    await admin.setValueForSubset(
      'seam_probe.unsubscribed',
      [CHANNEL],
      'https://unsubscribed.example',
      null,
      { actorAdminUserId: null },
    );

    expect(await reader.get('seam_probe.unsubscribed', id, z.string())).toBe(
      'https://unsubscribed.example',
    );
  });

  it('drops before it announces, so a subscriber re-reading gets the new value', async () => {
    // What the composition order used to buy `inventory`'s threshold mirror,
    // `search`'s LLM reactor and `product_feeds`' schedule reconcile: each
    // re-reads the setting it was told about. They get the new value because the
    // drop is already done when the event goes out — not because of where they
    // sit in the dispatch order.
    const id = await channelId();
    const bus = new EventBus();
    const cache = new SettingsCache(h.redis);
    const reader = new SettingsService(h.em, cache);
    const admin = new SettingsAdminService(h.em, bus, cache);

    expect(await reader.get('seam_probe.scoped', id, z.string())).toBe('https://scoped.example');

    let seenBySubscriber: string | null = null;
    subscribeForModule('inventory', bus, 'settings.value_changed', async () => {
      seenBySubscriber = await reader.get('seam_probe.scoped', id, z.string());
    });

    await admin.setValueForSubset(
      'seam_probe.scoped',
      [CHANNEL],
      'https://announced.example',
      null,
      { actorAdminUserId: null },
    );
    // `emit` outside a scope dispatches fire-and-forget; drain it.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(seenBySubscriber).toBe('https://announced.example');
  });
});
