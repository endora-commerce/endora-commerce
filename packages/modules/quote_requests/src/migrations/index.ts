/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent — *"the `./migrations` export of
 * @endora-commerce/mod-quote-requests exports no 'migrations' array"*. `blog`
 * published only `export *` here until D-168, so an installed `blog` did not
 * merely lose its schema, it stopped the platform from booting; the defect was
 * invisible because a workspace member is not an installed package and the
 * committed host registry names each class directly.
 *
 * **Six classes, and the order in this array is not the order they run in.**
 * They are listed here in ascending timestamp, which is the order
 * `backend/src/db/migration-order.ts` computes *within* a module — and within a
 * module only. Where this module's block sits relative to every other module's
 * is decided by the manifest `dependencies` graph, not by a timestamp and not by
 * this file (feature 081). Two of these six share nothing but their day:
 * `…T140415_…_qr_item_packaging` and `…T140417_…_business_id` are two minutes
 * apart and both depend on the `…T141344_…_workflow` rewrite above them, which
 * is exactly what "a timestamp orders a module's own migrations" buys.
 *
 * The **named** exports stay, and the asymmetry with `./backend` — which
 * publishes an array and no named class (D-168) — is deliberate.
 * `db/migrations-registry.generated.ts` imports each class by name from this
 * specifier and hands it to `migration('quote_requests', …)`, and a migration
 * class name is contract in a way an entity class name is not:
 * `mikro_orm_migrations` persists it, so it is a string every already-migrated
 * database holds. It also carries none of the hazard D-168 removes — no module
 * has a reason to name another module's migration, and doing so buys nothing an
 * entity import buys.
 *
 * A class that is in neither the array nor the barrel is a migration that does
 * not run: `migration:pending` reports nothing pending and the first symptom is
 * a query against a table nobody created. The composer refuses a migration file
 * no declared subpath covers for exactly that reason, but it cannot see whether
 * the barrel behind the subpath actually carries the class — that is this
 * file's job.
 *
 * `status-mapping.ts` sits in this directory and is deliberately **not** here:
 * it is a §4 helper, not a migration (see the note in `generate-composer.ts`).
 */

import { Migration20260424T190112QuoteRequestsInit } from './20260424T190112_quote_requests_init.js';
import { Migration20260503T141344QuoteRequestsWorkflow } from './20260503T141344_quote_requests_workflow.js';
import { Migration20260611T140415QuoteRequestsQrItemPackaging } from './20260611T140415_quote_requests_qr_item_packaging.js';
import { Migration20260611T140417QuoteRequestsBusinessId } from './20260611T140417_quote_requests_business_id.js';
import { Migration20260617T095510QuoteRequestsBackfillAdminCreatedAwaiting } from './20260617T095510_quote_requests_backfill_admin_created_awaiting.js';
import { Migration20260718T200342QuoteRequestsQuoteRequestCustomFieldValues } from './20260718T200342_quote_requests_quote_request_custom_field_values.js';
import { Migration20260912T125614QuoteRequestsQuoteRequestChannelAttribution } from './20260912T125614_quote_requests_quote_request_channel_attribution.js';

export const migrations = [
  Migration20260424T190112QuoteRequestsInit,
  Migration20260503T141344QuoteRequestsWorkflow,
  Migration20260611T140415QuoteRequestsQrItemPackaging,
  Migration20260611T140417QuoteRequestsBusinessId,
  Migration20260617T095510QuoteRequestsBackfillAdminCreatedAwaiting,
  Migration20260718T200342QuoteRequestsQuoteRequestCustomFieldValues,
  Migration20260912T125614QuoteRequestsQuoteRequestChannelAttribution,
];

export {
  Migration20260424T190112QuoteRequestsInit,
  Migration20260503T141344QuoteRequestsWorkflow,
  Migration20260611T140415QuoteRequestsQrItemPackaging,
  Migration20260611T140417QuoteRequestsBusinessId,
  Migration20260617T095510QuoteRequestsBackfillAdminCreatedAwaiting,
  Migration20260718T200342QuoteRequestsQuoteRequestCustomFieldValues,
  Migration20260912T125614QuoteRequestsQuoteRequestChannelAttribution,
};
