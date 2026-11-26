import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * QuoteRequestListSavedView — `specs/147-saved-views/` (US3).
 *
 * A named preset of the admin Quote Request list's filters (`scope`,
 * `organizationId`, `status`, `q`), sort and visible columns, owned by an admin
 * user. `shared = true` makes it visible to every admin who opens the list;
 * modifying or deleting a shared view is restricted to its owner and platform
 * admins in the service.
 *
 * Platform-global for the tenancy guard: a view holds filter values, never
 * list results, and is an admin's personal configuration rather than
 * organization-owned data. Loading it re-runs the organization-scoped list read
 * for whoever loads it (FR-016).
 *
 * The migration's unique expression index on
 * `(owner_admin_user_id, lower(name))` is not declared here: it is DDL the
 * service never relies on by name, and it also serves the owner lookup.
 */
@GlobalEntity()
@Entity({ tableName: 'quote_request_list_saved_views' })
export class QuoteRequestListSavedView {
  [OptionalProps]?: 'id' | 'shared' | 'filters' | 'sort' | 'visibleColumns' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  ownerAdminUserId!: string;

  /** Stored trimmed, 1–160 characters. */
  @Property({ type: 'string', length: 160 })
  name!: string;

  @Property({ type: 'boolean' })
  shared: boolean = false;

  /** The Quote Request list's captured filters. */
  @Property({ type: 'json' })
  filters: Record<string, unknown> = {};

  /** `{ field, dir }`; `null` ⇒ the list's default sort. */
  @Property({ type: 'json', nullable: true })
  sort: { field: string; dir: 'asc' | 'desc' } | null = null;

  /** Column ids; `null` ⇒ the list's default-visible columns. */
  @Property({ type: 'json', nullable: true })
  visibleColumns: string[] | null = null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
