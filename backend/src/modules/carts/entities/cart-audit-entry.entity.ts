import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * One audit row on a cart's typed feed (feature 027). Backs the cart-
 * detail-page audit panel for both Org-Admin and platform-admin views.
 *
 * Companion to `audit_log_entries` — every cart-state transition also
 * lands a row there via AuditLogService.record(...), so the platform-wide
 * audit timeline stays whole. Splitting the two tables keeps the cart UI
 * tight (typed `from_state` / `to_state` / `metadata`) without bloating
 * the generic audit feed.
 */
@Entity({ tableName: 'cart_audit_entries' })
export class CartAuditEntry {
  [OptionalProps]?:
    | 'id'
    | 'occurredAt'
    | 'actorId'
    | 'fromState'
    | 'toState'
    | 'reason'
    | 'metadata';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  cartId!: string;

  @Property({ type: 'datetime' })
  occurredAt: Date = new Date();

  @Property({ type: 'string', length: 32 })
  actorType!: CartAuditActorType;

  @Property({ type: 'uuid', nullable: true })
  actorId?: string | null;

  @Property({ type: 'string', length: 64 })
  action!: CartAuditAction;

  @Property({ type: 'string', length: 32, nullable: true })
  fromState?: string | null;

  @Property({ type: 'string', length: 32, nullable: true })
  toState?: string | null;

  @Property({ type: 'text', nullable: true })
  reason?: string | null;

  @Property({ type: 'json' })
  metadata: Record<string, unknown> = {};
}

export type CartAuditActorType =
  | 'customer'
  | 'org_admin'
  | 'platform_admin'
  | 'system'
  | 'sweep';

export const CART_AUDIT_ACTOR_TYPES: readonly CartAuditActorType[] = [
  'customer',
  'org_admin',
  'platform_admin',
  'system',
  'sweep',
] as const;

export type CartAuditAction =
  | 'status_changed'
  | 'approval_submitted'
  | 'approval_approved'
  | 'approval_rejected'
  | 'approval_policy_reset'
  | 'approval_resubmission_required'
  | 'coupon_applied'
  | 'coupon_dropped'
  | 'converted_to_qr'
  | 'created_from_qr'
  | 'created_from_shopping_list'
  | 'admin_rejected'
  | 'abandonment_swept'
  | 'abandonment_reactivated'
  | 'line_added'
  | 'line_removed'
  | 'line_qty_changed'
  | 'cart_merged_from_anon';

export const CART_AUDIT_ACTIONS: readonly CartAuditAction[] = [
  'status_changed',
  'approval_submitted',
  'approval_approved',
  'approval_rejected',
  'approval_policy_reset',
  'approval_resubmission_required',
  'coupon_applied',
  'coupon_dropped',
  'converted_to_qr',
  'created_from_qr',
  'created_from_shopping_list',
  'admin_rejected',
  'abandonment_swept',
  'abandonment_reactivated',
  'line_added',
  'line_removed',
  'line_qty_changed',
  'cart_merged_from_anon',
] as const;
