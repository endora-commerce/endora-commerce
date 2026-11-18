---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-catalog': patch
---

One primary action per view (issue #1441, UX audit DS-07), and the product editor's Inventory tab brought to it (issue #1454, CAT-01).

- `@endora-commerce/admin-kit/components` publishes `DetailHeaderActions({ primary?, secondary?, children?, moreLabel?, moreDisabled?, moreTitle?, className? })`, the actions of a record's detail header: the one primary action drawn last, one or two `outline` secondary actions before it, and a labelled "More" menu drawn first whose entries are `RowActionMenuItem` / `RowActionMenuSeparator`. The menu trigger is not rendered when it would be empty, and the group renders nothing without an action. The kit README documents the rule: one filled button per view, "Add …" as `outline`, row actions as `ghost` icon buttons or a `RowActionMenu`, destructive actions in a menu and confirmed.
- `@endora-commerce/mod-i18n`: `core`'s `common.action.more` ("More" / "Więcej").
- `@endora-commerce/mod-catalog`: on the Inventory tab, each warehouse row's filled **Save** and **Save threshold** become an `outline` **Apply** (translated; named after the warehouse; busy while the write is in flight; available once the value differs from the stored one), so the editor's one Save is the only primary. The per-warehouse inputs are named after their warehouse, a result is announced through an always-mounted status region and a failure is an alert. "Disable stock management" becomes a positive **Track stock** switch, and backorders are a switch too. The per-warehouse writes still apply immediately. Catalog keys removed: `inventoryTab.stockMgmt.disableManageStock`, `inventoryTab.stockMgmt.disableManageStockHelp`, `inventoryTab.lowStock.save`, `inventoryTab.lowStock.saving`.
