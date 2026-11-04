import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Command, CommandEvent } from '@endora-commerce/platform/commands';

import type { CatalogEvents } from '../services/catalog-admin.service.js';
import {
  summarisePageBuilderDocument,
  type PageBuilderDocumentSummary,
  type PageBuilderEnvelope,
} from '../services/page-builder-content.js';

/**
 * `product.content.update` — replace one product × content attribute value
 * (feature 172, `specs/172-product-content-attributes/` data-model §5,
 * research R-9).
 *
 * The caller has already judged the request: the product exists and is not
 * deleted, the attribute is a Page Builder content attribute of the product's
 * current set, and the envelope is normalised and within the ceiling. This
 * Command only writes — an upsert of the one row, or its deletion when the
 * normalised envelope is `null` (FR-013) — and touches nothing else of the
 * product (spec edge case: the product form and the content never write each
 * other).
 *
 * The audit row records **which languages** the value held before and after,
 * never the documents (FR-024): a document may weigh a mebibyte. Its event is
 * `product.content.updated.v1`, not `product.updated.v1`: the latter is what
 * `search` re-indexes a product on, and a paragraph of a buying guide is on no
 * product document (FR-035).
 */

export interface ProductContentWrite {
  productId: string;
  /** `product_attributes.id` of the content attribute. */
  productAttributeId: string;
  attributeKey: string;
  /** The normalised envelope; `null` removes the value. */
  content: PageBuilderEnvelope | null;
}

/** The languages a value holds — what the audit row records of it. */
function languagesOf(content: PageBuilderEnvelope | null): string[] {
  return Object.keys(content?.languages ?? {}).sort();
}

/** The per-language summary the product form's card reads (research R-3). */
function summaryOf(content: PageBuilderEnvelope): Record<string, PageBuilderDocumentSummary> {
  return Object.fromEntries(
    Object.entries(content.languages).map(([language, document]) => [
      language,
      summarisePageBuilderDocument(document),
    ]),
  );
}

function productContentUpdatedEvent(
  productId: string,
  attributeKey: string,
): CommandEvent<CatalogEvents['product.content.updated.v1']> {
  return {
    eventName: 'product.content.updated.v1',
    payload: {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      productId,
      attributeKey,
    },
  };
}

/**
 * The write itself, on the Command's own transaction. An upsert rather than a
 * read-then-insert, so two operators saving the same attribute at once both
 * succeed and the later save wins (spec edge case), instead of the second one
 * failing on the unique pair. The "before" languages are read from `summary`,
 * whose keys are the stored languages, so the document itself is never loaded.
 */
async function writeContent(em: EntityManager, write: ProductContentWrite): Promise<string[]> {
  const rows = await em.execute<Array<{ summary: Record<string, unknown> | null }>>(
    `select summary from product_content_values where product_id = ? and product_attribute_id = ?`,
    [write.productId, write.productAttributeId],
  );
  const before = Object.keys(rows[0]?.summary ?? {}).sort();
  if (write.content === null) {
    await em.execute(`delete from product_content_values where product_id = ? and product_attribute_id = ?`, [
      write.productId,
      write.productAttributeId,
    ]);
    return before;
  }
  await em.execute(
    `insert into product_content_values (id, product_id, product_attribute_id, content, summary, created_at, updated_at)
     values (?, ?, ?, ?::jsonb, ?::jsonb, now(), now())
     on conflict (product_id, product_attribute_id)
     do update set content = excluded.content, summary = excluded.summary, updated_at = now()`,
    [
      randomUUID(),
      write.productId,
      write.productAttributeId,
      JSON.stringify(write.content),
      JSON.stringify(summaryOf(write.content)),
    ],
  );
  return before;
}

export function updateProductContentCommand(write: ProductContentWrite): Command<PageBuilderEnvelope | null> {
  return {
    action: 'product.content.update',
    objectType: 'product',
    objectId: write.productId,
    run: async ({ em }) => {
      const before = await writeContent(em, write);
      return {
        result: write.content,
        before: { attributeKey: write.attributeKey, languages: before },
        after: { attributeKey: write.attributeKey, languages: languagesOf(write.content) },
      };
    },
    event: () => productContentUpdatedEvent(write.productId, write.attributeKey),
  };
}
