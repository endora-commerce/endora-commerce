import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { OrgScoped } from '../../../tenancy/org-scoped.decorator.js';

/**
 * Per-Organization credit limit grant. One row per organization (enforced by
 * the migration's unique index). `grantedAmount = 0` is the soft-revoke shape;
 * the row is preserved for audit history.
 *
 * `@OrgScoped` (feature 050): reads are auto-confined to the ambient tenant. The
 * grant/adjust routes additionally gate on org membership because inserts are not
 * reachable by the column filter.
 */
@OrgScoped()
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
