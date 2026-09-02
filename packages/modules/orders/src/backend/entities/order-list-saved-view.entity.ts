import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * OrderListSavedView — feature 038 (US2).
 *
 * A named, reusable filter + sort preset for the admin orders list, owned by an
 * Admin UI user. `shared = true` makes it visible to every user with access to
 * the orders list; edit/delete of a shared view is restricted to its owner (and
 * platform admins) in the service.
 */
@GlobalEntity()
@Entity({ tableName: 'order_list_saved_views' })
export class OrderListSavedView {
  [OptionalProps]?: 'id' | 'shared' | 'createdAt' | 'updatedAt' | 'visibleColumns';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  ownerAdminUserId!: string;

  @Property({ type: 'string', length: 160 })
  name!: string;

  @Property({ type: 'boolean' })
  shared: boolean = false;

  /** Serialized filter state (status, channel, org, free-text q). */
  @Property({ type: 'json' })
  filters!: Record<string, unknown>;

  /** Serialized sort: { field, dir }. */
  @Property({ type: 'json' })
  sort!: { field: string; dir: 'asc' | 'desc' };

  /**
   * Column-picker selection (ordered list of column ids). `null` ⇒ the client
   * falls back to its default-visible set. Nullable for backward compatibility
   * with views saved before the column picker shipped.
   */
  @Property({ type: 'json', nullable: true })
  visibleColumns: string[] | null = null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
