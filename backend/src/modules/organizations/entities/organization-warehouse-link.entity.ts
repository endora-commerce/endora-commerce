import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { OrgScoped } from '../../../tenancy/org-scoped.decorator.js';

/**
 * Per-Organization warehouse assignment.
 *
 * Empty set ⇒ the platform default warehouses apply (FR-016). A non-empty
 * set means "this Organization sees stock only from these warehouses and
 * order reservations only debit these warehouses".
 */
@OrgScoped()
@Entity({ tableName: 'organization_warehouses' })
export class OrganizationWarehouseLink {
  [OptionalProps]?: 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  organizationId!: string;

  @PrimaryKey({ type: 'uuid' })
  warehouseId!: string;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();
}
