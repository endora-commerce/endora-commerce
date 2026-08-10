import type { EntityManager } from '@mikro-orm/postgresql';
import { CartAuditEntry } from '../entities/cart-audit-entry.entity.js';
import type {
  CartAuditAction,
  CartAuditActorType,
} from '../entities/cart-audit-entry.entity.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';

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
    private readonly auditLog: AuditLogService,
  ) {}

  async record(input: CartAuditRecordInput): Promise<CartAuditEntry> {
    const em = this.emFactory();

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

    await this.auditLog.record({
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

    await em.flush();
    return entry;
  }
}
