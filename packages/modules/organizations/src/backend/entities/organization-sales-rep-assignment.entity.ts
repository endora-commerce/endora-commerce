import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * OrganizationSalesRepAssignment — many-to-many between organizations
 * and admin users with the `sales_representative` role. The presence
 * of any row for an organization switches that organization out of the
 * "unassigned-org fallback" mode (research §R2). An organization with
 * zero rows in this table is visible to every sales rep.
 */
@GlobalEntity()
@Entity({ tableName: 'organization_sales_rep_assignments' })
@Unique({ properties: ['organizationId', 'adminUserId'] })
export class OrganizationSalesRepAssignment {
  [OptionalProps]?: 'id' | 'createdAt' | 'assignedByAdminUserId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  organizationId!: string;

  @Property({ type: 'uuid' })
  @Index()
  adminUserId!: string;

  @Property({ type: 'uuid', nullable: true })
  assignedByAdminUserId?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
