---
'@endora-commerce/mod-megamenu': minor
'@endora-commerce/contracts': patch
---

The megamenu save refuses a free-URL asset item with an error code of its own instead of
`VALIDATION_FAILED`, and a sentence in English and Polish (issue #640, part of #86). **A caller that
matches on `VALIDATION_FAILED` for this refusal now sees the specific code.** The HTTP status is
unchanged. Until now it was answered with an English sentence in every language, because the error
envelope never replaces the message of `VALIDATION_FAILED`.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `PUT /api/v1/admin/megamenu/menus/:id/items` (an `asset` item with `target.url` instead of `target.assetId`) | `400 VALIDATION_FAILED`, *"Free-URL asset items are not yet supported. Upload the asset to the Assets Library first and reference it by id."* | `400 MEGAMENU_ASSET_URL_UNSUPPORTED` | `itemId` |

The item is well-formed; what is missing is an import from a URL into the Assets Library, so the
refusal is not validation. `MEGAMENU_ASSET_URL_UNSUPPORTED` is a member of `ERROR_CODES` in
`@endora-commerce/contracts`, declared by the `megamenu` manifest, and the module's documentation
page names it. The three tree rules about a tab's presentation, alignment and click behaviour stay
`VALIDATION_FAILED`, as `specs/168-megamenu-navigation-bar/` data-model §3 classes them. No setting,
permission or migration changes.
