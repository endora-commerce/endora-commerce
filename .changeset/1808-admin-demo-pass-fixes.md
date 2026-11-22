---
'@endora-commerce/admin-kit': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-newsletter': patch
'@endora-commerce/mod-sales-channels': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-i18n': patch
---

Six small Admin defects from the demo click-through are fixed (issue #1808).

- The Inventory stock overview shows each product's name in the Product column, not its SKU.
- Custom-field labels are shown in the admin's language. A host that does not set the language (order, customer and organization detail, among others) used to show a Polish operator the field's default label, which may be its code.
- The "New channel" button no longer reads "+ + New channel". The blog category tree's "Add subcategory" button and the quote's "Add line" button show a plus icon instead of a typed "+".
- On the opportunities list the two filters say what they filter: "Open and closed" (the outcome) and "All workflow statuses" (the stage in the workflow). The Number and Organization columns stay on one line; a long organization name is cut with an ellipsis.
- The product editor's low-stock threshold placeholder reads "Inherited" and fits its input. The help text under it still explains the inheritance.
- The newsletter subscriber search shows "Search by e-mail" in the box.
