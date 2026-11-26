import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * AdminUserPreference — feature 164.
 *
 * One of the signed-in administrator's own Admin UI preferences: the sidebar's
 * pins, its folded groups, rail mode, or the page size of each list. One row per
 * (admin, preference); `preferenceKey` is one of `ADMIN_PREFERENCE_KEYS`
 * (`@endora-commerce/contracts`) and `value` holds that key's shape.
 *
 * Platform-global: an administrator is a platform-side user, read only by
 * themselves, and a row holds destinations, group keys, list ids and numbers —
 * never business or tenant data (FR-021).
 *
 * Written through `AdminPreferenceService` on raw statements (upsert and a row
 * lock), not through this class; the entity exists so the schema is registered.
 */
@GlobalEntity()
@Entity({ tableName: 'admin_user_preferences' })
export class AdminUserPreference {
  [OptionalProps]?: 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  adminUserId!: string;

  @PrimaryKey({ type: 'string', length: 64 })
  preferenceKey!: string;

  @Property({ type: 'json' })
  value!: unknown;

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
