import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A saved filter of the Opportunities page (issue #1734), the feature-147
 * model: an administrator's own row, optionally shared. One view serves the
 * list and the board, as the page's address does. Unique per owner on
 * `lower(name)`, by an index the migration creates. A per-administrator row,
 * not tenant data, so it carries no Organization.
 */
@GlobalEntity()
@Entity({ tableName: 'crm_opportunity_list_saved_views' })
export class CrmOpportunityListSavedView {
  [OptionalProps]?: 'id' | 'shared' | 'filters' | 'sort' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  ownerAdminUserId!: string;

  @Property({ type: 'string', length: 160 })
  name!: string;

  @Property({ type: 'boolean' })
  shared: boolean = false;

  /** At most 8 KB (a database check). */
  @Property({ type: 'json' })
  filters: Record<string, unknown> = {};

  /** `{ field, dir }`; `null` ⇒ the list's default sort. */
  @Property({ type: 'json', nullable: true })
  sort?: { field: string; dir: 'asc' | 'desc' } | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
