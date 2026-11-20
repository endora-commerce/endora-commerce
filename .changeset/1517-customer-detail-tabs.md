---
'@endora-commerce/mod-customers': patch
---

The customer detail screen is one card with two tabs instead of eleven stacked cards (issue #1517, UX audit 2026-11-17 SALES-22).

- **Profile** holds the account information, the addresses, the panels other modules add (ordering defaults, price negotiation) and the custom fields. **Activity** holds the orders, quote requests and carts. `?tab=activity` opens Activity. While something on Profile is unsaved its tab says so, and switching tabs keeps the change.
- The organization and the customer group are fields of the account section, each a picker that starts on the current value and an *Assign* / *Set* button that applies at once. They were two cards of one picker and one button each. The group picker clears to "No group", which replaces the *Clear group* button.
- The account actions are the header's **More** menu: block, password reset, two-factor reset, impersonate and, last and set apart, delete. A blocked customer shows *Unblock* beside it, a deleted one *Restore*. The *Actions* card and the delete section at the end of the page are gone. An action's result ("Password reset e-mail sent.") is said beside the header's buttons.

Removed translation keys (customers): `detail.actions.title`, `detail.dangerZone.title`, `detail.dangerZone.hint`, `detail.org.title`, `detail.org.assignLabel`, `detail.group.title`, `detail.group.setLabel`, `detail.group.clear`.
