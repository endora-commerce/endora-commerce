# Contract: admin surfaces

`catalog` is the host of everything here and names no module; `cms` contributes one zone member.

## 1. Zone `product.content.editor` (new member of `AdminZoneNameSchema`)

Declared in `packages/contracts/src/admin-contributions.ts` beside `category.content.editor`, with
a doc comment that restates the inverted direction (host owns document, storage and save; the Page
Builder's owner contributes the canvas; `catalog` is `nonDeactivatable` and `cms` is switchable).

- Mounted **once** on `ProductContentPage`, re-mounted per language (keyed on the seed, as
  `CategoryContentPage.tsx` does).
- Props: `ProductContentEditorZoneProps` (data-model §4).
- **No contributor** (CMS off, or the operator lacks `cms`' read code): the host shows its own
  notice (Z15) — no canvas, no save.

## 2. `cms` contribution

`packages/modules/cms/src/admin/zones/ProductContentEditor.tsx`, registered in
`packages/modules/cms/src/admin/index.ts` `zones`:

```ts
zoneComponent('product.content.editor', () => import('./zones/ProductContentEditor.js'), {
  weight: 100,
  requiredPermission: READ_PERMISSION,
}),
```

Behaviour = `CategoryContentEditor` with:
- `contentKey={`product:${productId}:${attributeKey}:${language}`}`
- `activeLanguage={language}` — the Translate action (feature 151) appears under its own switch,
  credentials and `cms.translate` permission; its result lands in the canvas and reaches storage
  only through the host's Save (FR-025).
- `resource={{ type: 'catalog_product_content', id: productId }}` (translate audit context).
- Full block palette — no context restriction (OR-3).
- Never saves.

## 3. Host screen `ProductContentPage`

Route (catalog `src/admin/index.ts`): `{ path: '/catalog/products/:id/content/:attributeKey',
component: () => import('./pages/ProductContentPage.js'), requiredPermission: READ_PERMISSION }`.

| Element | Behaviour |
| --- | --- |
| Header | `productContent.page.title` with the attribute label and product name; back link to `/catalog/products/:id?tab=attributes` |
| Load | `GET …/products/:id/content/:attributeKey` + the product (name, set); `404` → `productContent.error.notAvailable` with the back link |
| Languages | `ContentLanguageTabs` over `['en-US', 'pl-PL']` ∪ stored languages (FR-021) |
| Draft | ref-held per-language envelope, `dirty` flag; `useUnsavedChangesPrompt(dirty)` (US2 #4) |
| Save | `canWrite` (`catalog:write`) → one `PUT` with every language; success `productContent.success.save`; error → envelope message. Without `catalog:write`: `productContent.readOnly`, no button (US2 #5) |
| No editor | `useAdminZone('product.content.editor', props).length === 0` → `productContent.noEditor.title` / `.description` (FR-050, spec edge case on `cms` read permission) |

## 4. Card in the product's attributes tab

`ProductAttributesTab.tsx`: a set member with `valueType === 'page_builder'` renders
`ProductContentCard` (new, `src/admin/components/ProductContentCard.tsx`) spanning both grid
columns, in the set's position order, fed by `GET …/products/:id/content` (one request per tab
load, keyed by attribute key).

| State | Card shows | Action |
| --- | --- | --- |
| product not saved (`productId` absent) | label, `productContent.card.saveFirst` | none (FR-026) |
| Details tab's set ≠ saved set | label, `productContent.card.saveSetFirst` | none |
| no editor contributor | label, per-language chips, summary, `productContent.card.noEditor` | none (FR-050) |
| normal | label, one chip per editing language (`filled` / `empty`), `productContent.card.summary` (`{blocks}` blocks · excerpt) or `productContent.card.emptySummary` | **Edit content** → `/catalog/products/:id/content/:attributeKey` (FR-020) |

Never an inline canvas; never the text input of the `default` branch; never a
`product.editor.field.after` mount.

## 5. Attributes screen (`AttributesManager.tsx`)

- `VALUE_TYPES` gains `page_builder`, labelled `attributes.type.pageBuilder`
  ("Page Builder content" / "Treść Page Builder").
- With `page_builder` chosen: the excluded capability controls are not rendered; the scope
  controls show `attributes.pageBuilder.languageNote` ("Kept per language; editing requires the
  CMS module"); options editor hidden. The list's inline flag grid renders the row's flags
  disabled with `attributes.pageBuilder.flagsLocked` as their title.
- Type selector disabled on edit when either side is `page_builder` (FR-005).
- **Delete action (new, every attribute type — OR-5, FR-007 – FR-009)**: a row action
  `attributes.delete.action` opens a confirmation (`attributes.delete.title`) fed by
  `GET …/attributes/:idOrKey/usage`:
  - `attributes.delete.inSets` ("{count} attribute sets contain this attribute; remove it from them
    first") when `attributeSetCount > 0` — confirm disabled;
  - `attributes.delete.hasValues` ("{count} products hold a value for this attribute — on the
    product, per sales channel or on a variant; clear them first") when `productValueCount > 0` —
    confirm disabled;
  - `attributes.delete.contentCount` ("{count} products carry content for this attribute; it will
    be deleted with it") when `productContentCount > 0`;
  - `attributes.delete.foreignRules` (always): "Promotion conditions, price-list rows and feed
    rules that use this attribute stop matching products."
  - Confirm (`attributes.delete.confirm`) → `DELETE`; a `409` raced in between shows the API
    message (`attributes.delete.error`). The list refreshes on success.

## 6. Navigation, palette, permissions

- **No new permission** (FR-023): reads `catalog:read`, writes `catalog:write`; the canvas
  carries `cms`' existing read code.
- **No palette action, no nav entry**: `/catalog/products/:id/content/:attributeKey` has `:param`
  segments, so it is a detail screen no action can target and `palette-coverage.test.ts` does not
  count it (`module-admin-surfaces.md`, Command palette item 7). The attributes screen stays
  covered by its existing action.
- `admin/test/modules/batch-fifteen-surfaces.module-owned-surface.test.tsx` gains the new route
  for `catalog`; `batch-sixteen-surfaces…` gains the new zone for `cms`.

## 7. i18n keys (catalog `i18n/en.json` + `pl.json`, flat)

`attributes.type.pageBuilder`, `attributes.pageBuilder.languageNote`,
`attributes.pageBuilder.flagsLocked`, `attributes.delete.action`, `attributes.delete.title`,
`attributes.delete.inSets`, `attributes.delete.hasValues`, `attributes.delete.contentCount`,
`attributes.delete.confirm`, `attributes.delete.error`, `attributes.delete.foreignRules`,
`productContent.card.edit`, `productContent.card.filled`, `productContent.card.empty`,
`productContent.card.summary`, `productContent.card.emptySummary`, `productContent.card.saveFirst`,
`productContent.card.saveSetFirst`, `productContent.card.noEditor`,
`productContent.page.title`, `productContent.page.description`, `productContent.action.back`,
`productContent.action.save`, `productContent.action.saving`, `productContent.success.save`,
`productContent.error.load`, `productContent.error.save`, `productContent.error.notAvailable`,
`productContent.loading`, `productContent.editor.title`, `productContent.noEditor.title`,
`productContent.noEditor.description`, `productContent.readOnly`,
`auditLog.product.content.update`.

`cms` adds none (the canvas strings exist). `custom_fields` adds none (the type is not offered on
its screens).
