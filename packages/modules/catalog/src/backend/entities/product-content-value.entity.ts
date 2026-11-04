import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import type { PageBuilderDocumentSummary, PageBuilderEnvelope } from '../services/page-builder-content.js';

/**
 * ProductContentValue — feature 172 (`specs/172-product-content-attributes/`
 * data-model.md §2, research R-1).
 *
 * One product × content attribute value: a Page Builder document per language
 * (`content`) and the per-language summary the product form's card reads
 * (`summary`, research R-3). Kept apart from `products.attribute_values` so no
 * reader of ordinary values ever meets a document (FR-011).
 *
 * `content` always holds at least one language with a block: the writer
 * normalises the envelope and deletes the row when nothing remains (FR-013,
 * R-2). `summary` is derived from `content` on every write and written by
 * nobody else.
 *
 * Platform-global like `Product` and `ProductAttribute` (Principle XI is met by
 * the product read path that precedes every content read, research R-11). A
 * soft-deleted product's rows stay and are unreachable (OR-6): every read
 * requires the product's `deleted_at is null`.
 */
@GlobalEntity()
@Entity({ tableName: 'product_content_values' })
export class ProductContentValue {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'summary';

  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  productId!: string;

  /** `product_attributes.id` — the catalogue's own extension row, not the `custom_fields` definition. */
  @Property({ type: 'uuid' })
  productAttributeId!: string;

  /**
   * `lazy`, and that is load-bearing (research R-3): a document may weigh up to
   * `PAGE_BUILDER_CONTENT_MAX_BYTES`, and the product form's card list reads
   * `summary` only. A read that wants the documents asks for them with
   * `populate: ['content']`.
   */
  @Property({ type: 'json', lazy: true })
  content!: PageBuilderEnvelope;

  @Property({ type: 'json' })
  summary: Record<string, PageBuilderDocumentSummary> = {};

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
