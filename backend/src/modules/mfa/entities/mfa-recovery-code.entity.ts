import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * Single-use backup code for a TOTP enrolment (feature 042). Stored only as a
 * SHA-256 hash; the plaintext is shown once at activation/regeneration.
 * Cascade-deleted with its parent enrolment (FK declared in migration 067).
 */
@GlobalEntity()
@Entity({ tableName: 'mfa_recovery_codes' })
export class MfaRecoveryCode {
  [OptionalProps]?: 'id' | 'usedAt' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  enrolmentId!: string;

  /** SHA-256 hex of the plaintext recovery code. */
  @Property({ type: 'string', length: 128 })
  codeHash!: string;

  /** Set when the code is consumed; a used code is never re-accepted. */
  @Property({ type: 'datetime', nullable: true })
  usedAt?: Date | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
