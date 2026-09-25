---
'@endora-commerce/mod-payments': minor
---

`payments` now creates the `payments.refunded_amount` column its `Payment` entity maps, in its first own migration, `Migration20260925T115728PaymentsRefundedAmount`.

Until now the only migration creating that column was `@endora-commerce/mod-stripe`'s, so an instance without `stripe` could not record a payment, and a hard uninstall of `stripe` dropped a column this module reads and writes. The new migration runs `alter table "payments" add column if not exists "refunded_amount" numeric(14,2) not null default '0'`: on every database that already has the column it is a no-op and keeps every value; on a fresh one it creates it with `0`. Its `down()` is deliberately empty, because the `payments` table is the platform's and its rows outlive this module's uninstall — dropping the column would silently reset every surviving payment's refunded amount.

The package gains a `./migrations` subpath and a `@mikro-orm/migrations` `^6` peer dependency, the same shape every module that ships a migration has. Regenerate the migration registry (`pnpm --filter backend run composer:generate` in this repository, `endora generate` in an instance) so the migration runs.
