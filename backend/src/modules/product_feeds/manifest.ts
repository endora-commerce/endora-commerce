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

/**
 * Weekly, Monday 04:00 **UTC** (research §R21). Per-feed schedules carry an
 * IANA zone because an operator reasons about "before the shop opens"; nobody
 * reasons about when a taxonomy check runs, so fixing it to UTC removes a DST
 * question with no user-visible payoff.
 */
export const DEFAULT_TAXONOMY_FETCH_CRON = '0 4 * * 1';

/**
 * The providers' own published addresses (FR-090). Shipped as defaults, and
 * overridable per deployment so an installation can point the check at an
 * internal mirror or at a proxy its egress policy permits — which is also the
 * supported answer for a deployment behind a proxy, because Node's global
 * `fetch` ignores `HTTPS_PROXY` and teaching it to would mean a new dependency.
 */
export const DEFAULT_TAXONOMY_SOURCE_URLS = {
  google_merchant: {
    en: 'https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt',
    pl: 'https://www.google.com/basepages/producttype/taxonomy-with-ids.pl-PL.txt',
  },
  meta: {
    en: 'https://www.facebook.com/products/categories/en_US.txt',
    pl: 'https://www.facebook.com/products/categories/pl_PL.txt',
  },
} as const;

export const productFeedsSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'product_feeds',
  groups: [
    { code: 'product_feeds', name: 'Product feeds' },
    // Feature 067 Phase 11 — the taxonomy revision refresh (research §R24).
    // A group of its own because it is the one place on the platform that
    // decides whether this module opens an outbound socket at all, and it has
    // to disclose the exact addresses before the switch is flipped.
    { code: 'product_feeds_taxonomy', name: 'Taxonomy updates' },
  ],
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
    // Feature 070 — delivery. Both are operator policy, unlike the egress and
    // timeout limits in `FEED_DELIVERY_LIMITS`, which are safety floors and
    // therefore deliberately not settings.
    {
      code: PRODUCT_FEED_SETTING_CODES.DELIVERY_MAX_ATTEMPTS,
      name: 'Delivery attempts per generated file',
      description:
        'How many times to try pushing a generated file to the configured server before giving up and notifying an administrator. Attempts are spaced out with an increasing delay. The published link keeps working either way.',
      groupCode: 'product_feeds',
      valueType: 'number',
      defaultValue: 5,
    },
    {
      code: PRODUCT_FEED_SETTING_CODES.DELIVERY_TEST_RATE_LIMIT_PER_HOUR,
      name: 'Delivery connection tests per hour',
      description:
        'Ceiling on how often the "Test connection" button may contact a delivery target, per feed. Set to 0 to remove the limit.',
      groupCode: 'product_feeds',
      valueType: 'number',
      defaultValue: 20,
    },

    // -----------------------------------------------------------------------
    // Group `product_feeds_taxonomy` — revision refresh (FR-086 – FR-099).
    //
    // These strings ship in English only: `defineModuleSettingsManifest` has no
    // `nameKey`/`descriptionKey`, unlike manifest actions, so no setting on this
    // platform is translated. The bilingual consent copy therefore lives on the
    // module's own screen, where the module's `en`/`pl` bundle applies
    // (ux-design §2.13).
    // -----------------------------------------------------------------------
    {
      code: PRODUCT_FEED_SETTING_CODES.TAXONOMY_FETCH_ENABLED,
      name: 'Check for new taxonomy revisions',
      description:
        'When on, once per the schedule below the platform downloads the Google and Meta category lists from the addresses below and nothing else. A downloaded list is installed but not used: an administrator promotes it on Product feeds → Taxonomy updates after reading what it would change. Off by default; off means no request is made at all.',
      groupCode: 'product_feeds_taxonomy',
      valueType: 'boolean',
      // FR-087 / research §R24 — a default must not silently change a product's
      // network behaviour, and off must be the state every dev environment and
      // every CI run exercises.
      defaultValue: false,
    },
    {
      code: PRODUCT_FEED_SETTING_CODES.TAXONOMY_FETCH_CRON,
      name: 'When to check',
      description:
        'Cron expression, interpreted in UTC. Defaults to Monday at 04:00. These lists change once or twice a year, so checking more often than weekly buys nothing.',
      groupCode: 'product_feeds_taxonomy',
      valueType: 'string',
      defaultValue: DEFAULT_TAXONOMY_FETCH_CRON,
    },
    {
      code: PRODUCT_FEED_SETTING_CODES.TAXONOMY_SOURCE_URL_GOOGLE_EN,
      name: 'Google category list (English)',
      description:
        "Address of Google's taxonomy-with-ids.en-US.txt. Point it at an internal mirror or a proxy if this platform cannot reach Google directly. https only.",
      groupCode: 'product_feeds_taxonomy',
      valueType: 'string',
      defaultValue: DEFAULT_TAXONOMY_SOURCE_URLS.google_merchant.en,
    },
    {
      code: PRODUCT_FEED_SETTING_CODES.TAXONOMY_SOURCE_URL_GOOGLE_PL,
      name: 'Google category list (Polish)',
      description:
        "Address of Google's taxonomy-with-ids.pl-PL.txt. A revision is installed only when both languages download successfully.",
      groupCode: 'product_feeds_taxonomy',
      valueType: 'string',
      defaultValue: DEFAULT_TAXONOMY_SOURCE_URLS.google_merchant.pl,
    },
    {
      code: PRODUCT_FEED_SETTING_CODES.TAXONOMY_SOURCE_URL_META_EN,
      name: 'Meta category list (English)',
      description: "Address of Meta's en_US.txt product category file. https only.",
      groupCode: 'product_feeds_taxonomy',
      valueType: 'string',
      defaultValue: DEFAULT_TAXONOMY_SOURCE_URLS.meta.en,
    },
    {
      code: PRODUCT_FEED_SETTING_CODES.TAXONOMY_SOURCE_URL_META_PL,
      name: 'Meta category list (Polish)',
      description:
        "Address of Meta's pl_PL.txt product category file. A revision is installed only when both languages download successfully.",
      groupCode: 'product_feeds_taxonomy',
      valueType: 'string',
      defaultValue: DEFAULT_TAXONOMY_SOURCE_URLS.meta.pl,
    },
    {
      code: PRODUCT_FEED_SETTING_CODES.TAXONOMY_REVISION_RETENTION_COUNT,
      name: 'Category lists kept per provider',
      description:
        'How many revisions to keep. The list in use, the newest one nobody has decided about, and any list still holding a category one of your mappings points at are never deleted, whatever this is set to.',
      groupCode: 'product_feeds_taxonomy',
      valueType: 'number',
      defaultValue: 3,
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
    // A service dependency, not an FK-driven one (feature 070): every secret a
    // delivery target needs is stored through the credentials module, and
    // `product_feed_deliveries.credential_code` is a pointer by stable code
    // rather than a foreign key — the shape `pim_ergonode` already carries.
    'credentials',
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
    {
      // The taxonomy-updates screen has no sidebar entry either: it is reached
      // from the category-mapping header, so the palette is its second way in.
      // `Download` is already in `KnownIconNameSchema`, so no icon-map change.
      id: 'open-feed-taxonomy-revisions',
      labelKey: 'actions.openFeedTaxonomyRevisions.label',
      descriptionKey: 'actions.openFeedTaxonomyRevisions.description',
      icon: 'Download',
      targetRoute: '/product-feeds/taxonomy-revisions',
      requiredPermission: PRODUCT_FEEDS_READ_PERMISSION,
      keywords: [
        'aktualizacja taksonomii',
        'nowa wersja',
        'wersja taksonomii',
        'pobieranie taksonomii',
        'taxonomy update',
        'revision',
      ],
      weight: 255,
    },
  ],
});
