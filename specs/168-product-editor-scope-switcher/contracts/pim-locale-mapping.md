# Contract: PIM locale mapping, source language for Global, protection, scope write port v2

Owners: the mapping contract and grammar — `pim_connector` (types in `packages/contracts/src/pim-locale-mapping.ts`
and `pim-field-path.ts`, header naming the owner); the write port — `catalog`. Connectors live outside this
repository and configure the mapping in their own screens (FR-045). Decision: research R13.

## 1. Mapping (FR-040, FR-047)

```ts
const localeTag = z.string().regex(/^[a-z]{2,3}([_-][A-Za-z]{2})?$/);           // pl_PL, pl-PL, pl
export const pimLocaleMappingEntrySchema = z.object({
  sourceLocale: localeTag,
  sourceChannel: z.string().min(1).max(100).nullable(),  // the PIM's channel / scope code; null = any
  targets: z.array(z.object({ channelId: uuidSchema, languageCode: languageCodeSchema })).min(1).max(64),
});
export const pimLocaleMappingEntriesSchema = z.array(pimLocaleMappingEntrySchema).max(500)
  .refine(noDuplicate(sourceLocale, sourceChannel));
export const pimLocaleMappingSchema = z.object({
  sourceLanguageForGlobal: localeTag.nullable(),          // FR-047
  entries: pimLocaleMappingEntriesSchema,
});
```

Locale tags compare case-insensitively with `_` ≡ `-`.

## 2. Planner (FR-041, FR-042, FR-044, FR-047)

```ts
export interface PimSourceValues {
  /** Non-localizable attributes and fields — always written to Global (FR-047). */
  global: Record<FieldPath, unknown | ScopedWriteOp<unknown>>;
  /** Localizable values per source locale (and optional source channel). */
  perLocale: Array<{ locale: string; sourceChannel: string | null; values: Record<FieldPath, unknown | ScopedWriteOp<unknown>> }>;
}
export function planLocaleWrites(input: {
  source: PimSourceValues;
  mapping: z.infer<typeof pimLocaleMappingSchema>;
  validScopes: { channels: Array<{ channelId: string; languages: string[] }> }; // the product's valid scopes
}): {
  writes: Array<{ scope: ScopeRef; field: FieldPath; op: ScopedWriteOp<unknown> }>;
  unmapped: Array<{ locale: string; sourceChannel: string | null }>;   // run warning (FR-041)
  skipped: Array<{ scope: ScopeRef; reason: 'not_a_member' | 'language_not_offered' }>; // per product (FR-042)
};
```

Rules: (1) `global` → G. (2) A `perLocale` group whose locale equals `sourceLanguageForGlobal` → G (localizable
fields), **and** also to its mapped targets if it has entries. (3) A group matched by an entry (entry with
`sourceChannel` matches only that channel; an entry with `null` matches any channel; the more specific entry
wins) → each target as C×L. (4) A group matched by nothing → `unmapped`, written nowhere. (5) A target outside
`validScopes` → `skipped`, the other targets still written. (6) A field whose scope set lacks CL (data-model §9)
is written at the target's **C** scope, never at C×L. (7) Conflicts on one (field, scope) from two groups: the
specific-entry group wins, then the first entry in mapping order.

## 3. Protection (FR-046)

```ts
export function filterProtectedWrites<W extends { field: FieldPath }>(writes: W[], protectedPaths: PimFieldPath[]): {
  kept: W[]; protected: number;
};
```

A protected path removes **every** scope of the field. Path grammar after 168 (`pimFieldPathSchema`):
`attribute.<key>` · `seo.metaTitle|metaDescription|metaKeywords` · `name` · `description` · `gallery.<n>` ·
`attachment.<uuid>` · `price.<uuid>.<CUR>` · `category.<uuid>`. Any locale or channel segment is invalid
(`canonicalisePimFieldPath` → `null`). No stored protection rule is migrated (owner: no live data); the connectors'
own stores are outside this repository — release note for connector maintainers.

## 4. `CatalogProductScopeWritePort` v2 (`catalogProductScopeWritePort`, owner catalog)

```ts
export interface ProductScopedWriteInput {
  /** Each entry writes one field at one scope; only named (field, scope) cells are touched (FR-044). */
  cells: Array<{ scope: ScopeRef; field: FieldPath; op: ScopedWriteOp<unknown> }>;
}
export interface CatalogProductScopeWritePort {
  applyScopes(productId: string, input: ProductScopedWriteInput, options: { source: string }):
    Promise<{ applied: number; refused: Array<{ scope; field; code: string }>; urlKeys: UrlKeyWriteOutcome[] }>;
}
```

**Allowlist (R13a).** Accepted fields: `name`, `description`, `attribute:<key>` (attributes of the product's
set, validated by value type and scope set), `gallery:<itemId>:altText`, `attachment:<id>:name|description`,
`packagingUnit:<id>:name`, `urlKey` (163 FR-093), `status`, `window` (163 capabilities, kept by owner
decision 2026-10-30 — plan Q6, R13a). Refused `not_supported`: `audience`, `product.*`, `seo:*`, `galleryRole:*`, `*:hidden`,
`minOrderQuantity`, `returnable`. Subject ids bound to `productId` (R21). `options.source` must be a registered
connector module id (`^[a-z][a-z0-9_]{1,63}$`, present in the registry). At most 2 000 cells per call; duplicate
(field, scope) cells refused. At most 1 000 new URL keys reserved per run.

One Command `product.scoped_values.import` per product (one audit entry, `source` in the audit meta), the same
`validateScopedWrite` refusals (reported per cell, the rest applied — an import is per-cell tolerant, unlike the
editor save), no completeness gate (163 A-6), no takeover (163 FR-093), version bumped. SEO cells are not
accepted here (connectors write SEO through `seo`, outside 168) — `seo:*` paths are refused `not_supported`.

## 5. Tests

`packages/contracts/src/pim-locale-mapping.test.ts` (planner rules 1–7, US4 #1–#3, #5, #8; the shared encoding
cases of `write-encoding.md` §4); `packages/contracts/src/pim-field-path.test.ts` (grammar shrinks: locale and
channel segments rejected); `backend/test/contract/catalog/scope-write-port-v2.test.ts` [PG] (US4 #6: Global-only
writes keep operator overrides; #7 protection is the caller's filter; refusals per cell).
