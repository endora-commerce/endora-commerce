import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CartAnonymizationPort } from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { Cart } from '../entities/cart.entity.js';
import { CartAuditEntry } from '../entities/cart-audit-entry.entity.js';

/**
 * `carts`' step in the customer-account anonymisation sweep (issue #920),
 * published as `cartAnonymizationPort`; the contract is
 * {@link CartAnonymizationPort}'s.
 *
 * An operator (`CartAdminService.reject`) and an approver
 * (`CartApprovalService.reject`) write free text about the buyer twice: onto
 * the cart (`rejectedReason`) and onto the cart's history
 * (`cart_audit_entries.reason`). Both are set to `null` on every cart of the
 * anonymised account, and nothing else moves: the status, `rejectedAt` and
 * `rejectedByActor` are not this person's data, and the rest of the history —
 * actions, actors, states, metadata — is what operators defend approval
 * decisions with. `null`, not a marker, for the reason the #843 ruling gives:
 * every reader already reads `null` as "no reason given".
 *
 * Only a cart some reason is still on is touched, so the step converges: a run
 * after a crash finishes it, and a repeat call writes and records nothing. One
 * `cart.anonymized` row per cart it changed, with a null actor and only
 * `hadRejectedReason`, in the same transaction as the scrub. It publishes no
 * event — `carts` publishes none on any write — and writes no
 * `cart_audit_entries` row of its own: the account it would name is gone.
 *
 * The account's carts are locked first, so two sweeps that overlap on one
 * account (a tick BullMQ hands back after its lock lapsed) scrub and audit it
 * once: the second waits, then finds nothing left.
 */
export class CartAnonymizationService implements CartAnonymizationPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog: AuditPort,
  ) {}

  async anonymizeForCustomerAccount(customerAccountId: string): Promise<number> {
    return this.emFactory().transactional(async (em) => {
      const carts = await em.find(
        Cart,
        { customerAccountId },
        { orderBy: { id: 'asc' }, lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (carts.length === 0) return 0;
      const entries = await em.find(CartAuditEntry, {
        cartId: { $in: carts.map((cart) => cart.id) },
        reason: { $ne: null },
      });
      const entriesByCart = new Map<string, CartAuditEntry[]>();
      for (const entry of entries) {
        entriesByCart.set(entry.cartId, [...(entriesByCart.get(entry.cartId) ?? []), entry]);
      }

      let changed = 0;
      for (const cart of carts) {
        const hadRejectedReason = cart.rejectedReason != null;
        const history = entriesByCart.get(cart.id) ?? [];
        if (!hadRejectedReason && history.length === 0) continue;
        // command-coverage-ignore: the retention sweep's system-initiated
        // scrub, audited below with the null actor that fact deserves.
        cart.rejectedReason = null;
        for (const entry of history) entry.reason = null;
        this.auditLog.recordWithin(em, {
          actorAdminUserId: null,
          action: 'cart.anonymized',
          objectType: 'cart',
          objectId: cart.id,
          stateBefore: { hadRejectedReason },
          stateAfter: null,
        });
        changed += 1;
      }
      await em.flush();
      return changed;
    });
  }
}
