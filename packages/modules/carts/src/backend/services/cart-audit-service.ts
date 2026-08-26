import type { EntityManager } from '@mikro-orm/postgresql';
import { CartAuditEntry } from '../entities/cart-audit-entry.entity.js';
import type {
  CartAuditAction,
  CartAuditActorType,
} from '../entities/cart-audit-entry.entity.js';
import type { AuditPort } from '@endora-commerce/platform/kernel';

/**
 * Single writer for cart audit landings (feature 027 §R10). Every call
 * lands TWO rows in the same transaction:
 *
 *   1. `cart_audit_entries` — the typed cart-detail feed (powers the
 *      cart-detail UI for both Org-Admin and platform-admin views).
 *   2. `audit_log_entries` — the platform-wide audit timeline
 *      (queryable across modules from the dashboard recent-activity
 *      surface of feature 024).
 *
 * The two writes share a single MikroORM unit-of-work so a partial
 * commit is structurally impossible — either both rows land or
 * neither does. No call site outside the carts module may write to
 * `cart_audit_entries` directly.
 *
 * That claim used to hold only where `emFactory` returned the same manager
 * twice (issue #152). `record()` took one fork for the cart row and
 * `AuditPort.record()` took another for the platform row and flushed it
 * itself, so in production — where the factory forks per call — the two rows
 * were two transactions, and a failure between them landed the platform row
 * without its cart-detail counterpart. Both rows are built on ONE manager now
 * and land in one flush, which is what the paragraph above always said.
 *
 * `actorAdminUserId` on the `audit_log_entries` row is set ONLY when
 * `actor_type === 'platform_admin'`. For customer / org-admin / system /
 * sweep actors the column is null (the cart audit feed still records
 * the actor in `cart_audit_entries.actor_id` / `.actor_type`).
 */

export interface CartAuditRecordInput {
  cartId: string;
  actorType: CartAuditActorType;
  actorId?: string | null;
  action: CartAuditAction;
  fromState?: string | null;
  toState?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  /** Correlation id from the inbound request (X-Request-Id). */
  requestId?: string | null;
}

export class CartAuditService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog: AuditPort,
  ) {}

  /** One landing, on this service's own manager, flushed. The default form. */
  async record(input: CartAuditRecordInput): Promise<CartAuditEntry> {
    const em = this.emFactory();
    const entries = this.recordWithin(em, [input]);
    await em.flush();
    // One input in, one entry out — the map below preserves the arity.
    return entries[0] as CartAuditEntry;
  }

  /**
   * Batch form, landing on the CALLER's EntityManager and flushing nothing
   * (issue #152).
   *
   * The caller's next `flush()` is the unit of work, so a batch of cart writes
   * and the audit rows for that batch commit together or not at all — the
   * guarantee `record()` gives one write, given to a run of them. The
   * abandonment sweep is the caller it exists for: it used to flush once per
   * cart, which is a transaction per cart plus an identity map that never
   * shrank, and at 2000 carts that cost 66 ms each.
   *
   * It flushes nothing on purpose. A method that both joined the caller's unit
   * of work and committed it would decide, on the caller's behalf, that the
   * audit rows are the end of the batch — and for the sweep they are not: the
   * status flip is dirty on the same manager and belongs in the same commit.
   *
   * The name is {@link AuditPort.recordWithin}'s, deliberately: `Within`
   * is the repository's word for "on the caller's manager, no flush", and it is
   * the word `check-command-coverage` reads as an audit landing. A name of its
   * own would have made this method invisible to that check while it was doing
   * exactly what the check exists to find.
   */
  recordWithin(
    em: EntityManager,
    inputs: readonly CartAuditRecordInput[],
  ): CartAuditEntry[] {
    return inputs.map((input) => {
      const entry = em.create(CartAuditEntry, {
        cartId: input.cartId,
        actorType: input.actorType,
        ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
        action: input.action,
        ...(input.fromState !== undefined ? { fromState: input.fromState } : {}),
        ...(input.toState !== undefined ? { toState: input.toState } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        metadata: input.metadata ?? {},
      });

      em.persist(entry);

      this.auditLog.recordWithin(em, {
        action: `cart.${input.action}`,
        objectType: 'cart',
        objectId: input.cartId,
        ...(input.actorType === 'platform_admin' && input.actorId
          ? { actorAdminUserId: input.actorId }
          : {}),
        ...(input.actorType === 'customer' || input.actorType === 'org_admin'
          ? { impersonatedCustomerAccountId: input.actorId ?? null }
          : {}),
        stateBefore: input.fromState ? { state: input.fromState } : null,
        stateAfter: input.toState ? { state: input.toState } : null,
        ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
      });

      return entry;
    });
  }
}
