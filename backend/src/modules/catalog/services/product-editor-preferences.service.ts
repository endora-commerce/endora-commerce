import type { EntityManager } from '@mikro-orm/postgresql';
import { ProductEditorPreference } from '../entities/product-editor-preference.entity.js';

/**
 * Feature 022 — per-(admin user, product) memory of the last
 * Sales Channel + Language the editor selected on the product edit
 * page. Read on page load to seed the switchers; upserted on
 * switcher change.
 */
export class ProductEditorPreferencesService {
  constructor(private readonly emFactory: () => EntityManager) {}

  /** Fetch the editor's last-selected context for this product. */
  async find(
    adminUserId: string,
    productId: string,
  ): Promise<ProductEditorPreference | null> {
    const em = this.emFactory();
    return em.findOne(ProductEditorPreference, { adminUserId, productId });
  }

  /** Idempotent upsert. Returns the post-write row. */
  async upsert(
    adminUserId: string,
    productId: string,
    fields: {
      lastChannelId: string | null;
      lastLanguageCode: string | null;
    },
  ): Promise<ProductEditorPreference> {
    // command-coverage-ignore: per-admin UI editor state (last-selected channel +
    // language on the product edit page) — a personal preference, not a catalog
    // domain mutation, so it is not an admin-audit target.
    const em = this.emFactory();
    const existing = await em.findOne(ProductEditorPreference, {
      adminUserId,
      productId,
    });
    if (existing) {
      existing.lastChannelId = fields.lastChannelId;
      existing.lastLanguageCode = fields.lastLanguageCode;
      await em.flush();
      return existing;
    }
    const row = em.create(ProductEditorPreference, {
      adminUserId,
      productId,
      lastChannelId: fields.lastChannelId,
      lastLanguageCode: fields.lastLanguageCode,
    });
    await em.persistAndFlush(row);
    return row;
  }
}
