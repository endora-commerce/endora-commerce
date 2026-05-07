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
import { Migration013CmsPagesInit } from './migrations/013_cms_pages_init.js';
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
import { Migration024SettingsInit } from './migrations/024_settings_init.js';
import { Migration025SalesChannelsPromote } from '../modules/sales_channels/migrations/025_sales_channels_promote.js';
import { Migration026SearchPhraseRecordsInit } from '../modules/search/migrations/026_search_phrase_records_init.js';
import { Migration027ComparisonsInit } from '../modules/comparisons/migrations/027_comparisons_init.js';
import { Migration028ProductAttributeIsComparable } from '../modules/catalog/migrations/028_product_attribute_is_comparable.js';
import { Migration029QuoteRequestsWorkflow } from '../modules/quote_requests/migrations/029_quote_requests_workflow.js';
import { Migration030InventoryWorkflow } from '../modules/inventory/migrations/030_inventory_workflow.js';
import { Migration031PriceListsEngine } from '../modules/price_lists/migrations/031_price_lists_engine.js';
import { Migration032AttributeOptionsAndFlags } from '../modules/catalog/migrations/032_attribute_options_and_flags.js';
import { Migration033PromotionsCriteria } from '../modules/promotions/migrations/033_promotions_criteria.js';
import { Migration034AssetsLibraryInit } from './migrations/034_assets_library_init.js';
import { Migration035CmsInit } from './migrations/035_cms_init.js';
import { Migration036MegamenuInit } from './migrations/036_megamenu_init.js';
import { Migration037BlogInit } from './migrations/037_blog_init.js';
import { Migration038DictionaryInit } from './migrations/038_dictionary_init.js';
import { Migration039ModuleLifecycleInit } from './migrations/039_module_lifecycle_init.js';
import { Migration040AdminI18nInit } from './migrations/040_admin_i18n_init.js';
import { Migration041AdminActionsInit } from './migrations/041_admin_actions_init.js';

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
      {
        name: 'Migration024SettingsInit',
        class: Migration024SettingsInit,
      },
      {
        name: 'Migration025SalesChannelsPromote',
        class: Migration025SalesChannelsPromote,
      },
      {
        name: 'Migration026SearchPhraseRecordsInit',
        class: Migration026SearchPhraseRecordsInit,
      },
      {
        name: 'Migration027ComparisonsInit',
        class: Migration027ComparisonsInit,
      },
      {
        name: 'Migration028ProductAttributeIsComparable',
        class: Migration028ProductAttributeIsComparable,
      },
      {
        name: 'Migration029QuoteRequestsWorkflow',
        class: Migration029QuoteRequestsWorkflow,
      },
      {
        name: 'Migration030InventoryWorkflow',
        class: Migration030InventoryWorkflow,
      },
      {
        name: 'Migration031PriceListsEngine',
        class: Migration031PriceListsEngine,
      },
      {
        name: 'Migration032AttributeOptionsAndFlags',
        class: Migration032AttributeOptionsAndFlags,
      },
      {
        name: 'Migration033PromotionsCriteria',
        class: Migration033PromotionsCriteria,
      },
      {
        name: 'Migration034AssetsLibraryInit',
        class: Migration034AssetsLibraryInit,
      },
      {
        name: 'Migration035CmsInit',
        class: Migration035CmsInit,
      },
      {
        name: 'Migration036MegamenuInit',
        class: Migration036MegamenuInit,
      },
      {
        name: 'Migration037BlogInit',
        class: Migration037BlogInit,
      },
      {
        name: 'Migration038DictionaryInit',
        class: Migration038DictionaryInit,
      },
      {
        name: 'Migration039ModuleLifecycleInit',
        class: Migration039ModuleLifecycleInit,
      },
      {
        name: 'Migration040AdminI18nInit',
        class: Migration040AdminI18nInit,
      },
      {
        name: 'Migration041AdminActionsInit',
        class: Migration041AdminActionsInit,
      },
    ],
    transactional: true,
    disableForeignKeys: false,
    allOrNothing: true,
    emit: 'ts',
    snapshot: false,
  },
});
