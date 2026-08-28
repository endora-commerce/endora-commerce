import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { OrgScoped } from '@endora-commerce/platform/tenancy';

/**
 * OrderPlacementIntent — feature 062 (data-model.md §2).
 *
 * Durable idempotency record for `POST /api/v1/external/orders` (FR-012): one
 * row per `(api_key_id, idempotency_key)` pair. A replay with the same payload
 * fingerprint returns the original order; a different fingerprint is refused
 * (`IDEMPOTENCY_KEY_REUSED`); `pending`/`failed` remnants re-attempt under the
 * per-key Redis intake lock. Rows are permanent order-attribution bookkeeping
 * in v1 (no TTL sweep).
 *
 * Org-scoped (Principle XI): `organizationId` is denormalized from the bound
 * key at insert, so the always-on tenant filter confines every read to the
 * caller's organization.
 */
@OrgScoped()
@Entity({ tableName: 'order_placement_intents' })
@Unique({ properties: ['apiKeyId', 'idempotencyKey'] })
@Index({ properties: ['organizationId', 'createdAt'] })
export class OrderPlacementIntent {
  [OptionalProps]?: 'id' | 'status' | 'orderId' | 'lastError' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  apiKeyId!: string;

  @Property({ type: 'uuid' })
  organizationId!: string;

  /** Caller-supplied `Idempotency-Key` header value (1..128 chars). */
  @Property({ type: 'string', length: 128 })
  idempotencyKey!: string;

  /** SHA-256 hex of the canonicalized request body. */
  @Property({ type: 'string', length: 64, columnType: 'char(64)' })
  payloadFingerprint!: string;

  @Property({ type: 'string', length: 16 })
  status: 'pending' | 'succeeded' | 'failed' = 'pending';

  /** Set when `succeeded`; `ON DELETE SET NULL` at the DB level. */
  @Property({ type: 'uuid', nullable: true })
  orderId?: string | null;

  /** Last failure message (diagnostics; replays re-attempt). */
  @Property({ type: 'text', nullable: true })
  lastError?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
