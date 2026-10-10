import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { DeliveryMethodReadService } from './delivery-method-read-port.js';
import type { DeliveryMethodChannelReads } from './channel-availability.js';

/**
 * `isAvailableInChannel` for an id that names **no** method.
 *
 * For this entity type a method bound to no channel is offered in every
 * channel, and an id that names nothing is, trivially, bound to no channel. So
 * the bridge alone would answer "offered" for a method that does not exist. The
 * read asks whether the row exists first and answers `false` without consulting
 * the bridge at all. No caller reaches this today — every one resolves the
 * method before it asks — which is exactly why it is held here rather than
 * left to be true by accident.
 */
function rig(existing: number): { service: DeliveryMethodReadService; bridgeAsked: () => number } {
  let asked = 0;
  const emFactory = (() => ({ count: async () => existing })) as unknown as () => EntityManager;
  const bridge: DeliveryMethodChannelReads = {
    // What the real bridge answers for an id bound to nothing: offered.
    filterEntityIdsAvailableInChannel: async (_channelId, _entityType, ids) => {
      asked += 1;
      return [...ids];
    },
  };
  return { service: new DeliveryMethodReadService(emFactory, bridge), bridgeAsked: () => asked };
}

describe('DeliveryMethodReadService.isAvailableInChannel', () => {
  it('answers false for an id that names no method, without asking the bridge', async () => {
    const { service, bridgeAsked } = rig(0);

    expect(await service.isAvailableInChannel('no-such-method', 'channel-a')).toBe(false);
    expect(bridgeAsked()).toBe(0);
  });

  it('asks the bridge for a method that exists, and returns its answer', async () => {
    const { service, bridgeAsked } = rig(1);

    expect(await service.isAvailableInChannel('a-method', 'channel-a')).toBe(true);
    expect(bridgeAsked()).toBe(1);
  });
});
