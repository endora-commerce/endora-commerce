---
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-quick-order': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-sales-channels': patch
---

Documentation only (issue #407). The shipped `docs/` pages, in English and Polish, now describe the one Save on every editor with zone panels. Each page says what Save covers, what is checked before anything is written, the order the parts are written in, what a partial save reports and that the next Save writes only the part that failed. It also says how the leave guard works and which sections carry the "Applies immediately" badge.

- catalog: "Editing a product at a scope" covers the base prices and the Inventory tab's product settings under Save, plus the actions that apply immediately. A new "Editing a category" section on the module page covers the category editor's Save.
- price_lists: the display-mode override saves with the organization and category editors. The base-price panel's **Discard changes** is described.
- organizations, customers: a section on each screen's one Save and its immediate actions.
- quick_order, quote_requests: their panels save with the host screen's Save.
- sales_channels: the edit page's Save and its count. Deactivate and Re-activate keep unsaved edits, and warehouse routing applies immediately.

No code, API or string changes.
