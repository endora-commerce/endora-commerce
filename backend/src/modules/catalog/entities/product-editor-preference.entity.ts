import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/**
 * ProductEditorPreference — feature 022.
 *
 * Per-(admin user, product) memory of the last Sales Channel + Language
 * the editor selected on the product edit page. Read on page load to
 * seed the switchers, upserted (debounced) on every successful render
 * and on every switcher change.
 *
 * `lastChannelId` NULL means "Global / no channel".
 * `lastLanguageCode` NULL means "use platform's primary admin
 * language" — the page resolves the actual default at render time
 * rather than baking a stale code into the row.
 *
 * No FK on `lastChannelId` to `sales_channels` — the preference is
 * best-effort. If a remembered channel has been un-assigned from the
 * product (or deleted) by the time the editor returns, the page falls
 * back to Global on its own and the next save overwrites the row.
 */
@GlobalEntity()
@Entity({ tableName: 'product_editor_preferences' })
export class ProductEditorPreference {
  [OptionalProps]?: 'updatedAt' | 'lastChannelId' | 'lastLanguageCode';

  @PrimaryKey({ type: 'uuid' })
  adminUserId!: string;

  @PrimaryKey({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'uuid', nullable: true })
  lastChannelId?: string | null;

  @Property({ type: 'string', length: 16, nullable: true })
  lastLanguageCode?: string | null;

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
