---
'@endora-commerce/mod-carts': patch
---

The admin cart detail now shows translated labels (EN and PL) for the cart status and the approval status badges, read from the `carts.status.<code>` and `carts.approvalStatus.<code>` keys. Before, it showed the raw codes, such as `rejected_by_org_admin`. Most of the screen's other text was missing from the `carts` catalogue and appeared as raw keys: the page title, the field and line-table headings, the history table, the reject form, and the empty, error and not-found messages. They are now in the catalogue too.

On the carts list, the fallback shown for a cart with no owner name and the item-count line are now in the catalogue (`carts.owner.anonymous`, `carts.itemCount`) instead of English text.
