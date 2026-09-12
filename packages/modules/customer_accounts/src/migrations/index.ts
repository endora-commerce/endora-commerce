/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent (D-168).
 *
 * Listed in ascending timestamp, which orders **this module's own** migrations
 * and nothing else (feature 081). Where the block sits relative to every other
 * module's is decided by the manifest `dependencies` graph.
 *
 * The **named** exports stay, and the asymmetry with `./backend` — which
 * publishes an array and no entity class by name (D-168) — is deliberate.
 * `db/migrations-registry.generated.ts` imports each class by name from this
 * specifier, and a migration class name is contract in a way an entity class
 * name is not: `mikro_orm_migrations` persists it, so it is a string every
 * already-migrated database holds.
 *
 * A class that is in neither the array nor the barrel is a migration that does
 * not run: `migration:pending` reports nothing pending and the first symptom
 * is a query against a table nobody created.
 */

import { Migration20260425T055041CustomerAccountsPasswordResetTokens } from './20260425T055041_customer_accounts_password_reset_tokens.js';
import { Migration20260611T140351CustomerAccountsOrganizationOptional } from './20260611T140351_customer_accounts_organization_optional.js';
import { Migration20260611T140403CustomerAccountsLifecycle } from './20260611T140403_customer_accounts_lifecycle.js';
import { Migration20260718T200341CustomerAccountsCustomerAccountCustomFieldValues } from './20260718T200341_customer_accounts_customer_account_custom_field_values.js';
import { Migration20260720T044255CustomerAccountsCustomerSubtreeRollup } from './20260720T044255_customer_accounts_customer_subtree_rollup.js';
import { Migration20260819T074816CustomerAccountsPasswordSetAt } from './20260819T074816_customer_accounts_password_set_at.js';
import { Migration20260819T142837CustomerAccountsFoldEmailCase } from './20260819T142837_customer_accounts_fold_email_case.js';
import { Migration20260825T124759CustomerAccountsDropLegacyTwoFactorSecret } from './20260825T124759_customer_accounts_drop_legacy_two_factor_secret.js';
import { Migration20260825T141659CustomerAccountsOrganizationRequired } from './20260825T141659_customer_accounts_organization_required.js';
import { Migration20260912T094701CustomerAccountsSalesChannelCustomerAccounts } from './20260912T094701_customer_accounts_sales_channel_customer_accounts.js';

export const migrations = [
  Migration20260425T055041CustomerAccountsPasswordResetTokens,
  Migration20260611T140351CustomerAccountsOrganizationOptional,
  Migration20260611T140403CustomerAccountsLifecycle,
  Migration20260718T200341CustomerAccountsCustomerAccountCustomFieldValues,
  Migration20260720T044255CustomerAccountsCustomerSubtreeRollup,
  Migration20260819T074816CustomerAccountsPasswordSetAt,
  Migration20260819T142837CustomerAccountsFoldEmailCase,
  Migration20260825T124759CustomerAccountsDropLegacyTwoFactorSecret,
  Migration20260825T141659CustomerAccountsOrganizationRequired,
  Migration20260912T094701CustomerAccountsSalesChannelCustomerAccounts,
];

export {
  Migration20260425T055041CustomerAccountsPasswordResetTokens,
  Migration20260611T140351CustomerAccountsOrganizationOptional,
  Migration20260611T140403CustomerAccountsLifecycle,
  Migration20260718T200341CustomerAccountsCustomerAccountCustomFieldValues,
  Migration20260720T044255CustomerAccountsCustomerSubtreeRollup,
  Migration20260819T074816CustomerAccountsPasswordSetAt,
  Migration20260819T142837CustomerAccountsFoldEmailCase,
  Migration20260825T124759CustomerAccountsDropLegacyTwoFactorSecret,
  Migration20260825T141659CustomerAccountsOrganizationRequired,
  Migration20260912T094701CustomerAccountsSalesChannelCustomerAccounts,
};
