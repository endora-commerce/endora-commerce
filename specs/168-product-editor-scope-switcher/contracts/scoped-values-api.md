# Contract: scoped values — one read, one save, copy to channels, editor preference

Owner: `catalog`. Zod schemas in `packages/contracts/src/product-scoped-values.ts` (new), re-exported from the
contracts barrel. Every write runs through `CommandBus.run` (Constitution XIII). Decisions: research R4–R8.
Field paths and scope sets: `data-model.md` §9. Write encoding: `write-encoding.md`.

## 1. Scope in a request

Query (read) or body (writes): `channelId?: uuid`, `languageCode?: BCP-47` (case-insensitive, resolved to the
channel's own spelling). Neither → Global; `channelId` only → Channel; both → Channel × language; `languageCode`
without `channelId` → `422 VALIDATION_FAILED` `details.field = 'scope'` (FR-010: no Language scope). A channel the
product is not a member of, or a language the channel does not offer → `422 SCOPE_INVALID` (163 FR-014).

## 2. `GET /api/v1/admin/catalog/products/:id/scoped-values` — `catalog:read`

One request per scope switch (FR-109, audit G2).

```ts
type ScopedFieldView<T> = {
  value: T | null;                 // effective value at the scope; null when source is set_empty or absent
  source: 'set' | 'set_empty' | 'inherited_channel' | 'inherited_global' | 'absent';
  ownValue?: T | null;             // present when source is set / set_empty: the value stored at this scope
  levels: Array<'G' | 'C' | 'CL'>; // the field's scope set
  supportedHere: boolean;          // the scope's level is in `levels` (FR-082)
  required: boolean;               // refuses an empty override (FR-062)
};

type ScopedValuesResponse = { data: {
  scope: ScopeRef;
  version: string;                               // products.updated_at, ISO (R7)
  validScopes: { channels: Array<{ channelId; name; languages: Array<{ code; name }> }> }; // FR-051
  product: {                                     // global-only fields, always the Global value (FR-081)
    sku; type; attributeSetId; categoryIds; archivedAt; slugGlobal; manageStock; backorderEnabled;
    lowStockThreshold; lowStockThresholdMode; fulfilmentStrategy; fulfilmentStrategyWarehouseOrder;
    downloadAssetId; downloadUrl; allowedOrganizationIds /* Global audience list */ };
  fields: {
    name: ScopedFieldView<string>; description: ScopedFieldView<string>;
    status: ScopedFieldView<'active' | 'inactive'>;
    window: ScopedFieldView<{ from: string | null; until: string | null }>;
    audience: ScopedFieldView<{ visibility; allowedOrganizationIds: string[] }>;
    minOrderQuantity: ScopedFieldView<number>; returnable: ScopedFieldView<boolean>;
    urlKey: ScopedFieldView<string>;
  };
  attributes: Array<{ key; label; valueType; isRequired; view: ScopedFieldView<unknown> }>;
  gallery: { items: Array<{ id; assetId; url; position;
                            altText: ScopedFieldView<string>; hidden: ScopedFieldView<boolean>;
                            assetAltText: string | null /* derived fallback in the scope's language */ }>;
             roles: Record<'base_image' | 'small_image' | 'thumbnail', ScopedFieldView<string /* item id */>> };
  attachments: Array<{ id; assetId; typeId; position; fileName;
                       name: ScopedFieldView<string>; description: ScopedFieldView<string>;
                       hidden: ScopedFieldView<boolean> }>;
  packagingUnits: Array<{ id; baseQuantity; position; isDefault; minOrderUnits;
                          name: ScopedFieldView<string> }>;
  seo: null | Record<'title' | 'description' | 'ogTitle' | 'ogDescription' | 'ogImageUrl',
                     ScopedFieldView<string>>;    // null when `seo` is not present (FR-092)
  completeness: CompletenessSummary;             // §2.1
  organizations: Array<{ id; name }>;            // names for audience lists (163 U1)
} };
```

### 2.1 `CompletenessSummary` (FR-097)

| Scope level | Shape |
| --- | --- |
| C×L | `{ level: 'channel_language', missing: ScopeMissingValue[] }` — `[]` = complete |
| C | `{ level: 'channel', missing: Array<{ field: ScopeMissingValue; languages: string[] }> }` |
| G | `{ level: 'global', incompleteScopes: number }` |

`ScopeMissingValue` is 163's vocabulary (`'name' \| 'urlKey' \| 'attribute:<key>'`), evaluated with R16's rule.

### 2.2 Rules

- A `catalog:read` caller gets the same body as a `catalog:write` caller (FR-080; the editor decides read-only from
  the session's permissions).
- `seo` is read through `seoProductMetaPort.readScoped` only when `effectiveState.isPresent('seo')`; otherwise
  `seo: null`. Never a 503 on this route for an absent `seo`.
- Orphaned rows never contribute (they are not at a valid scope); the Scopes tab lists them (163 §3 overview).
- `404 PRODUCT_NOT_FOUND` for an unknown or soft-deleted id.

## 3. `PUT /api/v1/admin/catalog/products/:id/scoped-values` — `catalog:write`

```ts
type SaveScopedValuesRequest = {
  scope: { channelId?: uuid; languageCode?: string };
  version: string;                         // from the read (R7)
  changes: {
    product?: Partial<GlobalOnlyFields>;   // accepted at Global only; elsewhere 422 GLOBAL_ONLY_FIELD
    name?: ScopedWrite<string>; description?: ScopedWrite<string>;
    status?: ScopedWrite<'active' | 'inactive'>;
    window?: ScopedWrite<{ from: string | null; until: string | null }>;
    audience?: ScopedWrite<{ visibility; allowedOrganizationIds: uuid[] }>;
    minOrderQuantity?: ScopedWrite<number>; returnable?: ScopedWrite<boolean>;
    urlKey?: ScopedWrite<string>; confirmTakeover?: string[];   // 163 FR-072, operator only
    attributes?: Record<string, ScopedWrite<unknown>>;
    gallery?: { items?: Record<uuid, { altText?: ScopedWrite<string>; hidden?: ScopedWrite<boolean> }>;
                roles?: Partial<Record<GalleryLabel, ScopedWrite<uuid>>> };
    attachments?: Record<uuid, { name?: ScopedWrite<string>; description?: ScopedWrite<string>;
                                 hidden?: ScopedWrite<boolean> }>;
    packagingUnits?: Record<uuid, { name?: ScopedWrite<string> }>;
    seo?: Partial<Record<SeoProductMetaField, ScopedWrite<string>>>;
  };
};
```

`ScopedWrite<T>` = `T | null | { inherit: true }`, absent or `""` = no change (`write-encoding.md`). Limits: at most
500 changed cells per request (`VALIDATION_FAILED` beyond — a guard, not a product limit).

**Processing — one Command `product.scoped_values.save`, `objectType: 'product'`, `objectId: :id`:**

| Step | Failure | Effect |
| --- | --- | --- |
| 1. Parse; resolve scope (§1) | `400` / `422 VALIDATION_FAILED`, `422 SCOPE_INVALID` | nothing written |
| 2. Every changed field supported at the scope's level (data-model §9) | `422 FIELD_NOT_AT_SCOPE` `{ fields: [{ field, levels }] }` | nothing written |
| 3. `validateScopedWrite` per cell (required / select / boolean refuse `empty`; `inherit` at G refused; value schemas, lengths) | `422 SCOPED_VALUE_INVALID` `{ fields: [{ field, reason: 'required_empty' \| 'not_emptyable' \| 'inherit_at_global' \| 'subject_not_found' \| 'invalid' }] }` | nothing written |
| 4. `capture`: before-state of every touched cell, SEO cells via `seoProductMetaWritePort.readWithin(em, …)` | — | — |
| 5. Compare-and-set the version: `date_trunc('milliseconds', updated_at) = :version`, new value a JavaScript `Date` > `:version` (research R7 — never SQL `now()`) | `409 VERSION_CONFLICT` | nothing written |
| 6. Completeness gate, when a change turns a (C, L) on (163 M3 rule; FR-076) | refuse mode: `422 SCOPE_INCOMPLETE` (163 shape) | nothing written |
| 7. Catalog writes in order: product row → scope rows → value overrides → family overrides → URL key (advisory locks; `409 URL_KEY_TAKEN` / `URL_KEY_REDIRECT_TAKEOVER_REQUIRED`) | any error | transaction rolled back |
| 8. `seoProductMetaWritePort.applyWithin(em, …)` iff `changes.seo` non-empty — resolved here, so a switched-off `seo` answers `503 MODULE_DISABLED` | any error | rolled back |
| 9. Audit: one entry, `before` / `after` = `{ "<field>@<scope>": value \| {empty:true} \| {inherited:true} }` for every cell written, SEO included (FR-072, FR-091); event `product.updated.v1` `changedFields` = union | — | — |

`200` → `{ data: ScopedValuesResponse['data'] /* re-read at the same scope */, warnings: ScopeWarning[] }`
(163's warning union; *warn*-mode completeness warnings, FR-098).

**Undo (FR-074).** The audit `before` is a complete, valid `changes` body for the same scope (each cell's prior
`set` / `empty` / `inherit`); re-applying it through this route restores the save as one. No editor Undo button.
No restore UI in 168 (owner round 6); "Restore this save" on the audit entry is a named follow-up.

**Version and immediate actions (R7).** Only the Save, copy and other scoped-value / product-row writes bump the
version. Immediate actions (structural operations, price-book rows, channel membership, stock) never do, so a
Save sent with the version read before them succeeds. A changed cell whose subject no longer exists (a gallery
item, attachment or packaging unit removed meanwhile) → `422 SCOPED_VALUE_INVALID` reason `subject_not_found`.

## 4. `POST /api/v1/admin/catalog/products/:id/scoped-values/copy` — `catalog:write` (FR-086)

```ts
type CopyScopedValueRequest = {
  field: FieldPath;                                  // a {G,C,CL} field
  from: { channelId: uuid; languageCode: string };   // the source C×L
  toChannelIds: uuid[];                              // 1…64
  version: string;
  dryRun?: boolean;
};
type CopyScopedValueResponse = { data: {
  overwrites: Array<{ channelId; currentValue: unknown | { empty: true } }>; // targets holding an own value
  applied: number;                                   // 0 on dryRun
  version: string;
} };
```

Command `product.scoped_values.copy_to_channels`: copies the source's **own** value (`set` or `empty`) to
`(target, languageCode)` for each target; refused per field when the source has no own value
(`422 SCOPED_VALUE_INVALID` reason `source_inherits`), when copying `empty` to a required field (`required_empty`),
and per target when the target is not a member or does not offer the language (`422 SCOPE_INVALID`). One audit
entry; version compare-and-set as §3.

## 5. `PUT /api/v1/admin/catalog/products/:id/editor-preference` — `catalog:read` (R8)

Body `{ lastChannelId: uuid | null, lastLanguageCode: string | null }`. `lastLanguageCode` without
`lastChannelId` → `422 VALIDATION_FAILED`; channel not a member / language not offered → `422 SCOPE_INVALID`.
Not a Command (a UI preference). The read endpoint does not return it; the editor reads it from
`GET …/editor-preference` (new, same gate) only when the URL names no scope.

## 6. Routes retired or changed

| Route | Change |
| --- | --- |
| `GET …/products/:id/scope-context` | **removed** (editor-only; replaced by §2 + §5) |
| `GET`, `PATCH …/products/:id/value-overrides` | **removed** (editor-only; replaced by §2 / §3) |
| `PATCH …/products/:id` | stays for API clients; `name` / `description` are strings; scoped fields take `ScopedWrite` at Global; optional `version` precondition |
| `PATCH …/products/:id/scopes` | stays (bulk / API); body moves to the write encoding (`null` = empty where allowed, `{inherit:true}` = inherit) |
| `PUT …/products/:id/url-keys` | stays (API); keys addressed `(channelId, languageCode?)`; `key: {inherit:true}` deletes; `null` refused (required) |
| `PUT …/gallery/channel-roles`, gallery / attachment / packaging `PATCH` of scoped sub-fields | scoped sub-fields removed from these routes; collection operations (add, remove, reorder, replace asset, base quantity, default flag) stay |
| `GET …/products/:id/scopes`, `…/scope-overview` | stay; the overview drops its Language row (FR-100) and its `scopeLevelSchema` loses `'language'` |
