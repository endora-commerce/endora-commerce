import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ScopeRef } from '@endora-commerce/contracts';

/**
 * Feature 172 (`specs/172-product-editor-scope-switcher/` T023, data-model §3–§7) — seed scoped
 * values the way the stores hold them, so a test can stand a product up at any scope without the
 * save Command. One row per call entry; `'empty'` is the empty override (`{"v": null}`, or a role
 * held by no image). Raw SQL on the caller's `em`, so it runs inside the test's transaction.
 *
 * Fields (data-model §9): `name`, `description`, `attribute:<key>` → `product_value_overrides`;
 * `gallery:<itemId>:altText|hidden` → `gallery_item_scope_overrides`; `galleryRole:<label>` →
 * `gallery_role_scope_overrides`; `attachment:<id>:name|description|hidden` →
 * `product_attachment_scope_overrides`; `packagingUnit:<id>:name` →
 * `product_packaging_unit_scope_overrides`; `urlKey` → `product_url_keys`. Global values are the
 * product row's own: write them on the factory, not here.
 */
export interface ScopedValueSeed {
  field: string;
  /** Channel or Channel × language; Global is the product row. */
  scope: Exclude<ScopeRef, { level: 'global' }>;
  value: unknown | 'empty';
}

const languageOf = (scope: ScopedValueSeed['scope']): string | null =>
  scope.level === 'channel_language' ? scope.languageCode : null;

export async function seedScopedValues(em: EntityManager, productId: string, seeds: readonly ScopedValueSeed[]): Promise<void> {
  for (const seed of seeds) {
    const { field, scope } = seed;
    const language = languageOf(scope);
    const wrapped = JSON.stringify({ v: seed.value === 'empty' ? null : seed.value });
    const parts = field.split(':');
    if (field === 'name' || field === 'description' || parts[0] === 'attribute') {
      const key = parts[0] === 'attribute' ? parts.slice(1).join(':') : field;
      await em.execute(
        `insert into product_value_overrides (id, product_id, attribute_key, channel_id, language_code, value, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?::jsonb, now(), now())`,
        [randomUUID(), productId, key, scope.channelId, language, wrapped],
      );
    } else if (parts[0] === 'gallery' && parts.length === 3) {
      await em.execute(
        `insert into gallery_item_scope_overrides (id, gallery_item_id, product_id, sales_channel_id, language_code, field, value, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?::jsonb, now(), now())`,
        [randomUUID(), parts[1], productId, scope.channelId, language, parts[2] === 'altText' ? 'alt_text' : 'hidden', wrapped],
      );
    } else if (parts[0] === 'galleryRole' && parts.length === 2) {
      await em.execute(
        `insert into gallery_role_scope_overrides (id, product_id, sales_channel_id, language_code, label, gallery_item_id, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, now(), now())`,
        [randomUUID(), productId, scope.channelId, language, parts[1], seed.value === 'empty' ? null : seed.value],
      );
    } else if (parts[0] === 'attachment' && parts.length === 3) {
      await em.execute(
        `insert into product_attachment_scope_overrides (id, attachment_id, product_id, sales_channel_id, language_code, field, value, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?::jsonb, now(), now())`,
        [randomUUID(), parts[1], productId, scope.channelId, language, parts[2], wrapped],
      );
    } else if (parts[0] === 'packagingUnit' && parts.length === 3) {
      await em.execute(
        `insert into product_packaging_unit_scope_overrides (id, packaging_unit_id, product_id, sales_channel_id, language_code, field, value, created_at, updated_at)
         values (?, ?, ?, ?, ?, 'name', ?::jsonb, now(), now())`,
        [randomUUID(), parts[1], productId, scope.channelId, language, wrapped],
      );
    } else if (field === 'urlKey') {
      if (seed.value === 'empty') throw new Error('seedScopedValues: the URL key takes no empty value (FR-062).');
      await em.execute(
        `insert into product_url_keys (id, product_id, sales_channel_id, language_code, key, created_at, updated_at)
         values (?, ?, ?, ?, ?, now(), now())`,
        [randomUUID(), productId, scope.channelId, language, seed.value],
      );
    } else {
      throw new Error(`seedScopedValues: no store for field "${field}"`);
    }
  }
}
