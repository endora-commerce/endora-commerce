---
'@endora-commerce/mod-catalog': patch
---

The product editor and the new-product form now use one visual system: the admin kit's `ui/*` primitives and Tailwind utilities instead of the legacy `b2b-*` classes and inline styles (issues #1492 and #1502, UX audit CAT-17 and SHELL-18). The whole catalog admin is now held to that rule.

- New product: the form is a kit card. Each field uses the kit's form field. If the SKU or the name is missing, the error now appears under that field and the cursor moves to it. Before, the error appeared only in a banner above the form. The name error now says *Enter a name.* The categories tree is labelled as a group.
- Product editor: *Save* and each field's *More* menu are kit buttons. In the scope map drawer the table uses the kit's rows and cells, and it still scrolls with the keyboard. The order-rules note, the Attributes tab's empty line and the content card's attribute key use the kit's muted text.
