# Contract: storefront API and the product page

## 1. `GET /api/v1/catalog/products/:idOrSlug` (changed, additive)

Owner `catalog`, `routes.public.ts`. New query parameter, parsed by `productDetailQuerySchema`:

| `include` | Response |
| --- | --- |
| absent | **byte-identical to today** — no `contentAttributes` key |
| `content` | `data.contentAttributes: Array<{ key: string; language: string; content: PageBuilderTree }>` |
| anything else | `400 VALIDATION_FAILED` |

`contentAttributes` semantics (FR-030, FR-033, FR-036, FR-051, FR-061):

1. Computed **after** `getProductByIdOrSlug` resolved the product for the request's channel,
   language, audience and organisation — a product the caller may not see is `404`/`410` exactly
   as today, and no content is read for it.
2. Candidates: rows of `product_content_values` for the product whose attribute is a
   `page_builder` member of the product's **current** attribute set. A product without a set → `[]`.
3. Per candidate, the language is the first of: `ctx.preferredLanguage`,
   `ctx.resolvedChannel.defaultLanguage`, `'en-US'`, `'en'`, then every stored language — skipping
   one whose document has no block (`resolvePageBuilderLanguage`, shared with category content).
   A candidate with no such language is omitted.
4. Order: `attribute_set_attributes.position` ascending, ties by attribute key ascending.
5. `[]` whenever `effectiveState.isPresent('cms')` is false; stored rows untouched.
6. No label is carried and none is rendered (OR-4, FR-037).

Not carried by: `/api/v1/external/catalog/products/:idOrSlug` (FR-042), the product list
(`/api/v1/catalog/products`), `/products/:idOrSlug/links`, bundle validation, or any port.

Caching: the response's cache headers are today's (`markPersonalisedPricing`). The storefront
reads it under the same per-product tags (`productCacheTags`), so `product.content.updated.v1` →
`ProductPageRevalidation.productChanged` drops it (FR-035).

## 2. Storefront data access

`storefront/lib/api/catalog.ts`:

```ts
export async function getProductBySlug(
  slug: string,
  ctx: RequestContext,
  options?: { include?: readonly 'content'[] },
): Promise<ProductDetail>;
```

Only `productById` (`app/(catalog)/p/[slug]/resolution.ts`) passes `{ include: ['content'] }`.
`generateMetadata`, shopping lists, block data and draft minimums keep calling without it.

## 3. Product page tabs (`app/(catalog)/p/[slug]/page.tsx`)

Tab construction moves to `storefront/lib/catalog/product-tabs.ts`:

```ts
export interface ProductTabPlan {
  description: { text: string | null; content: ProductPageContentAttribute[] } | null; // "Opis"
  parameters: VisibleAttribute[] | null;                                               // "Parametry"
  attachments: number | null;
}
export function productTabPlan(
  product: Pick<ProductDetail, 'description' | 'visibleAttributes' | 'contentAttributes' | 'attachments'>,
  presence: { pageBuilderPresent: boolean; absentModuleIds: readonly string[] },
): ProductTabPlan;
```

| Tab | Shown when | Holds |
| --- | --- | --- |
| "Opis" (`product.tabs.description`) | non-empty `description` **or** ≥ 1 drawable content attribute | the description paragraph (unchanged markup), then each content attribute in the order received, each through `ProductContent` → `PageBuilderRender` with its `language`; no heading of its own |
| "Parametry" (`product.tabs.parameters`) | `visibleAttributes` non-empty | `ParametryTab` only — the raw `attributeValues` table is removed |
| "Załączniki" | unchanged | unchanged |

- **Drawable** (research R-20 (4)): `pageBuilderPresent` (= `modules.isPresent('cms')`) is true,
  and at least one top-level block of the document either has no owner segment or names an owner
  not in `absentModuleIds`.
- Server-rendered: `PageBuilderRender` is a client boundary that SSRs (Principle VII, SC-007); the
  content is in the HTML as served.
- Variants: selecting `?variant=` changes nothing in "Opis" (content is product-level).
- No new storefront string: the tab labels exist; OR-4 forbids a heading.

## 4. Components

| File | Role |
| --- | --- |
| `storefront/components/catalog/ProductContent.tsx` | twin of `components/CategoryContent.tsx`: `hasBlocks` guard, `<div data-product-content={key}>`, `PageBuilderRender` |
| `storefront/components/catalog/ProductDescriptionPanel.tsx` | description `<p>` then the list of `ProductContent` |
| `storefront/lib/catalog/product-tabs.ts` | the pure plan above |
