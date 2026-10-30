# Contract: `seo` — product metadata read port, write port, admin section, relaxed read

Owner: `seo`. Types in `packages/contracts/src/seo.ts`. Decision and security review: research R9.

## 1. `SeoProductMetaPort` (existing name `seoProductMetaPort`, rewritten)

```ts
export type SeoProductMetaField = 'title' | 'description' | 'ogTitle' | 'ogDescription' | 'ogImageUrl';
export interface SeoProductMetaPort {
  /** Storefront: effective values at (C, L) along C×L → C → G, then the caller's derived fallback. */
  resolveForProduct(input: { productId; channelId; languageCode; fallback: SeoProductMetaValues }):
    Promise<SeoProductMetaValues & { sources: Record<SeoProductMetaField, ScopedSource | 'derived'> }>;
  /** Admin: each field's ScopedFieldView at one scope (G, C or C×L). */
  readScoped(productId: string, scope: ScopeRef): Promise<Record<SeoProductMetaField, ScopedFieldView<string>>>;
  /** Overview: every scope holding a product row (no Language-only scope any more). */
  listScopesForProduct(productId: string):
    Promise<Array<{ channelId: string | null; languageCode: string | null; fields: SeoProductMetaField[] }>>;
}
```

The `L` step and the `locale`-only address are removed. Catalog keeps resolving the port only after
`effectiveState.isPresent('seo')` (163 edge, `degrades-without`, unchanged wording plus "the SEO section of the
product editor is absent").

## 2. `SeoProductMetaWritePort<EM>` (new, `seoProductMetaWritePort`)

```ts
export interface SeoProductMetaWritePort<EM = unknown> {
  /** Current own values of the named fields at `scope`, for the caller's audit before-state. */
  readWithin(em: EM, input: { productId; scope: ScopeRef; fields: SeoProductMetaField[] }):
    Promise<Record<SeoProductMetaField, { own: string | null | { empty: true } } | { inherited: true }>>;
  /**
   * Apply `changes` on the caller's EntityManager: no fork, no flush, no audit entry, no event — the caller's
   * Command commits or rolls back the rows with its own (FR-091). Refuses (throws HttpError 422
   * SCOPED_VALUE_INVALID) `inherit` at Global and over-length values (title 160, description 400, og 160 / 400,
   * image URL 2048 and an http(s) URL).
   */
  applyWithin(em: EM, input: { productId; scope: ScopeRef;
                               changes: Partial<Record<SeoProductMetaField, ScopedWriteOp<string>>> }):
    Promise<{ before: Record<string, unknown>; after: Record<string, unknown> }>;
}
```

Row mapping: G = (`sales_channel_id null`, `locale null`); C = (channel, `null`); C×L = (channel, locale). `set` →
column = value; `empty` → column = `''`; `inherit` → column = `NULL`, and the row is deleted when every column is
`NULL`.

**Catalog manifest edge** (`nonBindingDependencies`): `{ moduleId: 'seo', name: 'seoProductMetaWritePort', kind:
'refuses-without', whenAbsent: 'a product save that changes SEO fields is refused while SEO is off; saves
without SEO changes are unaffected', reason: … }`. Catalog resolves it with `lazyPort` **inside** the save
Command only when `changes.seo` is non-empty — never into a singleton, never wrapped in a `catch`
(`check:port-catches`).

## 3. Admin section (FR-090, FR-092)

- `seo` contributes `ProductSeoSection` to the new catalog zone **`product.editor.seo`** (declared by catalog's
  admin, props in `editor-ui.md` §5) and withdraws its `ProductSeoLink` contribution to `product.editor.seo.after`
  (the zone is removed with it).
- Fields render through `ScopedField` from `@endora-commerce/admin-kit` (`editor-ui.md` §4) — the same primitive
  catalog uses, so the inherited state is identical; `seo` imports nothing from catalog's admin (Principle I).
- The catalog editor renders the SEO tab only when the zone has a contributor; `seo` off → no tab, no request,
  no error.
- `seo`'s own `/seo` screen (`SeoMetaScopeEditor.tsx`) keeps editing category and CMS-page metadata; its product
  mode is **replaced by a link** to the product editor's SEO tab (FR-094, owner round 6).
- **Empty values on the storefront (owner round 6):** `resolveForProduct` returns the caller's derived fallback for
  a field whose effective source is `set_empty`, as for `absent`.

## 4. Routes

| Route | Gate | Change |
| --- | --- | --- |
| `GET /api/v1/admin/seo/meta/product/:entityId` | `catalog:read` | **new** static route (FR-093); query `channelId?`, `languageCode?` (no locale-only) |
| `GET /api/v1/admin/seo/meta/:entityType/:entityId` | `catalog:write` | unchanged for `category` / `cms_page`; `product` is answered by the static route first |
| `PUT` / `DELETE /api/v1/admin/seo/meta/:entityType/:entityId` | `catalog:write` | for `product`: three-level address, `''` / `null` per write encoding; still seo's own `seo_meta_override.*` Commands (not used by the editor) |

`requireAdmin` literals stay resolvable; the permission inventory test proves `catalog:read` is enforced on the
new route.
