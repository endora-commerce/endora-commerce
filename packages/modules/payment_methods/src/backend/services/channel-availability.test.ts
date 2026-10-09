import { describe, expect, it } from 'vitest';
import {
  paymentMethodIdsAvailableInChannel,
  type PaymentMethodChannelReads,
} from './channel-availability.js';

/**
 * The membership-less rule, stated against the two bridge reads it is built
 * from: a method bound to the channel is offered there, a method bound to
 * **other** channels only is not, and a method bound to **no** channel is
 * offered in every one.
 *
 * The fake is the bridge reduced to a map — channel ids per method — so each
 * case reads as the table it describes. The route-level proof, over the real
 * bridge and the resolved request channel, is
 * `backend/test/contract/methods/sales-channel-availability.contract.test.ts`.
 */
const CHANNEL_A = 'channel-a';
const CHANNEL_B = 'channel-b';

function bridge(memberships: Record<string, readonly string[]>): {
  reads: PaymentMethodChannelReads;
  asked: string[];
} {
  const asked: string[] = [];
  const reads: PaymentMethodChannelReads = {
    filterEntityIdsInChannel: async (channelId, entityType, entityIds) => {
      asked.push(`filter:${entityType}`);
      return entityIds.filter((id) => (memberships[id] ?? []).includes(channelId));
    },
    listChannelsForEntity: async (entityType, entityId) => {
      asked.push(`list:${entityType}:${entityId}`);
      return (memberships[entityId] ?? []).map((id) => ({ id })) as never;
    },
  };
  return { reads, asked };
}

describe('paymentMethodIdsAvailableInChannel', () => {
  it('offers a method bound to the channel', async () => {
    const { reads } = bridge({ m1: [CHANNEL_A] });

    expect([...(await paymentMethodIdsAvailableInChannel(reads, CHANNEL_A, ['m1']))]).toEqual(['m1']);
  });

  it('does not offer a method bound only to another channel', async () => {
    const { reads } = bridge({ m1: [CHANNEL_B] });

    expect([...(await paymentMethodIdsAvailableInChannel(reads, CHANNEL_A, ['m1']))]).toEqual([]);
  });

  it('offers a method bound to no channel at all, in every channel', async () => {
    const { reads } = bridge({});

    expect([...(await paymentMethodIdsAvailableInChannel(reads, CHANNEL_A, ['m1']))]).toEqual(['m1']);
    expect([...(await paymentMethodIdsAvailableInChannel(reads, CHANNEL_B, ['m1']))]).toEqual(['m1']);
  });

  it('answers each method of a mixed set on its own terms', async () => {
    const { reads } = bridge({
      onA: [CHANNEL_A],
      onB: [CHANNEL_B],
      onBoth: [CHANNEL_A, CHANNEL_B],
      // `unbound` has no entry: bound to nothing.
    });

    const offered = await paymentMethodIdsAvailableInChannel(reads, CHANNEL_A, [
      'onA',
      'onB',
      'onBoth',
      'unbound',
    ]);

    expect([...offered].sort()).toEqual(['onA', 'onBoth', 'unbound']);
  });

  it('reads the bridge as `payment-method`, and asks about memberships only for methods not bound to the channel', async () => {
    const { reads, asked } = bridge({ onA: [CHANNEL_A], onB: [CHANNEL_B] });

    await paymentMethodIdsAvailableInChannel(reads, CHANNEL_A, ['onA', 'onB', 'onA']);

    expect(asked).toEqual(['filter:payment-method', 'list:payment-method:onB']);
  });

  it('asks nothing for an empty set', async () => {
    const { reads, asked } = bridge({});

    expect((await paymentMethodIdsAvailableInChannel(reads, CHANNEL_A, [])).size).toBe(0);
    expect(asked).toEqual([]);
  });
});
