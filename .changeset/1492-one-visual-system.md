---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-price-lists': patch
---

The products list, the product editor's Inventory tab and packaging units, the inventory list, the sales-channel warehouses panel and the pricing settings page draw one visual system: the admin kit's `ui/*` primitives and Tailwind utilities, instead of kit components next to the legacy `b2b-*` classes and inline styles (issue #1492, UX audit CAT-17).

`@endora-commerce/admin-kit` theme. **Breaking for a module that renders these classes (0.x, so released as a minor).** Nothing in the platform renders them any more, so they are removed from `theme.css`:

- `.b2b-bulkbar` (and its `.count`, `.actions` and button rules): the products list's bulk-action bar was its only renderer. Draw the bar with `Button` from `./ui` inside a Tailwind row, for example `<div className="flex items-center gap-3 rounded-md border bg-muted px-3 py-2"><Button size="sm">…</Button></div>`.
- `.b2b-table`: a table class one screen used. Use `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead` and `TableCell` from `./ui`.
- The `.b2b-tbl` row and cell modifiers `tr.is-selected`, `tr.is-clickable` and `.col-cb`. `.b2b-tbl` itself stays. With the kit `Table`, mark a selected row with `<TableRow data-state="selected">`, make a clickable row `className="cursor-pointer"`, and size a checkbox column with `className="w-8"`.

`@endora-commerce/mod-catalog`: the products list is a kit `Card` with kit buttons, checkboxes and table. The page and row checkboxes now have accessible names, and the bulk-action bar is a light row with one filled primary, where it used to be a dark inverted bar. The row thumbnail placeholder is one neutral tile instead of a colour derived from the product id. On the Inventory tab, the two low-stock threshold modes form one radio group named after their section, and the inputs and the per-warehouse table come from the kit. Packaging units use kit inputs, which were unstyled before because the class they used was never defined, and icon buttons to reorder.

`@endora-commerce/mod-inventory`: the inventory list's KPI tiles and per-warehouse totals are kit cards, each KPI marked up as a term and its value. The sales-channel warehouses panel uses the kit table, select and buttons. Its *Add* is an outline button now, because it applies at once and the channel editor's Save is the page's one primary.

`@endora-commerce/mod-price-lists`: the pricing settings page switches scope through kit tabs instead of three hand-coloured buttons. Its saved and failed results are kit `Alert`s: a saved change is announced politely, a failure as an alert. The override search has an accessible name, and in the *Add override* drawer each candidate is a keyboard-reachable button.
