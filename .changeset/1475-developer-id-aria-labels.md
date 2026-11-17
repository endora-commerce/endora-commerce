---
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-returns': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-catalog': patch
---

Screen readers now read the admin's visible labels, in the admin's language, instead of developer ids (issue #1475). Before, some controls had an `aria-label` that replaced their visible label, such as `customerNote`, `select-all` or `deliveryAddress-street`.

- **New order** and **new quote request**: the customer, sales channel, payment and delivery method pickers, the customer note and the new-address fields are now named by their labels through `FormField`. Each address side is a group named "Delivery address" or "Billing address", and its saved-address picker carries the same name.
- **Order detail**: the comment box has a visible label, "Add a comment".
- **Orders** and **Returns** lists: the selection checkboxes read "Select all orders on this page" and "Select order ORD-…", with the returns equivalents.
- **Order statuses**: the edit and delete icon buttons read "Edit status …" and "Delete status …". The actions column has a hidden heading, and the delete confirmation is named by its title.

A new lint rule (`no-restricted-syntax` in the root `eslint.config.js`, admin sources only) rejects an `aria-label` or `ariaLabel` written as a camelCase or hyphenated id. The two sites left in the catalog attribute manager are tracked in #1590.

Tests that found these controls by their developer ids now find them by their accessible name, or by `id` where two controls share a name.
