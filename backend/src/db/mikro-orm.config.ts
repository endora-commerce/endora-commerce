import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { PluralizingNamingStrategy } from './pluralizing-naming-strategy.js';
import { ALL_ENTITIES } from './entities-registry.js';
import { Migration001FoundationInit } from './migrations/001_foundation_init.js';
import { Migration002QuoteRequestsInit } from '../modules/quote_requests/migrations/002_quote_requests_init.js';
import { Migration003OrganizationsInit } from '../modules/organizations/migrations/003_organizations_init.js';
import { Migration004CommerceInit } from './migrations/004_commerce_init.js';
import { Migration005InvitationsInit } from '../modules/organizations/migrations/005_invitations_init.js';
import { Migration006AdminUsersInit } from '../modules/admin_users/migrations/006_admin_users_init.js';
import { Migration007PasswordResetTokens } from '../modules/customer_accounts/migrations/007_password_reset_tokens.js';
import { Migration008CreditLimitsInit } from '../modules/credit_limits/migrations/008_credit_limits_init.js';
import { Migration009Us7Init } from '../modules/webhooks/migrations/009_us7_init.js';
import { Migration010AnalyticsInit } from '../modules/analytics/migrations/010_analytics_init.js';
import { Migration011SeoInit } from '../modules/seo/migrations/011_seo_init.js';
import { Migration012LanguagesCurrenciesInit } from '../modules/languages/migrations/012_languages_currencies_init.js';
import { Migration013CmsPagesInit } from '../modules/cms_pages/migrations/013_cms_pages_init.js';
import { Migration014PricingInit } from '../modules/price_lists/migrations/014_pricing_init.js';
import { Migration015TaxesPromotionsInit } from '../modules/taxes/migrations/015_taxes_promotions_init.js';
import { Migration016ShoppingListsInit } from '../modules/shopping_lists/migrations/016_shopping_lists_init.js';
import { Migration017AttributeSetsInit } from '../modules/catalog/migrations/017_attribute_sets_init.js';
import { Migration018ProductAttributeExtensions } from '../modules/catalog/migrations/018_product_attribute_extensions.js';
import { Migration019ProductTypeAndVirtualFields } from '../modules/catalog/migrations/019_product_type_and_virtual_fields.js';
import { Migration020GalleryItemsAndLabels } from '../modules/catalog/migrations/020_gallery_items_and_labels.js';
import { Migration021ProductAttachments } from '../modules/catalog/migrations/021_product_attachments.js';
import { Migration022ProductLinks } from '../modules/catalog/migrations/022_product_links.js';
import { Migration023GroupedAndBundle } from '../modules/catalog/migrations/023_grouped_and_bundle.js';

/**
 * MikroORM configuration for the B2B platform backend.
 *
 * - PostgreSQL driver (constitutional stack).
 * - Plural snake_case table names + snake_case columns (Principle VI) via the
 *   custom naming strategy in ./pluralizing-naming-strategy.ts (R-04).
 * - Each module owns its own migrations under
 *   src/modules/<module>/migrations/. This config globs them so modules plug in
 *   without editing a shared registry.
 * - Entities glob works the same way — a new module under src/modules/ is
 *   discovered without touching this file.
 */

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://b2b:b2b@localhost:5432/b2b';

export default defineConfig({
  clientUrl: databaseUrl,
  namingStrategy: PluralizingNamingStrategy,
  // Explicit class list, not a glob — glob discovery requires runtime dynamic
  // `import()` of .ts files, which Node's ESM loader cannot transform and which
  // breaks under Vitest. See src/db/entities-registry.ts for the rationale.
  entities: [...ALL_ENTITIES],
  debug: process.env['NODE_ENV'] === 'development' && process.env['DB_DEBUG'] === 'true',
  allowGlobalContext: false,
  forceUndefined: true,
  extensions: [Migrator],
  migrations: {
    // Explicit migration list — same reasoning as entities above.
    migrationsList: [
      { name: 'Migration001FoundationInit', class: Migration001FoundationInit },
      { name: 'Migration002QuoteRequestsInit', class: Migration002QuoteRequestsInit },
      { name: 'Migration003OrganizationsInit', class: Migration003OrganizationsInit },
      { name: 'Migration004CommerceInit', class: Migration004CommerceInit },
      { name: 'Migration005InvitationsInit', class: Migration005InvitationsInit },
      { name: 'Migration006AdminUsersInit', class: Migration006AdminUsersInit },
      { name: 'Migration007PasswordResetTokens', class: Migration007PasswordResetTokens },
      { name: 'Migration008CreditLimitsInit', class: Migration008CreditLimitsInit },
      { name: 'Migration009Us7Init', class: Migration009Us7Init },
      { name: 'Migration010AnalyticsInit', class: Migration010AnalyticsInit },
      { name: 'Migration011SeoInit', class: Migration011SeoInit },
      { name: 'Migration012LanguagesCurrenciesInit', class: Migration012LanguagesCurrenciesInit },
      { name: 'Migration013CmsPagesInit', class: Migration013CmsPagesInit },
      { name: 'Migration014PricingInit', class: Migration014PricingInit },
      { name: 'Migration015TaxesPromotionsInit', class: Migration015TaxesPromotionsInit },
      { name: 'Migration016ShoppingListsInit', class: Migration016ShoppingListsInit },
      { name: 'Migration017AttributeSetsInit', class: Migration017AttributeSetsInit },
      {
        name: 'Migration018ProductAttributeExtensions',
        class: Migration018ProductAttributeExtensions,
      },
      {
        name: 'Migration019ProductTypeAndVirtualFields',
        class: Migration019ProductTypeAndVirtualFields,
      },
      {
        name: 'Migration020GalleryItemsAndLabels',
        class: Migration020GalleryItemsAndLabels,
      },
      {
        name: 'Migration021ProductAttachments',
        class: Migration021ProductAttachments,
      },
      {
        name: 'Migration022ProductLinks',
        class: Migration022ProductLinks,
      },
      {
        name: 'Migration023GroupedAndBundle',
        class: Migration023GroupedAndBundle,
      },
    ],
    transactional: true,
    disableForeignKeys: false,
    allOrNothing: true,
    emit: 'ts',
    snapshot: false,
  },
});
