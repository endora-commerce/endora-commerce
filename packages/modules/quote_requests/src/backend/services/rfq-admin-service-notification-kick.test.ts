import { describe, expect, it, vi } from 'vitest';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import { RfqAdminService } from './rfq-admin-service.js';

/**
 * `specs/192-quote-request-draft-share/` (FR-005, tasks T026) — the operator's
 * create on a customer's behalf makes an unshared quote, records nothing for
 * the customer and so kicks no notification delivery once the Command has
 * committed. A write that records notifications (cancel here) still kicks
 * after the commit. Measured against the database in
 * `backend/test/integration/quote_requests/notification-recording.test.ts`
 * ("create on behalf, then share").
 */

const ADMIN = { adminUserId: '00000000-0000-4000-8000-0000000001a1', roleLabel: 'Platform administrator' } as never;

function service() {
  const quote = Object.assign(new QuoteRequest(), { id: '00000000-0000-4000-8000-0000000001a2', sharedWithCustomer: false });
  const order: string[] = [];
  const run = vi.fn(async () => {
    order.push('commit');
    return quote;
  });
  const notificationKick = vi.fn(() => {
    order.push('kick');
  });
  const svc = new RfqAdminService({
    emFactory: () => ({}),
    commandBus: { run },
    notificationKick,
    rfqService: { serializeFull: vi.fn(async () => ({ id: quote.id })) },
  } as never);
  return { svc, run, notificationKick, order };
}

describe('RfqAdminService — the delivery kick after an operator write (192)', () => {
  it('createOnBehalf runs its Command and kicks nothing', async () => {
    const { svc, run, notificationKick } = service();
    await svc.createOnBehalf(ADMIN, {} as never);
    expect(run).toHaveBeenCalledTimes(1);
    expect(notificationKick).not.toHaveBeenCalled();
  });

  it('cancel kicks once, after its Command committed', async () => {
    const { svc, notificationKick, order } = service();
    await svc.cancel(ADMIN, '00000000-0000-4000-8000-0000000001a2', null, undefined);
    expect(notificationKick).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['commit', 'kick']);
  });
});
