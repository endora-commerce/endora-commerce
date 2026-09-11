/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * Listed in ascending timestamp, which is the order of this module's own
 * migrations and of nothing else (feature 081).
 */

import { Migration20260908T125013InvoiceLedgerInit } from './20260908T125013_invoice_ledger_init.js';

export const migrations = [Migration20260908T125013InvoiceLedgerInit];

export { Migration20260908T125013InvoiceLedgerInit };
