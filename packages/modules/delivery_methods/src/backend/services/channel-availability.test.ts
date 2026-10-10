import { describe, expect, it } from 'vitest';
import {
  deliveryMethodIdsAvailableInChannel,
  type DeliveryMethodChannelReads,
} from './channel-availability.js';

/**
 * This module asks the platform's membership service one question and adds
 * nothing to the answer: which of these methods are **offered** in the channel,
 * for the entity type `delivery-method`.
 *
 * The rule itself — a method bound to no channel is offered in every one — is
 * not in this module. It is applied by the service because this module's bridge
 * is registered with `emptyMeansEveryChannel`, and it is held where it lives:
 * `backend/test/integration/sales_channels/available-in-channel.test.ts` over a
 * real bridge, and
 * `backend/test/contract/methods/sales-channel-availability.contract.test.ts`
 * over the HTTP surface.
 */
describe('deliveryMethodIdsAvailableInChannel', () => {
  it('asks the bridge for the methods offered in the channel, as `delivery-method`, and returns its answer', async () => {
    const asked: unknown[][] = [];
    const reads: DeliveryMethodChannelReads = {
      filterEntityIdsAvailableInChannel: async (...args) => {
        asked.push(args);
        return ['m1', 'm3'];
      },
    };

    const offered = await deliveryMethodIdsAvailableInChannel(reads, 'channel-a', ['m1', 'm2', 'm3']);

    expect(asked).toEqual([['channel-a', 'delivery-method', ['m1', 'm2', 'm3']]]);
    expect([...offered]).toEqual(['m1', 'm3']);
  });
});
