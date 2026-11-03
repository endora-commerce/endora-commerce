import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CartApprovalService } from './cart-approval-service.js';
import type { CartAuditService } from './cart-audit-service.js';
import type { Cart, CartApprovalStatus } from '../entities/cart.entity.js';

/**
 * Issue #649 — the re-arm of a buyer's content change is staged on the
 * caller's entity manager and flushes nothing, so the change, the transition
 * and its audit row are written by one flush: one transaction. The HTTP
 * behaviour is `backend/test/integration/carts/cart-approval-pending-edit.test.ts`.
 */

function harness(approvalStatus: CartApprovalStatus) {
  const recordWithin = vi.fn();
  const emFactory = vi.fn();
  const service = new CartApprovalService(
    emFactory as unknown as () => EntityManager,
    { recordWithin } as unknown as CartAuditService,
    ...([{}, {}, {}, {}, {}, {}] as unknown as [never, never, never, never, never, never]),
  );
  const em = { flush: vi.fn(), persist: vi.fn() } as unknown as EntityManager;
  const cart = {
    id: 'cart-1',
    approvalStatus,
    submittedForApprovalAt: new Date('2026-11-01T00:00:00Z'),
  } as unknown as Cart;
  return { service, em, cart, recordWithin, emFactory };
}

describe('CartApprovalService.reArmWithin', () => {
  it('returns a pending cart to not_required, on the caller manager, without flushing', () => {
    const { service, em, cart, recordWithin, emFactory } = harness('pending');
    service.reArmWithin(em, cart, { customerAccountId: 'buyer-1' });

    expect(cart.approvalStatus).toBe('not_required');
    expect(cart.submittedForApprovalAt).toBeNull();
    expect(recordWithin).toHaveBeenCalledWith(em, [
      {
        cartId: 'cart-1',
        actorType: 'customer',
        actorId: 'buyer-1',
        action: 'approval_resubmission_required',
        fromState: 'pending',
        toState: 'not_required',
      },
    ]);
    expect(em.flush).not.toHaveBeenCalled();
    expect(emFactory).not.toHaveBeenCalled();
  });

  it('sends an approved cart back to pending, on the caller manager, without flushing', () => {
    const { service, em, cart, recordWithin, emFactory } = harness('approved');
    service.reArmWithin(em, cart, { customerAccountId: 'buyer-1' });

    expect(cart.approvalStatus).toBe('pending');
    expect(cart.submittedForApprovalAt).toBeInstanceOf(Date);
    expect(recordWithin).toHaveBeenCalledWith(em, [
      expect.objectContaining({ fromState: 'approved', toState: 'pending' }),
    ]);
    expect(em.flush).not.toHaveBeenCalled();
    expect(emFactory).not.toHaveBeenCalled();
  });

  it('leaves a cart outside approval alone, and is idempotent within one unit of work', () => {
    for (const status of ['not_required', 'rejected_by_org_admin'] as const) {
      const { service, em, cart, recordWithin } = harness(status);
      service.reArmWithin(em, cart, { customerAccountId: 'buyer-1' });
      expect(cart.approvalStatus).toBe(status);
      expect(recordWithin).not.toHaveBeenCalled();
    }

    const { service, em, cart, recordWithin } = harness('pending');
    service.reArmWithin(em, cart, { customerAccountId: 'buyer-1' });
    service.reArmWithin(em, cart, { customerAccountId: 'buyer-1' });
    expect(cart.approvalStatus).toBe('not_required');
    expect(recordWithin).toHaveBeenCalledTimes(1);
  });
});
