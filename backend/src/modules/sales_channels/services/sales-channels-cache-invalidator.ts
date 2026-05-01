import type { EventBus } from '../../../events/bus.js';
import type { SalesChannelsCache } from './sales-channels-cache.js';

/**
 * SalesChannelsCacheInvalidator — feature 005 / T012.
 *
 * Subscribes to the platform EventBus and drops cache entries on every
 * identity / lifecycle change emitted by the sales-channels services.
 * Lives for the process lifetime; the returned `dispose` unsubscribes
 * for tests that want a deterministic teardown.
 */

export interface SalesChannelsCacheInvalidatorHandle {
  dispose: () => void;
}

interface ChannelChangedPayload {
  channelCode?: string;
  /** When set, every cached channel is dropped (used on broad lifecycle changes). */
  invalidateAll?: boolean;
}

export function attachSalesChannelsCacheInvalidator(
  eventBus: EventBus,
  cache: SalesChannelsCache,
): SalesChannelsCacheInvalidatorHandle {
  const offIdentity = eventBus.on(
    'sales_channels.identity_changed',
    async (payload: unknown) => {
      const { channelCode } = (payload as ChannelChangedPayload) ?? {};
      if (channelCode) await cache.invalidate(channelCode);
    },
  );
  const offLifecycle = eventBus.on(
    'sales_channels.lifecycle_changed',
    async (payload: unknown) => {
      const p = (payload as ChannelChangedPayload) ?? {};
      if (p.invalidateAll) {
        await cache.invalidateAll();
        return;
      }
      if (p.channelCode) await cache.invalidate(p.channelCode);
    },
  );

  return {
    dispose() {
      offIdentity();
      offLifecycle();
    },
  };
}
