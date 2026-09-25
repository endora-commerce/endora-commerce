---
'@endora-commerce/mod-stripe': patch
---

`Migration20260715T103358StripePaymentRefundedAmount` no longer touches the `payments` table: both its `up()` and its `down()` are empty. The `payments.refunded_amount` column it used to add belongs to `@endora-commerce/mod-payments`, which now creates it in its own migration.

The class name and file are unchanged, so databases that already recorded this migration see nothing new. Two paths change behaviour, both for the better: installing `stripe` on a database where `payments` already created the column no longer fails with `column "refunded_amount" of relation "payments" already exists`, and a hard uninstall of `stripe` no longer drops a column `payments` maps. Upgrade `@endora-commerce/mod-payments` together with this release.
