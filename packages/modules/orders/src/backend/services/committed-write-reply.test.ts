import { describe, expect, it, vi } from 'vitest';
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
});
