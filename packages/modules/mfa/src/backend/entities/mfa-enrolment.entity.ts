import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * Per-account TOTP enrolment (feature 042). At most one `active` row per
 * subject (enforced by a partial unique index, see migration 067).
 *
 * The subject is polymorphic across the two identity stores
 * (`customer_accounts` / `admin_users`); no DB FK is declared to those tables
 * to keep the `mfa` module isolated (Constitution Principle I). The TOTP
 * secret is stored encrypted at rest (AES-256-GCM); the plaintext base32
 * secret never touches the database.
 */
@GlobalEntity()
@Entity({ tableName: 'mfa_enrolments' })
export class MfaEnrolment {
  [OptionalProps]?:
    | 'id'
    | 'status'
    | 'lastAcceptedStep'
    | 'confirmedAt'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** `'customer'` | `'admin'`. */
  @Property({ type: 'string', length: 16 })
  @Index()
  subjectType!: string;

  /** `customer_accounts.id` or `admin_users.id` — service-enforced, no DB FK. */
  @Property({ type: 'uuid' })
  @Index()
  subjectId!: string;

  /** `'pending'` (setup started, unconfirmed) | `'active'`. */
  @Property({ type: 'string', length: 16 })
  status: string = 'pending';

  /** AES-256-GCM ciphertext of the base32 TOTP secret. */
  @Property({ type: 'bytea' })
  secretCiphertext!: Buffer;

  /** GCM initialisation vector (per row). */
  @Property({ type: 'bytea' })
  secretIv!: Buffer;

  /** GCM authentication tag. */
  @Property({ type: 'bytea' })
  secretAuthTag!: Buffer;

  /** Last accepted TOTP time-step — guards against in-window replay. */
  @Property({ type: 'bigint', nullable: true })
  lastAcceptedStep?: string | null;

  @Property({ type: 'datetime', nullable: true })
  confirmedAt?: Date | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
