import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Built-in settings manifest for the sales-channels module — feature 005.
 *
 * Reserves the `sales_channels` setting group so future channel-related
 * knobs (default theme, host-map default, etc.) have a stable home.
 */
const settings = defineModuleSettingsManifest({
  moduleCode: 'sales_channels',
  groups: [
    {
      code: 'sales_channels',
      name: 'Sales Channels',
    },
  ],
  settings: [
    {
      code: 'sales_channels.storefront_url',
      name: 'Storefront URL',
      description:
        'Public base URL of the storefront for this sales channel. Used by the SEO sitemap generator and any other module that stamps absolute URLs into outgoing payloads. Empty value falls back to STOREFRONT_BASE_URL env.',
      groupCode: 'sales_channels',
      valueType: 'string',
      defaultValue: '',
    },
  ],
});

/** Module-lifecycle manifest (feature 018). */
export const manifest = defineModuleManifest({
  id: 'sales_channels',
  name: 'Sales Channels',
  description: 'Multi-channel storefront resolver and channel registry.',
  version: '1.0.0',
  // Rule 2 (bridge owner) — specs/065-manifest-aware-migrations/research.md §R9.
  // This module owns nine `sales_channel_*` membership bridges plus
  // `sales_channels.logo_asset_id`, so its tables foreign-key nine other
  // modules. None of those edges is declared: the module that cannot function
  // without channel scoping is the *domain* module, and every one of them
  // already declares `sales_channels`. Four of the nine reverse edges close a
  // cycle outright — sales_channels → catalog → sales_channels,
  // sales_channels → cms → sales_channels,
  // sales_channels → promotions → sales_channels, and
  // sales_channels → customer_accounts → price_lists → catalog →
  // sales_channels; together they are what made the naive union a 9-node SCC.
  // The remaining five (assets_library, delivery_methods, organizations,
  // payment_methods, taxes) close no cycle but are dropped by the same rule: a
  // bridge owner declaring what it bridges inverts the ownership direction.
  // Eight are recorded in test/unit/db/acknowledged-fk-edges.ts; the ninth,
  // `sales_channels.logo_asset_id → assets`, is recorded there as
  // `kernel → assets_library` because feature 072 T019 moved the SalesChannel
  // entity — and with it the ownership of the `sales_channels` table — into the
  // kernel. The nine bridge tables stay owned by this module.
  //
  // Forward-looking convention: a new bridge table for module X is owned by X's
  // migration, so X → sales_channels covers it and no new exception is needed.
  dependencies: ['dictionaries', 'settings'],
  settings,
  // Feature 074 (Constitution XVII), test C2 — functional base, and named by
  // ruling 1. Channel scoping is structural: Principle XII is non-negotiable,
  // every scoped read resolves the request's channel through the sanctioned
  // accessors, and there is no unscoped read path to fall back to. The control
  // this replaces was one of the nineteen that never accepted a deactivation
  // — nineteen dependents refused it — so the lock takes away a dead button
  // and adds a stated reason.
  //
  // `sales_channels.enabled` goes with it. Left declared it would fall through
  // to an ordinary editable boolean that changes nothing; the existing rows are
  // removed by a core data migration (feature 074, FR-010a), because the
  // settings reconciler reports orphans and never deletes them.
  activation: {
    nonDeactivatable: true,
    reason:
      'Channel scoping is structural: every scoped read resolves the request\'s channel and ' +
      'there is no unscoped path to fall back to.',
  },
  /**
   * The twelve error codes this module owns — feature 090 Phase 3
   * (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md`
   * §1.1). This is where the sentence for each is looked up from: `errors.<CODE>`
   * in this module's own `i18n/{en,pl}.json`, which holds all twelve in both
   * languages and holds no other `errors.*` key. None of them is a
   * `check-error-translations.ts` `UNTRANSLATED_ERROR_CODES` entry.
   *
   * The list is answer-preserving, not a judgement (§6.2 and §6.5), and it was
   * not written by hand: it is the verbatim output of the runbook's step-1
   * derivation over the frozen capture at
   * `backend/test/fixtures/error-code-routing/chain-answers.ts`, which records
   * what the prefix chain in `@endora-commerce/mod-i18n` answered at
   * `49f3c6817`. Re-routing a code to a better owner is
   * `specs/082-error-code-ownership/rulings.md` §9's remaining work and is
   * deliberately not done here.
   *
   * **`UNKNOWN_OPTION` is not here, and it is the one a reader will look for.**
   * This module's rule in the chain is `UNKNOWN_` ∪ `SALES_CHANNEL_` ∪ a misc
   * set, so reading the rule's *source* claims `UNKNOWN_OPTION` for
   * `sales_channels`. The chain is an ordered `if` and `catalog`'s misc set
   * names that code two branches earlier, so the chain's *answer* is `catalog`
   * — which is what the capture records and what `catalog` declared in its own
   * migration. Trap T1: read the answer, never the rule. The other three
   * `UNKNOWN_` members of `ERROR_CODES` reach this rule and are here.
   *
   * **Four codes here look generic or look like another module's, and are
   * this module's by a decision an earlier feature made** (trap T2).
   * `CANNOT_MODIFY_SYSTEM_DEFAULT` and `ENTITY_WOULD_HAVE_ZERO_CHANNELS` name
   * no channel at all and arrive through the chain's misc set;
   * `UNKNOWN_CURRENCY_CODE` and `UNKNOWN_LANGUAGE_CODE` read like
   * `dictionaries` codes and arrive through the `UNKNOWN_` prefix. The inverse
   * holds as well: `CHANNEL_NO_WAREHOUSES`, `CHANNEL_WAREHOUSE_NOT_FOUND` and
   * `WAREHOUSE_IS_DEFAULT_FOR_CHANNELS` route to `inventory`,
   * `API_KEY_CHANNEL_MISMATCH` to `core`, `SETTING_OUT_OF_SCOPE_FOR_CHANNEL` to
   * `settings`, `CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE` to `cms` and
   * `MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE` to `megamenu`, so none of them is
   * declared here.
   *
   * **Five of the twelve are raised outside this package**, which is D-95.2
   * working as intended — routing follows the domain noun, never the thrower.
   * `@endora-commerce/platform`'s channel resolver and membership service raise
   * `MISSING_SALES_CHANNEL_CONTEXT`, `UNKNOWN_SALES_CHANNEL`,
   * `INACTIVE_SALES_CHANNEL` and `ENTITY_WOULD_HAVE_ZERO_CHANNELS` (the
   * `SalesChannel` entity moved to the kernel in feature 072 T019), and
   * `search`'s public route raises `MISSING_SALES_CHANNEL_CONTEXT` too. The
   * sentences stay here.
   *
   * **Three of the twelve are raised by nothing in the tree** —
   * `UNKNOWN_LANGUAGE_CODE`, `UNKNOWN_CURRENCY_CODE` and
   * `SALES_CHANNEL_ATTRIBUTION_IMMUTABLE`. The first two were superseded rather
   * than never built: feature 017 moved language and currency validation onto
   * the central dictionary, so an unknown code is refused as
   * `DICTIONARY_ENTRY_NOT_FOUND` by `dictionaryReferenceHttpError` in this module's own
   * service, and `test/contract/sales_channels/admin-crud-lifecycle.contract.test.ts`
   * asserts that answer while calling these two "legacy" in its own comment. The
   * third is a guard with nothing to guard: no admin route exposes
   * `salesChannelId` mutation on an order or a quote, so FR-012's immutability
   * is structural, and `specs/005-sales-channels/tasks.md` T044/T059 record the
   * guard as vacuous and deferred to the first route that would need it. All
   * three are declared anyway — ownership follows the capture and not the raise
   * sites (trap T10); dropping one reds the progress test as `undeclared` and
   * moves an answer this merge request is not allowed to move.
   *
   * No `tokens`: no code here carries a refusal discriminator. Derived from the
   * raise sites per the runbook's §5 — the envelope's `refusalToken` reads
   * `details.code` and nothing else, every `new HttpError` raising one of these
   * twelve passes either no fourth argument or the Zod-style
   * `Array<{path, issue}>`, which `refusalToken` ignores by construction; the
   * §5 raise-site scan attributes the tree's token-carrying codes to `core`,
   * `invoices` and `carts` and names none of these; and the bundles hold no
   * `errors.<CODE>.<token>` key in the other direction.
   */
  errorCodes: [
    { code: 'CANNOT_MODIFY_SYSTEM_DEFAULT' },
    { code: 'DUPLICATE_SALES_CHANNEL_CODE' },
    { code: 'ENTITY_WOULD_HAVE_ZERO_CHANNELS' },
    { code: 'INACTIVE_SALES_CHANNEL' },
    { code: 'MISSING_SALES_CHANNEL_CONTEXT' },
    { code: 'SALES_CHANNEL_ATTRIBUTION_IMMUTABLE' },
    { code: 'SALES_CHANNEL_CODE_IMMUTABLE' },
    { code: 'SALES_CHANNEL_HAS_ATTRIBUTIONS' },
    { code: 'STALE_SALES_CHANNEL_WRITE' },
    { code: 'UNKNOWN_CURRENCY_CODE' },
    { code: 'UNKNOWN_LANGUAGE_CODE' },
    { code: 'UNKNOWN_SALES_CHANNEL' },
  ],
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  permissions: [
    { code: 'sales_channels:read', label: 'View sales channels' },
    { code: 'sales_channels:write', label: 'Manage sales channels' },
  ],
  actions: [
    /**
     * The module's landing surface, declared by feature 091's Phase 4 batch 14.
     *
     * `AppShell.tsx` carried a hand-written *Navigate* row for
     * `/sales-channels` until that batch, and this module declared only the
     * *create* action beside it — so the roster was advertised by a copy the
     * server was never asked about while the create form was advertised by a
     * declaration it served. The destination, the code and the keywords are the
     * row's; the label and description are the two strings it rendered
     * (`appShell.nav.salesChannels`, `appShell.palette.sub.storefrontChannels`),
     * moved into this module's own bundle.
     */
    {
      id: 'open-sales-channels',
      labelKey: 'actions.openSalesChannels.label',
      descriptionKey: 'actions.openSalesChannels.description',
      icon: 'Store',
      targetRoute: '/sales-channels',
      requiredPermission: 'sales_channels:read',
      keywords: ['sales', 'channel', 'channels', 'kanał', 'sprzedaży'],
      weight: 160,
    },
    {
      id: 'new-sales-channel',
      labelKey: 'actions.newSalesChannel.label',
      descriptionKey: 'actions.newSalesChannel.description',
      icon: 'Layers',
      targetRoute: '/sales-channels/new',
      requiredPermission: 'sales_channels:write',
      keywords: ['channel', 'new', 'storefront', 'kanał', 'sprzedaży'],
      weight: 150,
    },
  ],
});

/** Legacy export retained for backward compatibility. */
export const salesChannelsManifest = settings;
