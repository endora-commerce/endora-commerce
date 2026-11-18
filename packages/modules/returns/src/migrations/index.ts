/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent (D-168).
 *
 * Listed in ascending timestamp, which is the order of this module's own
 * migrations and of nothing else (feature 081): a manifest `dependencies` array
 * is the only thing ordering this block against another module's.
 *
 * The **named** exports stay beside the array, and the asymmetry with
 * `./backend` — which publishes an array and no named class (D-168) — is
 * deliberate. `db/migrations-registry.generated.ts` imports each class by name
 * from this specifier, and a migration class name is contract in a way an entity
 * class name is not: `mikro_orm_migrations` persists it, so it is a string every
 * already-migrated database holds.
 *
 * A class that is in neither the array nor the barrel is a migration that does
 * not run: `migration:pending` reports nothing pending and the first symptom is
 * a query against a table nobody created.
 */

import { Migration20260625T144227ReturnsInit } from './20260625T144227_returns_init.js';
import { Migration20260817T203206ReturnsRefundCorrectiveInvoiceOutcome } from './20260817T203206_returns_refund_corrective_invoice_outcome.js';
import { Migration20261024T174052ReturnsCaseItemDiscount } from './20261024T174052_returns_case_item_discount.js';
import { Migration20261108T023047ReturnsConsumerWithdrawal } from './20261108T023047_returns_consumer_withdrawal.js';
import { Migration20261108T125405ReturnsCaseChargeRefunds } from './20261108T125405_returns_case_charge_refunds.js';
import { Migration20261113T145001ReturnsAuthorizerStatusNotifications } from './20261113T145001_returns_authorizer_status_notifications.js';
import { Migration20261113T155433ReturnsOffPlatformComplaints } from './20261113T155433_returns_off_platform_complaints.js';

export const migrations = [
  Migration20260625T144227ReturnsInit,
  Migration20260817T203206ReturnsRefundCorrectiveInvoiceOutcome,
  Migration20261024T174052ReturnsCaseItemDiscount,
  Migration20261108T023047ReturnsConsumerWithdrawal,
  Migration20261108T125405ReturnsCaseChargeRefunds,
  Migration20261113T145001ReturnsAuthorizerStatusNotifications,
  Migration20261113T155433ReturnsOffPlatformComplaints,
];

export {
  Migration20260625T144227ReturnsInit,
  Migration20260817T203206ReturnsRefundCorrectiveInvoiceOutcome,
  Migration20261024T174052ReturnsCaseItemDiscount,
  Migration20261108T023047ReturnsConsumerWithdrawal,
  Migration20261108T125405ReturnsCaseChargeRefunds,
  Migration20261113T145001ReturnsAuthorizerStatusNotifications,
  Migration20261113T155433ReturnsOffPlatformComplaints,
};
