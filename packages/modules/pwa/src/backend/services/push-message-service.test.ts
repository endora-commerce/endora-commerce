import { describe, expect, it } from 'vitest';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { PushMessageService } from './push-message-service.js';

/**
 * `specs/149-pwa-order-status-push/` FR-014 — an announcement delivered twice
 * produces one message. The look-up before the insert answers a duplicate that
 * arrives after the first has committed; this pins the other half, two
 * deliveries racing past the look-up, where `push_messages_trigger_event_uniq`
 * refuses the second insert. That refusal is the idempotency working, not a
 * failure, and must not surface as one.
 */

const EXISTING_ID = '11111111-1111-4111-8111-111111111111';

function racingEm(state: { lookups: number }) {
  return {
    findOne: async () => {
      state.lookups += 1;
      // First look-up (before the insert): nothing yet. Second (after the
      // refusal): the row the other delivery committed.
      return state.lookups === 1 ? null : { id: EXISTING_ID };
    },
    find: async () => [],
    create: (_entity: unknown, data: Record<string, unknown>) => ({ id: 'new', ...data }),
    persist: () => ({
      flush: async () => {
        throw new UniqueConstraintViolationException(
          new Error('duplicate key value violates unique constraint "push_messages_trigger_event_uniq"'),
        );
      },
    }),
  };
}

describe('PushMessageService.createAndEnqueue — a racing duplicate', () => {
  it('answers the committed message rather than throwing', async () => {
    const state = { lookups: 0 };
    const service = new PushMessageService(
      () => racingEm(state) as never,
      { addBulk: async () => [] } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.createAndEnqueue({
        salesChannelId: 'chan-1',
        title: 't',
        body: 'b',
        audience: { kind: 'customers', customerAccountIds: ['cust-1'] },
        trigger: 'order_status',
        sourceEventId: 'evt-1',
      }),
    ).resolves.toEqual({ messageId: EXISTING_ID, queuedDeliveries: 0 });
  });

  it('still throws a unique violation for a message that names no event', async () => {
    const state = { lookups: 0 };
    const service = new PushMessageService(
      () => racingEm(state) as never,
      { addBulk: async () => [] } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.createAndEnqueue({
        salesChannelId: 'chan-1',
        title: 't',
        body: 'b',
        audience: { kind: 'all' },
        trigger: 'admin',
      }),
    ).rejects.toBeInstanceOf(UniqueConstraintViolationException);
  });
});
