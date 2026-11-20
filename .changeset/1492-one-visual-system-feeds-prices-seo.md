---
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-seo': patch
'@endora-commerce/mod-import-export': patch
---

The product feeds, price lists, SEO and import/export screens now use one visual system: the admin kit's `ui/*` primitives and Tailwind utilities instead of the legacy `b2b-*` classes and inline styles (issue #1492, UX audit CAT-17). Side drawers keep their frame until the kit has a drawer.

- Product feeds: when the operator may not download a feed or run file, *Download* is a disabled button. Before, it was a link with clicks turned off, and the keyboard could still follow it. The sample-product picker's search box now has a name, its loading line is announced, and a failed load shows as an alert. *Export* is a kit button. The template-editor search and the loading lines use the kit's look.
- Price lists: the display-mode override row uses the kit `Label` and `Select`. Its help line is linked to the select, so a screen reader reads it with the select. The *show the list price* switch is the kit `Checkbox`.
- SEO and import/export: *Edit in the product editor* and *Import / export* are kit outline buttons.
