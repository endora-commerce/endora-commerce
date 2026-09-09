import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { EventBus } from '@endora-commerce/platform/events';
import { subscribeForModule } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { SalesChannelsCache } from '../../../src/kernel/sales-channels/sales-channels-cache.js';
import { SalesChannelResolverService } from '../../../src/kernel/sales-channels/sales-channel-resolver.service.js';
import { salesChannelsServiceFor } from '../../helpers/sales-channels-service.js';

/**
 * D-93 (issue #160) — the sales-channel cache is dropped by the **write**, not
 * by whoever the EventBus happens to reach first.
 *
 * The same shape #45 settled for settings, and both hazards it proved on
 * `master` are live here:
 *
 *  1. `EventBus.dispatch` awaits handlers in registration order, so a
 *     subscriber registered ahead of the invalidator defers the drop past a
 *     read. That is not hypothetical for channels: `dictionaries` subscribes to
 *     **both** of these event names and rebuilds its own cache on receipt
 *     (`dictionaries/backend.ts`), and issue #101 already measured its Redis
 *     SCAN pushing the channel invalidator past a tick.
 *  2. `emit()` inside an `EventBus.run` scope is **buffered until the scope's
 *     function returns**, so a write and a read-back in one scope cannot be
 *     helped by any registration order at all. `CommandBus.run` opens exactly
 *     one such scope per command, and `set-default` is a Command.
 *
 * The events stay — they are a fact about the channel other consumers want, and
 * `dictionaries` is right to listen. What stops being true is that the
 * channel's own cache learns about the channel's own write second-hand.
 */

const PROBE_CODE = 'd93_probe';

describe('sales-channel cache invalidation happens at the write seam (D-93)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    for (const code of [PROBE_CODE, `${PROBE_CODE}_subscribed`, `${PROBE_CODE}_unsubscribed`]) {
      em.create(SalesChannel, {
        code,
        name: { en: code },
        defaultLanguage: 'en-US',
        defaultCurrency: 'PLN',
        languages: ['en-US'],
        currencies: ['PLN'],
        isPublic: true,
        active: true,
        systemDefault: false,
        version: 1,
      });
    }
    await em.flush();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a write and a read back inside one command scope see the new state', async () => {
    const resolver = h.salesChannels.resolver;
    expect((await resolver.getByCode(PROBE_CODE))?.active).toBe(true);

    // `EventBus.run` is what `CommandBus.run` opens around every command, so
    // this is the shape of any Command that writes a channel and then reads it
    // back — its own read, or any service it calls. Buffered emissions cannot
    // reach a subscriber until the scope ends, so a cache dropped by a
    // subscriber is not dropped here at all.
    const observed = await h.eventBus.run(async () => {
      await h.salesChannels.salesChannelsService.deactivate(PROBE_CODE);
      return resolver.getByCode(PROBE_CODE);
    });

    expect(observed?.active).toBe(false);
  });

  it('a gated subscriber cannot defer the drop past a read', async () => {
    const code = `${PROBE_CODE}_subscribed`;
    const bus = new EventBus();
    const cache = new SalesChannelsCache(h.redis);
    const resolver = new SalesChannelResolverService(h.em, cache);
    const service = salesChannelsServiceFor(h, h.em, { eventBus: bus, cache });

    // A module's own `ctx.subscribe` handler, first on this bus — the position
    // `dictionaries` occupies whenever the composition order happens to put it
    // there. It awaits, so under the old arrangement `emit()` returned with the
    // drop still queued behind it and the read below was served the pre-write
    // channel.
    subscribeForModule('dictionaries', bus, 'sales_channels.lifecycle_changed', async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    });

    expect((await resolver.getByCode(code))?.active).toBe(true);
    await service.deactivate(code);

    expect((await resolver.getByCode(code))?.active).toBe(false);
  });

  it('drops the cache with nothing subscribed to the bus at all', async () => {
    const code = `${PROBE_CODE}_unsubscribed`;
    const bus = new EventBus();
    const cache = new SalesChannelsCache(h.redis);
    const resolver = new SalesChannelResolverService(h.em, cache);
    const service = salesChannelsServiceFor(h, h.em, { eventBus: bus, cache });

    // The property stated on its own: freshness after a write owes nothing to
    // the bus. A composition that wires no listener — a worker, a CLI, a future
    // root — invalidates exactly the same.
    expect((await resolver.getByCode(code))?.active).toBe(true);
    await service.deactivate(code);

    expect((await resolver.getByCode(code))?.active).toBe(false);
  });

  it('drops before it announces, so a subscriber re-reading gets the new state', async () => {
    const code = `${PROBE_CODE}_unsubscribed`;
    const bus = new EventBus();
    const cache = new SalesChannelsCache(h.redis);
    const resolver = new SalesChannelResolverService(h.em, cache);
    const service = salesChannelsServiceFor(h, h.em, { eventBus: bus, cache });

    // What the composition order used to buy `dictionaries`' registry rebuild:
    // it re-reads the channel it was told about. It gets the new state because
    // the drop is already done when the event goes out — not because of where
    // it sits in the dispatch order.
    expect((await resolver.getByCode(code))?.active).toBe(false);

    let seenBySubscriber: boolean | null = null;
    subscribeForModule('dictionaries', bus, 'sales_channels.lifecycle_changed', async () => {
      seenBySubscriber = (await resolver.getByCode(code))?.active ?? null;
    });

    await service.activate(code);
    // `emit` outside a scope dispatches fire-and-forget; drain it.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(seenBySubscriber).toBe(true);
  });
});
