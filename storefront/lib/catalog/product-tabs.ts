import type { ProductDetail, ProductPageContentAttribute } from '@endora-commerce/contracts';

/**
 * Feature 172 (research R-18) — which detail tabs a product page shows, and
 * what each holds, decided by one pure function so the decisions can be
 * pinned without rendering the page (`test/catalog/product-tabs.test.ts`).
 * `app/(catalog)/p/[slug]/page.tsx` draws exactly what this answers.
 */

/** One row of "Parametry produktu" — the backend's `visibleAttributes` projection. */
export type ProductTabVisibleAttribute = NonNullable<ProductDetail['visibleAttributes']>[number];

/**
 * The part of the product detail the plan reads. Not `attributeValues`: that
 * is every stored value, hidden attributes included, keyed by technical key —
 * "Parametry" draws only the backend's `visibleAttributes` projection (US4).
 * `contentAttributes` is present when the page asked for it
 * (`?include=content`), already resolved to one language each (US3).
 */
export type ProductTabSource = Pick<
  ProductDetail,
  'description' | 'visibleAttributes' | 'attachments' | 'contentAttributes'
>;

/**
 * What the request's module presence says about drawing a Page Builder
 * document here (research R-13, R-20 (4)).
 */
export interface ProductTabPresence {
  /** Whether the module that owns the Page Builder is present; without it no content is drawn (FR-051). */
  pageBuilderPresent: boolean;
  /** The modules reported switched off, whose blocks the render boundary draws as nothing. */
  absentModuleIds: readonly string[];
}

export interface ProductTabPlan {
  /** "Opis": the plain description, then the content attributes in the order received. `null` = no tab. */
  description: { text: string | null; content: ProductPageContentAttribute[] } | null;
  /**
   * "Parametry": the attributes marked visible on the product page that hold a
   * value (FR-038). `null` = no tab — shown only when there is at least one
   * (FR-039), so a product whose only values are hidden ones has none.
   */
  parameters: ProductTabVisibleAttribute[] | null;
  /** "Załączniki": how many attachments. `null` = no tab. */
  attachments: number | null;
}

/**
 * Whether a content attribute would draw anything on this page (research R-20
 * (4)): the Page Builder is present, and at least one top-level block either
 * has no owner segment — a base block — or names an owner (`<moduleId>.<Name>`)
 * that is not switched off. The same owner rule the storefront's Page Builder
 * config applies, so a document of switched-off modules' blocks does not, on
 * its own, make an otherwise empty "Opis" appear.
 */
function isDrawable(attribute: ProductPageContentAttribute, presence: ProductTabPresence): boolean {
  if (!presence.pageBuilderPresent) return false;
  const blocks = (attribute.content as { content?: unknown })['content'];
  if (!Array.isArray(blocks)) return false;
  const absent = new Set(presence.absentModuleIds);
  return blocks.some((block) => {
    const type = (block as { type?: unknown } | null)?.type;
    if (typeof type !== 'string') return false;
    const separator = type.indexOf('.');
    return separator <= 0 || !absent.has(type.slice(0, separator));
  });
}

export function productTabPlan(product: ProductTabSource, presence: ProductTabPresence): ProductTabPlan {
  const visibleAttributes = product.visibleAttributes ?? [];
  const attachmentCount = product.attachments?.length ?? 0;
  // FR-030 / FR-031 — "Opis" holds the description, then each drawable content
  // attribute in the order the backend sent (set position, then key); it is
  // shown when either is there. Content is never a "Parametry" row (FR-032).
  const content = (product.contentAttributes ?? []).filter((attribute) => isDrawable(attribute, presence));
  const text = product.description ? product.description : null;
  return {
    description: text !== null || content.length > 0 ? { text, content } : null,
    parameters: visibleAttributes.length > 0 ? visibleAttributes : null,
    attachments: attachmentCount > 0 ? attachmentCount : null,
  };
}
