# Contract: product editor adoption (FR-120 – FR-127, R-23)

## §1 `PRODUCT_FIELD_SET` keys (fixed now; `packages/contracts/src/product-form.ts`)

| Key | Type | Required | Section (form `product.edit`) | Existing zone `fieldPath` |
| --- | --- | --- | --- | --- |
| `type` | enum | yes | identity | — |
| `attributeSetId` | reference | yes | identity | — |
| `name` | string | yes | content | `name` |
| `urlKey` | string | no | content | — |
| `description` | string | no | content | `description` |
| `status` | enum | yes | availability | — |
| `audience` | composite | no | availability | — |
| `window` | composite | no | availability | — |
| `categories` | reference[] | no | categories | `categories` |
| `gallery` | composite | no | media | `gallery` |
| `attachments` | composite | no | media | `attachments` |
| `attributeValues.*` | family (type per attribute) | per attribute | attributes | `attributeValues.<key>` |

The key is not the editor's internal `EditorField` `fieldPath` (`product:categoryIds`,
`product:attributeSetId`). `catalog` keeps a module-local map from key to `fieldPath`. Each zone
mount passes its existing `fieldPath` string, which is the key wherever the zone already had one.
WP-P1 confirms the exact bounds and `accepts` against the write contracts.

## §2 Invariants each catalog merge request must keep

| # | Invariant | Test |
| --- | --- | --- |
| P-1 | The accessible structure with no override equals the pre-adoption snapshot at global, channel and locale scope | `ProductEditor.adoption-snapshot.test.tsx` (recorded in WP-P1) |
| P-2 | The `product.editor.field.after` mount counts stay at `DetailsTab` 3, `ProductEditor` 2 and `ProductAttributesTab` 1 (plus one per attribute row), with the same props | the existing `batch-fifteen-surfaces.module-owned-surface.test.tsx`, unedited |
| P-3 | The four PIM admin layers typecheck and build | `scripts/check-paid-admin-layers.sh` (read-only, local and CI-optional; it skips with exit 0 and a notice when `../paid-modules` is absent, and the MR description records the run) |
| P-4 | The existing catalog editor tests pass unedited | the existing suite |
| P-5 | Rules apply per scope; `required` applies to the global value only | the field-rule check unit tests and the 4-path parity test on `product.update` and `product.scoped_values.save` |
| P-6 | The fixture overlay switched off gives P-1 | the off-state integration test |

## §3 The renderer seam

`EditorField` gains three optional props that the kit fills from the effective field: `labelOverride`,
`helpOverride` and `presentationReadOnly`. `DeclaredFormSection`'s renderer for a product key returns
`<EditorField … />` with those props. Scope view, inheritance and `globalOnly` are untouched. A
section that is not adopted renders exactly as it does today, and accepts no override. The
divergence report and the operator screen list it as `not-adopted`, so a release can stop between
sections.
