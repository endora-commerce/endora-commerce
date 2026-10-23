---
'@endora-commerce/admin-kit': minor
---

Two additions for the price-book grid (feature 161, Phase 5), both additive.

- **`EditableGrid` `getCellToken?(rowKey, columnKey): string`.** A cell's memo token: a cell renders again when its text, error, state or this token changes. A caller whose cell shows more than its own text (what an empty cell inherits from a neighbour) puts that in the token, so a change renders the cells it affects and no other. Without it, a cell renders on its text alone, as before.
- **`DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` on `@endora-commerce/admin-kit/ui`** — the Radix menu `RowActionMenu` is built on, published for menus with a labelled trigger.
