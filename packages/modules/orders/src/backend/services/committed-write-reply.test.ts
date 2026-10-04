import { describe, expect, it, vi } from 'vitest';
import { orderCommittedWritePartialResponseSchema } from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { replyAfterCommittedWrite } from './committed-write-reply.js';

const ORDER = { id: 'o-1', businessId: 'ORD-1', status: 'cancelled', paymentStatus: 'deferred' };

describe('replyAfterCommittedWrite', () => {
  it('answers the full serialisation when it can be produced', async () => {
    const reply = await replyAfterCommittedWrite(ORDER, async () => ({ id: 'o-1', items: [1] }));

    expect(reply).toEqual({ data: { id: 'o-1', items: [1] } });
  });

  it('answers what was written, marked partial, when the reads behind the response fail', async () => {
    const warn = vi.fn();
    const reply = await replyAfterCommittedWrite(
      ORDER,
      async () => {
        throw new Error('Knex: Timeout acquiring a connection.');
      },
      { info: () => undefined, warn, error: () => undefined },
    );

    // The write is committed, so the answer is a success and says what the
    // order now is — never an error envelope for a change that happened.
    expect(reply).toEqual({
      data: { id: 'o-1', businessId: 'ORD-1', status: 'cancelled', paymentStatus: 'deferred' },
      meta: { partial: true },
    });
    expect(warn).toHaveBeenCalledWith(
      { orderId: 'o-1', error: 'Knex: Timeout acquiring a connection.' },
      expect.any(String),
    );
  });

  it('re-throws a module switched off under the serialiser instead of answering partial', async () => {
    const warn = vi.fn();

    await expect(
      replyAfterCommittedWrite(
        ORDER,
        async () => {
          throw new ModuleDisabledError('payment_methods');
        },
        { info: () => undefined, warn, error: () => undefined },
      ),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
    expect(warn).not.toHaveBeenCalled();
  });

  it('answers a partial body the published schema accepts', async () => {
    const reply = await replyAfterCommittedWrite(
      { ...ORDER, id: '00000000-0000-4000-8000-000000000001' },
      async () => {
        throw new Error('no connection');
      },
    );

    expect(orderCommittedWritePartialResponseSchema.safeParse(reply).success).toBe(true);
  });
});
