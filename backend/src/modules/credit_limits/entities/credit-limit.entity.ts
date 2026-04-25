import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * Per-Organization credit limit grant. One row per organization (enforced by
 * the migration's unique index). `grantedAmount = 0` is the soft-revoke shape;
 * the row is preserved for audit history.
 */
@Entity({ tableName: 'credit_limits' })
export class CreditLimit {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'grantedByAdminUserId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  organizationId!: string;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  grantedAmount!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'uuid', nullable: true })
  grantedByAdminUserId?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
