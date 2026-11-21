---
'@endora-commerce/mod-catalog': patch
---

The catalog's bulk edit dialog and the Bulk actions screens now use one visual system: the admin kit's `ui/*` primitives and Tailwind utilities instead of the legacy `b2b-*` classes and inline styles (issue #1492, UX audit CAT-17).

- Bulk actions list: the screen is now the kit's list page (issues #1439 and #1448). The status filter is a labelled select, not a row of buttons. The list has a pager, because it used to show only the first 100 operations. The operation name is a link, so the keyboard can reach it; before, the row opened only on a mouse click. An empty list says where operations come from and links to the products. A status filter that matches nothing offers *Clear filters*.
- Bulk operation page: *Undo* is a kit button. The per-element filter is a labelled select. When there are no results, or when the filter matches nothing, the list shows the kit's empty state, the second with *Clear filters*. The table no longer has a second border inside its card.
- Bulk edit dialog: *Add* / *Replace* is a radio group, and each sales channel is a labelled checkbox. Before, both were buttons that showed which one was chosen only by colour. Visibility options are shown in words, not as stored codes. A mass-editable attribute's checkbox and text box are named after the attribute. Errors appear in the kit's alert. In the result tiles, the colour is now a border beside the label rather than the colour of the number.
