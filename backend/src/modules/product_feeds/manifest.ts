import {
  defineModuleManifest,
  defineModuleSettingsManifest,
  PRODUCT_FEED_SETTING_CODES,
} from '@b2b/contracts';

/**
 * Product Feed module — feature 067.
 *
 * Projects the catalogue into provider-shaped feed files (Google Merchant
 * Center, Meta, Amazon, eBay, Allegro), publishes each at a stable tokenised
 * URL the provider fetches anonymously, and regenerates them on a per-feed
 * cron schedule.
 *
 * The module owns its templates, feeds, runs, issues, artefacts and provider
 * taxonomies; every cross-module reach is an injected port wired in
 * `composition.ts`, never a deep import (Principle I).
 */

export const PRODUCT_FEEDS_READ_PERMISSION = 'product_feeds:read';
export const PRODUCT_FEEDS_WRITE_PERMISSION = 'product_feeds:write';

export const productFeedsSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'product_feeds',
  groups: [{ code: 'product_feeds', name: 'Product feeds' }],
  settings: [
    {
      code: PRODUCT_FEED_SETTING_CODES.ARTEFACT_RETENTION_COUNT,
      name: 'Generated files kept per feed',
      description:
        'How many previously generated files to keep for each feed, in addition to the one currently published. Older files are deleted after a successful run.',
      groupCode: 'product_feeds',
      valueType: 'number',
      defaultValue: 3,
    },
    {
      code: PRODUCT_FEED_SETTING_CODES.MAX_CONCURRENT_RUNS,
      name: 'Maximum concurrent feed generations',
      description:
        'How many feed generations may run at the same time in one worker process. Raise it only when the database and storage backend have headroom.',
      groupCode: 'product_feeds',
      valueType: 'number',
      defaultValue: 2,
    },
    {
      code: PRODUCT_FEED_SETTING_CODES.SKIP_SHARE_FAILURE_THRESHOLD,
      name: 'Skipped-item share that fails a run',
      description:
        'Fraction of considered products (0–1) that may be skipped before the run is failed instead of published, so a broken catalogue never replaces a good file.',
      groupCode: 'product_feeds',
      valueType: 'number',
      defaultValue: 0.5,
    },
    {
      code: PRODUCT_FEED_SETTING_CODES.STALE_CLAIM_TIMEOUT_MINUTES,
      name: 'Stale run timeout (minutes)',
      description:
        'How long a running generation may go without a heartbeat before it is treated as lost, released and marked failed.',
      groupCode: 'product_feeds',
      valueType: 'number',
      defaultValue: 30,
    },
    {
      code: PRODUCT_FEED_SETTING_CODES.RUN_ISSUE_CAP,
      name: 'Recorded issues per run',
      description:
        'Upper bound on the per-item skip/warning records stored for one run. The complete list is still exportable as a separate file.',
      groupCode: 'product_feeds',
      valueType: 'number',
      defaultValue: 1000,
    },
    {
      code: PRODUCT_FEED_SETTING_CODES.PUBLIC_FETCH_RATE_LIMIT_PER_MINUTE,
      name: 'Public feed requests per minute',
      description:
        'Rate limit applied to the anonymous feed URL. Providers fetch a feed a few times a day, so a low ceiling is safe.',
      groupCode: 'product_feeds',
      valueType: 'number',
      defaultValue: 60,
    },
    {
      code: PRODUCT_FEED_SETTING_CODES.CATEGORY_MAPPING_TREE_LIMIT,
      name: 'Category-mapping tree limit',
      description:
        'Above this many shop categories the category-mapping screen switches from the tree to a paged flat list grouped by parent.',
      groupCode: 'product_feeds',
      valueType: 'number',
      defaultValue: 1000,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'product_feeds',
  name: 'Product feeds',
  description:
    'Publishes the catalogue of a sales channel as a provider-shaped feed file (Google Merchant Center, Meta, Amazon, eBay, Allegro) at a stable tokenised URL, on a per-feed schedule.',
  version: '1.0.0',
  // FK-driven dependency set (plan.md § Migrations). Every cross-module foreign
  // key this module's tables declare must appear here, or
  // test/unit/db/fk-dependency-drift.test.ts fails.
  dependencies: [
    'admin_users',
    'assets_library',
    'catalog',
    'custom_fields',
    'languages',
    'price_lists',
    'sales_channels',
    'settings',
  ],
  settings: productFeedsSettingsManifest,
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    {
      code: PRODUCT_FEEDS_READ_PERMISSION,
      label: 'View product feeds',
      description:
        'Allows viewing feeds, feed templates, run history and category mappings. Does not allow downloading a generated file, which carries prices.',
    },
    {
      code: PRODUCT_FEEDS_WRITE_PERMISSION,
      label: 'Manage product feeds',
      description:
        'Allows creating and editing feeds and templates, generating a feed on demand, rotating or revoking its link, downloading generated files, and editing category mappings.',
    },
  ],
  actions: [
    {
      id: 'open-product-feeds',
      labelKey: 'actions.openProductFeeds.label',
      descriptionKey: 'actions.openProductFeeds.description',
      icon: 'Rss',
      targetRoute: '/product-feeds',
      requiredPermission: PRODUCT_FEEDS_READ_PERMISSION,
      keywords: ['feed', 'feed produktowy', 'google merchant', 'meta', 'katalog', 'xml', 'csv'],
      weight: 250,
    },
    {
      id: 'create-product-feed',
      labelKey: 'actions.createProductFeed.label',
      descriptionKey: 'actions.createProductFeed.description',
      icon: 'PlusCircle',
      targetRoute: '/product-feeds/new',
      requiredPermission: PRODUCT_FEEDS_WRITE_PERMISSION,
      keywords: ['feed', 'nowy feed', 'feed produktowy', 'google merchant', 'meta'],
      weight: 251,
    },
    {
      id: 'open-feed-templates',
      labelKey: 'actions.openFeedTemplates.label',
      descriptionKey: 'actions.openFeedTemplates.description',
      icon: 'FileText',
      targetRoute: '/product-feeds/templates',
      requiredPermission: PRODUCT_FEEDS_READ_PERMISSION,
      keywords: ['szablon feedu', 'template', 'feed', 'xml', 'csv', 'pola'],
      weight: 252,
    },
    {
      // The import flow has no sidebar entry either — it is reached from the
      // template list — so the palette is the second way in (ux-design §1.2).
      id: 'import-feed-template',
      labelKey: 'actions.importFeedTemplate.label',
      descriptionKey: 'actions.importFeedTemplate.description',
      icon: 'Upload',
      targetRoute: '/product-feeds/templates/import',
      requiredPermission: PRODUCT_FEEDS_WRITE_PERMISSION,
      keywords: ['import', 'szablon feedu', 'template', 'wczytaj', 'json'],
      weight: 253,
    },
    {
      // The category-mapping screen deliberately has no sidebar entry
      // (ux-design.md §1.1), so the palette is its only discovery path.
      id: 'open-feed-category-mapping',
      labelKey: 'actions.openFeedCategoryMapping.label',
      descriptionKey: 'actions.openFeedCategoryMapping.description',
      icon: 'Layers',
      targetRoute: '/product-feeds/category-mapping',
      requiredPermission: PRODUCT_FEEDS_WRITE_PERMISSION,
      keywords: ['taksonomia', 'mapowanie kategorii', 'kategorie', 'google merchant', 'meta'],
      weight: 254,
    },
  ],
});
