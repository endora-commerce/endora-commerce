import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import type { OrderTransitionEffectKind } from '@endora-commerce/contracts';
import { OrgScoped } from '@endora-commerce/platform/tenancy';

/** Why a follow-up is owed: the transition that created the obligation. */
export type OrderTransitionEffectReason = 'order_cancelled' | 'invoice_paid';

/** Who wrote the row: a live transition, or the operator's repair command. */
export type OrderTransitionEffectOrigin = 'transition' | 'repair';

/**
 * OrderTransitionEffect — one follow-up one order transition owes
 * (`specs/142-order-transition-atomicity/`, data model).
 *
 * Cancelling an order owes the release of its stock allocations and, when it
 * was placed against a credit limit, of its credit reservation; marking such an
 * order paid owes the credit release. The row is written **in the transaction
 * that writes the status**, so a status can never exist without the record of
 * what it owes, and it stays until the release has completed — across a failed
 * attempt, a restart, and a module being switched off and on again.
 *
 * `completedAt` is the only terminal state. There is no "gave up": an
 * outstanding row is retried with a capped back-off for as long as it is
 * outstanding (`OrderTransitionEffectService`).
 *
 * The partial unique index — at most one **outstanding** row per order and
 * effect — is declared by the migration, not here: MikroORM's `@Unique` cannot
 * express a `where` clause, and the migration is the schema's source of truth.
 *
 * Org-scoped (Principle XI): `organizationId` is copied from the order at
 * insert, so the always-on tenant filter confines every ORM read to the
 * caller's organization. The background sweep and the repair command run under
 * a system scope and say so.
 */
@OrgScoped()
@Entity({ tableName: 'order_transition_effects' })
@Index({ properties: ['orderId'] })
export class OrderTransitionEffect {
  [OptionalProps]?:
    | 'id'
    | 'attempts'
    | 'nextAttemptAt'
    | 'blockedOn'
    | 'lastError'
    | 'lastAttemptAt'
    | 'result'
    | 'completedAt'
    | 'claimedUntil'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  organizationId!: string;

  @Property({ type: 'uuid' })
  orderId!: string;

  @Property({ type: 'text' })
  effect!: OrderTransitionEffectKind;

  @Property({ type: 'text' })
  reason!: OrderTransitionEffectReason;

  @Property({ type: 'text' })
  origin!: OrderTransitionEffectOrigin;

  /** Failed attempts only. A pass that found the owning module absent is not one. */
  @Property({ type: 'integer' })
  attempts: number = 0;

  @Property({ type: 'datetime' })
  nextAttemptAt: Date = new Date();

  /** The module last found absent, while the row waits for it; `null` otherwise. */
  @Property({ type: 'text', nullable: true })
  blockedOn?: string | null;

  /** The last failure's message, truncated. Never a stack. */
  @Property({ type: 'text', nullable: true })
  lastError?: string | null;

  @Property({ type: 'datetime', nullable: true })
  lastAttemptAt?: Date | null;

  /** What the owner answered when the release completed. */
  @Property({ type: 'json', nullable: true })
  result?: Record<string, unknown> | null;

  @Property({ type: 'datetime', nullable: true })
  completedAt?: Date | null;

  /**
   * The lease of the attempt in flight, if any: nobody else attempts the row
   * until it passes. Cleared when the attempt records its outcome.
   */
  @Property({ type: 'datetime', nullable: true })
  claimedUntil?: Date | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
