---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-pwa': patch
'@endora-commerce/mod-i18n': patch
---

The inventory module's remaining screens and the PWA push audience rule builder draw one visual system: the admin kit's `ui/*` primitives and Tailwind utilities, instead of the legacy `b2b-*` classes and inline styles (issue #1492, UX audit CAT-17).

`@endora-commerce/admin-kit` theme. **Breaking for a module that renders these classes (0.x, so released as a minor).** Nothing in the platform renders them any more, so they are removed from `theme.css`:

- `.b2b-btn--danger`: use `Button` from `./ui` with `variant="outline"` for a destructive action that a confirm dialog follows, or `variant="destructive"`.
- `.b2b-btn--icon` (and `.b2b-btn--sm.b2b-btn--icon`): use `<Button variant="ghost" size="icon" aria-label="…">`.
- `.b2b-field--mono`: use `Input` from `./ui` with `className="font-mono"`.
- The `.b2b-tbl` cell modifiers `td.num`, `th.num` and `td.actions`. `.b2b-tbl` itself stays. With the kit `Table`, a numeric column is `<TableHead className="text-right">` and `<TableCell className="text-right tabular-nums">`; an actions column is `<TableCell className="w-[1%] whitespace-nowrap">`.
- `.b2b-grow` and `.b2b-tabular`: use the Tailwind utilities `flex-1` and `tabular-nums`.

`@endora-commerce/mod-inventory`: the low-stock list, the warehouses list and editor, the back-in-stock queue and the stock import use kit cards, tables, buttons and fields. Their failures are kit alerts announced as alerts, and their loading and success messages are announced politely. The warehouses list and the back-in-stock queue use the kit list toolbar: a search box with an accessible name, and filter chips that announce whether they are on. In the warehouse editor, the address and contact fields are tied to their labels, which they were not, the two-column grid that never rendered is a real grid, and *Delete* is an outline button so *Save* is the page's one filled button. The stock import's warehouse picker, file input and paste box have names, each skipped row's reason is in words instead of the raw code, and a low-stock row's *Edit stock* opens the product's Inventory tab.

`@endora-commerce/mod-pwa`: the push audience rule builder's frames, AND / OR switch and buttons are kit primitives, and its value picker lists each option as a labelled checkbox that a keyboard can reach, where it used to be clickable by mouse only.

`@endora-commerce/mod-i18n`: new `core` strings for the screens above, in English and Polish. The back-in-stock statuses are capitalised (*Queued*, *W kolejce*), and `inventory.import.pasteDirectly` is replaced by `inventory.import.field.paste`.
