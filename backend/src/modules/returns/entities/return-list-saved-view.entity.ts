import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * ReturnListSavedView — feature 046 (US8).
 *
 * A reusable admin returns-list preset (filters + sort + visible columns),
 * private to its owner or shared with everyone with list access. Mirrors
 * `order_list_saved_views`.
 */
@GlobalEntity()
@Entity({ tableName: 'return_list_saved_views' })
export class ReturnListSavedView {
  [OptionalProps]?: 'id' | 'shared' | 'visibleColumns' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  ownerAdminUserId!: string;

  @Property({ type: 'string', length: 200 })
  name!: string;

  @Property({ type: 'boolean' })
  shared: boolean = false;

  @Property({ type: 'json' })
  filters!: Record<string, unknown>;

  @Property({ type: 'json' })
  sort!: { field: string; dir: 'asc' | 'desc' };

  @Property({ type: 'json', nullable: true })
  visibleColumns?: string[] | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
