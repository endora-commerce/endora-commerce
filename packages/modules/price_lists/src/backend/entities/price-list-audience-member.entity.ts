import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/**
 * One member of a price book's audience set (feature 160, D-287 §5.1, research
 * R3): an organization or a customer group, never both — the CHECK
 * `price_list_audience_members_one_member_check` holds it, and the service holds
 * that every member of a book is of the book's `audienceKind` (FR-002, A4).
 *
 * **`@RuleScoped()`**, as the book is: the member *is* the price coordinate a
 * buyer is matched on, so a storefront read filters by the buyer's own chain and
 * effective group in its `where` clause rather than by a tenant column
 * (Principle XI, data-model §10). Both foreign keys cascade, so a permanently
 * deleted organization or group leaves every set it was in.
 */
@RuleScoped()
@Entity({ tableName: 'price_list_audience_members' })
@Index({ properties: ['organizationId', 'priceListId'], name: 'price_list_audience_members_org_idx' })
@Index({ properties: ['customerGroupId', 'priceListId'], name: 'price_list_audience_members_group_idx' })
export class PriceListAudienceMember {
  [OptionalProps]?: 'id' | 'organizationId' | 'customerGroupId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  priceListId!: string;

  @Property({ type: 'uuid', nullable: true })
  organizationId: string | null = null;

  @Property({ type: 'uuid', nullable: true })
  customerGroupId: string | null = null;
}
