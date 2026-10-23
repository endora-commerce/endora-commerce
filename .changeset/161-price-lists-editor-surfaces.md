---
'@endora-commerce/mod-price-lists': minor
---

The price-book editor's admin surfaces (feature 161, Phase 3; FR-029, `specs/161-price-book-editor/research.md` R3).

- **Routes.** `/price-lists` (the book list, `price_lists:read`, the module's landing again), `/price-lists/new` (`price_lists:write`), `/price-lists/explain` (`price_lists:read`) and `/price-lists/:id` (`price_lists:read`) join `/price-lists/display-modes`, which is no longer the index route. The four new screens are shells with their titles; the next phases fill them.
- **Navigation.** The *Pricing* sidebar entry opens `/price-lists` (was `/price-lists/display-modes`) and reads *Price books* in English (was *Price lists*); Polish is unchanged (*Cenniki*).
- **Palette.** `open-price-lists` targets `/price-lists` (was `/price-lists/display-modes`), described *Find, create and edit price books*; new `new-price-book` → `/price-lists/new` (`price_lists:write`) and `open-price-explainer` → `/price-lists/explain` (`price_lists:read`).
- **Zone.** The product editor's `product.editor.pricing.after` gets this module's base-price panel (`price_lists:read`), a shell for now.
- **Admin library** (`src/admin/lib/`, not exported): the API client over every editor endpoint, parsing each answer with the contracts' schemas; the price-cell parser and formatter (fixed, signed percentage, signed amount, liberal input); the cell and source labels, with `cells.*` and `sources.*` keys in both bundles.
