import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * Row in the audit log of sensitive operations (FR-084, R-12).
 * Never soft-deleted — accounting + audit retention ≥ 5 years per spec assumptions.
 */
@Entity({ tableName: 'audit_log_entries' })
export class AuditLogEntry {
  [OptionalProps]?: 'id' | 'actedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** The Admin User who performed the action. Null for system-initiated entries. */
  @Property({ type: 'uuid', nullable: true })
  @Index()
  actorAdminUserId?: string | null;

  /**
   * The Customer Account being acted upon by the Admin User during Impersonation (R-12).
   * Non-null entries describe operations performed on behalf of the Customer.
   */
  @Property({ type: 'uuid', nullable: true })
  @Index()
  impersonatedCustomerAccountId?: string | null;

  @Property()
  @Index()
  actedAt: Date = new Date();

  /**
   * Screaming-snake-case action identifier, e.g. `price.update`, `permission.change`,
   * `credit_limit.adjust`, `impersonation.start`, `impersonation.end`.
   */
  @Property({ length: 120 })
  @Index()
  action!: string;

  /** Polymorphic pointer to the affected entity. */
  @Property({ length: 120 })
  objectType!: string;

  @Property({ length: 120 })
  @Index()
  objectId!: string;

  /** Diff-friendly snapshot of the affected fields before the mutation. */
  @Property({ type: 'json', nullable: true })
  stateBefore?: Record<string, unknown> | null;

  @Property({ type: 'json', nullable: true })
  stateAfter?: Record<string, unknown> | null;

  @Property({ length: 45, nullable: true })
  ipAddress?: string | null;

  @Property({ length: 255, nullable: true })
  userAgent?: string | null;

  /** Correlation id from the inbound request (X-Request-Id). */
  @Property({ length: 64, nullable: true })
  requestId?: string | null;
}
