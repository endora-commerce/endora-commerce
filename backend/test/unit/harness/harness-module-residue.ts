/**
 * What `backend/test/helpers/test-server.ts` still names of a module package,
 * and why each group is still right to be there **today**.
 *
 * A two-way draining ledger, in `check:module-boundary`'s shape and for its
 * reason: an entry that is no longer true fails the run as loudly as one that is
 * new. The expected end state of every group below is the empty array, and each
 * names the task that empties it.
 *
 * **It is a ledger and not a threshold on purpose.** A count that may only fall
 * lets one coupling replace another, which is how `BackendServerOptions` grew
 * from 3 fields to 22 in three months.
 *
 * Measured on this branch, against feature 134 T012's recorded premise of
 * 7 / 12 / 29 / 21:
 *
 * | | recorded | re-derived |
 * | --- | --- | --- |
 * | host bindings into `../../src/` | 7 | **7** |
 * | module-typed `BackendServerOptions` members | 12 | **12** |
 * | module-typed `BackendServerHandle` members | 29 | **29** |
 * | paid-module table names in the wipe list | 21 | **20** — `pim_pimcore` 8, `pim_ergonode` 10, `ksef` 2; `invoice_ledger`'s five belong to a free module |
 *
 * The one number the premise did not carry is the **specifier** count, which is
 * what T012's own sentence is about: 59 declarations into 39 module packages on
 * the day the instrument landed, all of them `import type` and therefore
 * invisible to every runtime instrument in the estate.
 */

/**
 * Specifiers that resolve into a module package.
 *
 * Retired by 109 T050/T051: each is here because a member of
 * `BackendServerOptions` or `BackendServerHandle` is typed by it, or — for the
 * four `./test-support` entries — because this root still constructs that
 * module's default test double. The four arrived **with** T015 and are the price
 * of the fifteen vendor helpers leaving `backend/test/helpers/`: the doubles are
 * now the modules', and the day the six source and media option fields go
 * (T051), the modules contribute them through their own `registrations` and
 * these four go with the fields.
 */
export const LEDGERED_MODULE_SPECIFIERS: readonly string[] = [
  '../../../packages/modules/admin_notifications/src/backend/services/admin-notification-service.js',
  '../../../packages/modules/admin_roles/src/backend/services/admin-role-service.js',
  '../../../packages/modules/admin_roles/src/backend/services/permission-catalogue.service.js',
  '../../../packages/modules/admin_roles/src/backend/services/permission-service.js',
  '../../../packages/modules/api_keys/src/backend/index.js',
  '../../../packages/modules/assets_library/src/backend/index.js',
  '../../../packages/modules/blog/src/backend/index.js',
  '../../../packages/modules/carts/src/backend/index.js',
  '../../../packages/modules/carts/src/backend/services/cart-service.js',
  '../../../packages/modules/catalog/dist/backend/services/catalog-attribute-read.service.js',
  '../../../packages/modules/cms/src/backend/index.js',
  '../../../packages/modules/comarch_xl/src/backend/index.js',
  '../../../packages/modules/comparisons/src/backend/index.js',
  '../../../packages/modules/credentials/src/backend/services/configuration-type-registry.js',
  '../../../packages/modules/credentials/src/backend/services/credentials.service.js',
  '../../../packages/modules/custom_fields/src/backend/index.js',
  '../../../packages/modules/custom_fields/src/backend/services/custom-field-definition.service.js',
  '../../../packages/modules/custom_fields/src/backend/services/custom-field-definitions-cache.js',
  '../../../packages/modules/custom_fields/src/backend/services/custom-field-value.service.js',
  '../../../packages/modules/dictionaries/src/backend/index.js',
  '../../../packages/modules/email/src/backend/index.js',
  '../../../packages/modules/email/src/backend/services/mailer.js',
  '../../../packages/modules/invoice_ledger/src/backend/services/invoice-ledger-registry.service.js',
  '../../../packages/modules/invoices/dist/backend/index.js',
  '../../../packages/modules/ksef/src/backend/index.js',
  '../../../packages/modules/ksef/src/backend/integrations/ksef-client.interface.js',
  '../../../packages/modules/mfa/src/backend/services/oauth-provider-service.js',
  '../../../packages/modules/organizations/src/backend/index.js',
  '../../../packages/modules/organizations/src/backend/services/organization-context-service.js',
  '../../../packages/modules/organizations/src/backend/services/organization-moderation-service.js',
  '../../../packages/modules/organizations/src/backend/services/organization-restriction-service.js',
  '../../../packages/modules/organizations/src/backend/services/vat-validator-port.js',
  '../../../packages/modules/pim_akeneo/src/backend/services/akeneo-media-fetcher.js',
  '../../../packages/modules/pim_ergonode/src/backend/services/ergonode-client.port.js',
  '../../../packages/modules/pim_ergonode/src/backend/services/ergonode-media-fetcher.js',
  '../../../packages/modules/pim_unopim/src/backend/services/unopim-media-fetcher.js',
  '../../../packages/modules/price_lists/src/backend/services/pricing-service.interface.js',
  '../../../packages/modules/product_feeds/src/backend/index.js',
  '../../../packages/modules/product_feeds/src/backend/services/delivery/delivery-adapter.interface.js',
  '../../../packages/modules/product_feeds/src/backend/services/taxonomy-source-fetcher.interface.js',
  '../../../packages/modules/prompt_actions/src/backend/index.js',
  '../../../packages/modules/prompt_actions/src/backend/services/llm/provider-factory.js',
  '../../../packages/modules/prompt_actions/src/backend/services/llm/provider.js',
  '../../../packages/modules/prompt_actions/src/backend/services/prompt-request.service.js',
  '../../../packages/modules/prompt_actions/src/backend/services/tool-registry.js',
  '../../../packages/modules/pwa/src/backend/index.js',
  '../../../packages/modules/sales_channels/src/backend/index.js',
  '../../../packages/modules/search/src/backend/index.js',
  '../../../packages/modules/settings/src/backend/index.js',
  '../../../packages/modules/shopping_lists/src/backend/services/shopping-list-service.js',
  '@endora-commerce/mod-admin-users/backend',
  '@endora-commerce/mod-auth/backend',
  '@endora-commerce/mod-comarch-xl/test-support',
  '@endora-commerce/mod-customer-accounts/backend',
  '@endora-commerce/mod-i18n/backend',
  '@endora-commerce/mod-megamenu/backend',
  '@endora-commerce/mod-pim-akeneo/test-support',
  '@endora-commerce/mod-pim-ergonode/backend',
  '@endora-commerce/mod-pim-ergonode/test-support',
  '@endora-commerce/mod-pim-pimcore/backend',
  '@endora-commerce/mod-pim-unopim/backend',
  '@endora-commerce/mod-pim-unopim/test-support',
  '@endora-commerce/mod-promotions/backend',
];

/**
 * `Interface.member` pairs whose type names a module package.
 *
 * Retired by 109 T050 (the handle, 29) and T051 (the options, 12). Feature 109
 * SC-003 is these two counts reaching zero, and 134 T013 is where it is
 * scheduled. **This is the compile-time hard stop**: while a member of either
 * interface is typed by a paid module's source, the free repository does not
 * compile without that module's directory.
 */
export const LEDGERED_MODULE_TYPE_REFERENCES: readonly string[] = [
  'BackendServerHandle.adminI18n',
  'BackendServerHandle.assetsLibrary',
  'BackendServerHandle.blog',
  'BackendServerHandle.cartService',
  'BackendServerHandle.catalogAttributeRead',
  'BackendServerHandle.cms',
  'BackendServerHandle.comparisons',
  'BackendServerHandle.credentials',
  'BackendServerHandle.customFields',
  'BackendServerHandle.dictionaries',
  'BackendServerHandle.integrations',
  'BackendServerHandle.invoices',
  'BackendServerHandle.ksef',
  'BackendServerHandle.megamenu',
  'BackendServerHandle.organizations',
  'BackendServerHandle.permissionCatalogueService',
  'BackendServerHandle.permissionService',
  'BackendServerHandle.pimErgonode',
  'BackendServerHandle.pimPimcore',
  'BackendServerHandle.pimUnopim',
  'BackendServerHandle.pricingService',
  'BackendServerHandle.productFeeds',
  'BackendServerHandle.promotions',
  'BackendServerHandle.promptActions',
  'BackendServerHandle.pwa',
  'BackendServerHandle.salesChannels',
  'BackendServerHandle.search',
  'BackendServerHandle.sessionService',
  'BackendServerHandle.settings',
  'BackendServerOptions.akeneoMediaFetcher',
  'BackendServerOptions.ergonodeClient',
  'BackendServerOptions.ergonodeMediaFetcher',
  'BackendServerOptions.feedDeliveryAdapters',
  'BackendServerOptions.invoiceLedgerPresence',
  'BackendServerOptions.ksefClientFactory',
  'BackendServerOptions.organizationsMailer',
  'BackendServerOptions.promptActionsLlmFetch',
  'BackendServerOptions.taxonomySourceFetcher',
  'BackendServerOptions.unopimClient',
  'BackendServerOptions.unopimMediaFetcher',
  'BackendServerOptions.xlClient',
];

/**
 * Table names a module package owns, written into this root's wipe list.
 *
 * Retired by 109 T060-T064: the set a composition empties is contributed by the
 * modules in it. **100 on the day T012 landed, 80 now** — T014 took
 * `pim_pimcore`'s eight, `pim_ergonode`'s ten and `ksef`'s two into those
 * packages' own `src/test-support/index.ts`, which is the shape the remaining 80
 * follow.
 */
export const LEDGERED_MODULE_TABLE_NAMES: readonly string[] = [
  'addresses',
  'admin_roles',
  'admin_users',
  'analytics_events',
  'api_keys',
  'assets',
  'attribute_set_attributes',
  'availability_notifications',
  'blog_categories',
  'blog_category_languages',
  'blog_category_sales_channels',
  'blog_post_categories',
  'blog_post_languages',
  'blog_post_related_posts',
  'blog_post_related_products',
  'blog_post_sales_channels',
  'blog_post_tags',
  'blog_posts',
  'blog_tags',
  'bundle_slot_options',
  'bundle_slots',
  'cart_items',
  'carts',
  'categories',
  'cms_pages',
  'comparisons',
  'credential_configurations',
  'credit_limit_reservations',
  'credit_limits',
  'custom_field_definitions',
  'custom_field_options',
  'customer_accounts',
  'customer_groups',
  'delivery_methods',
  'email_verification_tokens',
  'gallery_item_labels',
  'gallery_items',
  'grouped_items',
  'invoice_ledger_activation_lock',
  'invoice_ledger_client_maps',
  'invoice_ledger_deliveries',
  'invoice_ledger_document_maps',
  'invoice_ledger_webhook_receipts',
  'invoices',
  'megamenu_bindings',
  'megamenu_items',
  'megamenus',
  'mfa_enrolments',
  'mfa_organization_policies',
  'mfa_recovery_codes',
  'mfa_social_identities',
  'order_items',
  'orders',
  'organization_invitations',
  'organizations',
  'payment_methods',
  'payments',
  'price_list_assignments',
  'price_list_items',
  'price_lists',
  'product_assets',
  'product_attachments',
  'product_attributes',
  'product_categories',
  'product_links',
  'product_variants',
  'products',
  'promotions',
  'quote_request_items',
  'quote_requests',
  'sales_channel_products',
  'search_phrase_records',
  'seo_meta_overrides',
  'shopping_list_items',
  'shopping_lists',
  'sitemap_cache',
  'stock_levels',
  'taxes',
  'webhook_deliveries',
  'webhooks',
];
