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
 * ## The counts, and what has drained
 *
 * Measured against feature 134 T012's recorded premise of 7 / 12 / 29 / 21:
 *
 * | | recorded | re-derived when T012 landed | now |
 * | --- | --- | --- | --- |
 * | host bindings into `../../src/` | 7 | **7** | 7 — and they stay: they are what the inversion hands the kit |
 * | module-typed `BackendServerOptions` members | 12 | **12** | **5** |
 * | module-typed `BackendServerHandle` members | 29 | **29** | **28** |
 * | paid-module table names in the wipe list | 21 | **20** | **0** |
 * | module-package specifiers (the premise carried no number) | — | **59** | **52** |
 *
 * **The compile-time hard stop `spec.md` §2.4 measures is closed.** Seven
 * declarations reached into `packages/modules/<paid id>/src/` — `KsefCradle`,
 * `KsefApiClientPort`, `ErgonodeClientPort`, `ErgonodeMediaFetcherPort`,
 * `UnopimMediaFetcherPort`, `AkeneoMediaFetcherPort` and `ComarchXlCradle` — and
 * there are now none: `grep -c 'packages/modules/<any paid id>/'` over that file
 * is **0**. What is left of the paid modules there is **three bare specifiers**
 * at a published subpath, `@endora-commerce/mod-{pim-ergonode,pim-pimcore,pim-unopim}/backend`,
 * typing three handle fields. Those resolve out of `node_modules` against the
 * published package rather than out of a directory, so a paid module leaving the
 * tree does not break the compile — it becomes an undeclared dependency, which is
 * a different and answerable problem. They retire the way `ksef`'s did, through a
 * handle accessor the module publishes from its own `./test-support`.
 */

/**
 * Specifiers that resolve into a module package.
 *
 * Retired by 109 T050/T051: each is here because a member of
 * `BackendServerOptions` or `BackendServerHandle` is typed by it. **None is a
 * relative reach into a paid module's `src/` any more** — that was the whole of
 * the hard stop and it is the whole of what T013 removed.
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
  '../../../packages/modules/mfa/src/backend/services/oauth-provider-service.js',
  '../../../packages/modules/organizations/src/backend/index.js',
  '../../../packages/modules/organizations/src/backend/services/organization-context-service.js',
  '../../../packages/modules/organizations/src/backend/services/organization-moderation-service.js',
  '../../../packages/modules/organizations/src/backend/services/organization-restriction-service.js',
  '../../../packages/modules/organizations/src/backend/services/vat-validator-port.js',
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
  '@endora-commerce/mod-customer-accounts/backend',
  '@endora-commerce/mod-i18n/backend',
  '@endora-commerce/mod-megamenu/backend',
  '@endora-commerce/mod-pim-ergonode/backend',
  '@endora-commerce/mod-pim-pimcore/backend',
  '@endora-commerce/mod-pim-unopim/backend',
  '@endora-commerce/mod-promotions/backend',
];

/**
 * `Interface.member` pairs whose type names a module package.
 *
 * Retired by 109 T050 (the handle) and T051 (the options). Feature 109 SC-003 is
 * these two counts reaching zero. Seven option members went with T013 — the six
 * PIM/ERP source and media seams and `ksefClientFactory` — replaced by one
 * host-shaped `registrations` field merged one level deep over what each module
 * contributes from its own `src/test-support/index.ts`; and one handle member,
 * `ksef`, replaced by `ksefHandle(h.container)`, which that package publishes.
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
  'BackendServerOptions.feedDeliveryAdapters',
  'BackendServerOptions.invoiceLedgerPresence',
  'BackendServerOptions.organizationsMailer',
  'BackendServerOptions.promptActionsLlmFetch',
  'BackendServerOptions.taxonomySourceFetcher',
];

/**
 * Table names a module package owns, written into this root's wipe list.
 *
 * Retired by 109 T060-T064: the set a composition empties is contributed by the
 * modules in it. **100 when T012 landed, 80 now, and 0 of them paid** — T014 took
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
