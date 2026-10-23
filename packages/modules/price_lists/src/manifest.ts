import {
  defineModuleManifest,
  defineModuleRecentActivity,
  defineModuleSettingsManifest,
  PRICING_SETTING_CODES,
  SHOW_LIST_PRICE_SETTING_CODE,
} from '@endora-commerce/contracts';

/**
 * Admin permission codes owned by this module (issue #219).
 *
 * Before these existed every admin route here was gated by `catalog:write`, so
 * a role granted catalogue content work could change what customers pay. That
 * boundary was never chosen — it was the side effect of the module declaring no
 * codes of its own. Pricing is not catalogue content.
 *
 * The split is read/write rather than one code because the two authorities are
 * genuinely different: reading a price book, its rows and the price explainer
 * is what an operator needs to understand a quoted price, while editing a row
 * or a base price changes what a customer is charged.
 */
export const PRICE_LIST_PERMISSIONS = {
  READ: 'price_lists:read',
  WRITE: 'price_lists:write',
} as const;

/**
 * Settings manifest for the Price Lists module — feature 011.
 *
 * Two settings (FR-037). Setting codes follow the foundation regex
 * `^[a-z][a-z0-9_][a-z0-9_.]*[a-z0-9]$`.
 */
const settings = defineModuleSettingsManifest({
  moduleCode: 'price_lists',
  groups: [{ code: 'pricing', name: 'Pricing' }],
  settings: [
    {
      code: PRICING_SETTING_CODES.DEFAULT_DISPLAY_MODE,
      name: 'Default price display mode',
      description:
        'How storefront product surfaces render prices for signed-in customers: gross_only / net_only / both / none.',
      groupCode: 'pricing',
      valueType: 'string',
      defaultValue: 'gross_only',
      enumOptions: ['gross_only', 'net_only', 'both', 'none'],
    },
    {
      code: PRICING_SETTING_CODES.UNAUTHENTICATED_DISPLAY_MODE,
      name: 'Unauthenticated price display mode',
      description:
        'Display mode for anonymous (not signed in) visitors. Defaults to the same as `default_display_mode` — set to `none` to hide prices until login.',
      groupCode: 'pricing',
      valueType: 'string',
      defaultValue: 'gross_only',
      enumOptions: ['gross_only', 'net_only', 'both', 'none'],
    },
    {
      // Feature 160 (G8 of `specs/161-price-book-editor/`, owner ruling Q8a):
      // show the catalogue price beside a buyer's lower price on the product
      // page and listing cards. Platform-wide; never in the basket or checkout.
      code: SHOW_LIST_PRICE_SETTING_CODE,
      name: 'Show list price beside the buyer price',
      description:
        "When on, a buyer whose price is below the catalogue price sees both on the product page and listing cards (never in the basket or checkout). Off by default.",
      groupCode: 'pricing',
      valueType: 'boolean',
      defaultValue: false,
    },
  ],
});

/** Module-lifecycle manifest (feature 018). */
export const manifest = defineModuleManifest({
  id: 'price_lists',
  name: 'Price Lists',
  description:
    'Price books — base, catalogue, buyer and sale prices per currency, sales channel and audience — and price display modes.',
  version: '1.0.0',
  // `customer_accounts` since feature 076 (D-79): customer groups moved to the
  // module that owns the customer, so this module reads `customerGroupReadPort`
  // for the rule-target picker and its validation, and `customerAccountReadPort`
  // for the admin resolved-price probe. Both fail closed, which is why the edge
  // is binding — pricing for a customer the platform will not identify is worse
  // than refusing the probe.
  // `currencies` owns `currencyReferenceRegistry`, the registry this module
  // contributes its "who still prices in this currency" descriptor to (feature
  // 077, D-87). `currencies` used to ask the question itself, with a
  // `count(*) from "price_lists"` naming this module's table.
  // `audit_logs` owns `auditReferenceRegistry`, the registry this module pushes
  // its own "what is this audit row called, and where does the admin app show
  // it?" resolver into (feature 075, D-87). The registry is ungated and its
  // owner is non-deactivatable, so the declaration buys install and migration
  // order rather than a flip-time refusal.
  dependencies: [
    'audit_logs',
    'catalog',
    'currencies',
    'customer_accounts',
    'organizations',
    'settings',
  ],
  permissions: [
    { code: PRICE_LIST_PERMISSIONS.READ, label: 'View price books and display modes' },
    {
      code: PRICE_LIST_PERMISSIONS.WRITE,
      label: 'Edit price books, base prices and display modes',
      // Advisory (D-175): adding product lines uses the catalogue's product
      // browser and a product's variants come from the catalogue's admin
      // variant read, both on `catalog:read` (feature 161).
      requires: ['catalog:read'],
    },
  ],
  /**
   * The palette advertisements (Principle XVI): the landing screen since
   * feature 091's Phase 4 batch 13, and the price-book editor's two other
   * entry points since feature 161 (FR-029, `research.md` R3; moved from
   * spec 160 T105, whose target screens did not exist yet).
   *
   * `open-price-lists` replaced a hand-written `PALETTE_ITEMS` row in
   * `admin/src/components/AppShell.tsx` and carries that row's code and
   * keywords, so an operator's ⌘K answer for *cennik* is what it was. Feature
   * 160 pointed it at the display-mode page while there was no book list;
   * feature 161 points it back at `/price-lists`.
   *
   * Each `requiredPermission` is the code its `targetRoute` opens on in this
   * module's `./admin` declaration — read off the route rather than chosen, so
   * the palette never advertises a screen the code cannot open (issue #232;
   * `check:action-route-permissions`). The create flow opens on the write code,
   * the `/new` shape of `blog` and `sales_channels`. Labels and descriptions
   * are this module's own bundle's.
   */
  actions: [
    {
      id: 'open-price-lists',
      labelKey: 'actions.openPriceLists.label',
      descriptionKey: 'actions.openPriceLists.description',
      icon: 'CircleDollarSign',
      targetRoute: '/price-lists',
      requiredPermission: PRICE_LIST_PERMISSIONS.READ,
      keywords: ['pricing', 'prices', 'price list', 'price book', 'cennik', 'cenniki'],
      weight: 240,
    },
    {
      id: 'new-price-book',
      labelKey: 'actions.newPriceBook.label',
      descriptionKey: 'actions.newPriceBook.description',
      icon: 'PlusCircle',
      targetRoute: '/price-lists/new',
      requiredPermission: PRICE_LIST_PERMISSIONS.WRITE,
      // Polish keywords are written folded: the palette folds diacritics on both
      // sides of the match (`foldDiacritics`), and a module's sources default to
      // English (`check:default-language-prose`).
      keywords: ['new price book', 'create price list', 'nowy cennik', 'utworz cennik'],
      weight: 241,
    },
    {
      id: 'open-price-explainer',
      labelKey: 'actions.openPriceExplainer.label',
      descriptionKey: 'actions.openPriceExplainer.description',
      icon: 'Search',
      targetRoute: '/price-lists/explain',
      requiredPermission: PRICE_LIST_PERMISSIONS.READ,
      keywords: ['why this price', 'price explanation', 'explain price', 'wyjasnienie ceny', 'dlaczego ta cena'],
      weight: 242,
    },
    {
      // Feature 161, Checkpoint 10 ruling (Principle XVI): *Pricing settings*
      // has no sidebar entry; the palette and the list header reach it.
      id: 'open-pricing-settings',
      labelKey: 'actions.openPricingSettings.label',
      descriptionKey: 'actions.openPricingSettings.description',
      icon: 'Settings',
      targetRoute: '/price-lists/display-modes',
      requiredPermission: PRICE_LIST_PERMISSIONS.READ,
      keywords: ['pricing settings', 'display mode', 'precedence', 'list price', 'ustawienia cenowe', 'kolejnosc cen', 'cena katalogowa'],
      weight: 243,
    },
  ],
  settings,
  // Feature 074 (Constitution XVII), test C2 — functional base, and one of the
  // escalation answers. B2B *is* contract pricing. The deciding fact is the
  // same shape as `taxes`: absent, the resolution falls back to the base price
  // silently, so every buyer pays list and nothing on any surface says so. A
  // platform where that happens is a B2C shop, not a reduced B2B one.
  //
  // As with `taxes` this closes the operator route only; the platform route —
  // a deployment that never installs the module — is a separate follow-up.
  //
  // `price_lists.enabled` goes with the control it backed: one of the nineteen
  // that never accepted a deactivation. The existing rows are removed by a core
  // data migration (feature 074, FR-010a).
  activation: {
    nonDeactivatable: true,
    reason:
      'B2B is contract pricing. Absent, every buyer silently pays base price, which makes the ' +
      'platform a B2C shop rather than a reduced B2B one.',
  },
  /**
    * Nothing to demonstrate of its own (feature 113, T225 — contract §1.2).
    *
    * The demo's prices — a base price for every demo product and the price
    * books of the owner's scenarios E1–E3 (feature 160, FR-044) — each name
    * another module's row (a product, the *Screws* category, the demo
    * organisation, the VIP group, the demo channel), so they are a composition
    * step of `@endora-commerce/demo-composition` and not this module's demo
    * data (§5.1). This module writes them, through `seedDemoPriceBooks` and
    * `withdrawDemoPriceBooks` on `./backend`. The base books themselves are
    * **platform data**: a migration creates them and the platform needs them
    * whether or not anybody ever seeds a demo.
    *
    * `false` rather than absent, because the two are different states: this is
    * a decision that the module owes nothing, not a module nobody has looked at.
    */
  demo: false,
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  /**
   * `PRICE_LIST_NOT_FOUND` — D-129's remaining sweep, Tier A
   * (`specs/090-module-owned-error-codes/d129-sweep.md` §5.2, Appendix A;
   * MR 3).
   *
   * Declared by `_i18n` until this merge request, not because anybody judged
   * it the platform's but because the deleted prefix chain had no rule for it
   * and its last line was `return 'core'`. **D-121 T1 puts it here**: the noun
   * is a price list, which is this module's own entity.
   *
   * **It is the sweep's cleanest disagreement with the raise-site count**
   * (`d129-sweep.md` §2.2). The one place that raises it is
   * `pim_ergonode`'s mapping service, which asks this module's read port for a
   * price list, gets a 404 and re-answers it under a name of its own; that
   * makes `pim_ergonode` the caller and not the owner. It is why the prefix
   * split in MR 2 was deliberate: `pim_ergonode` took thirteen codes in that
   * batch and left this one behind precisely because it does not name an
   * Ergonode noun.
   *
   * **No sentence moves with it.** It has none in either language anywhere in
   * the tree; it was already on `UNTRANSLATED_ERROR_CODES` under `_i18n` and
   * moves to this module's group there, so the bundle this module already
   * ships gains no key. The admin's Ergonode price-binding screen maps the
   * code to its own copy (`admin/src/modules/pim_ergonode/api.ts`), which is a
   * surface string and not the envelope's sentence.
   *
   * **`tokens` is derived from the raise sites, not from the bundle**
   * (runbook §5), and there are none: the single raise is a bare
   * `HttpError(404, code, message)` with no `details`.
   *
   * **The neighbouring code that does *not* come here is `PRICE_UNAVAILABLE`**,
   * and the reason is written down so nobody moves it in passing: the noun
   * "price" is claimed by `catalog` and by this module both, which is D-122's
   * condition, and nothing raises it. It stays with the platform (`d129-sweep.md`
   * §2.4).
   */
  errorCodes: [
    { code: 'PRICE_LIST_NOT_FOUND' },
    // Feature 160 — the price-book API (`contracts/admin-price-books-api.md`).
    // Each carries a sentence in both bundles; `details` (the failing rows, the
    // current version) is for the admin UI's placement, not interpolated.
    { code: 'PRICE_BOOK_CHANNEL_CURRENCY' },
    { code: 'PRICE_BOOK_AUDIENCE_KIND' },
    { code: 'PRICE_BOOK_IMMUTABLE_FIELD' },
    { code: 'PRICE_BOOK_NOT_APPLICABLE' },
    { code: 'PRICE_BOOK_ROW_OVERLAP' },
    { code: 'PRICE_BOOK_ROW_SHAPE' },
    { code: 'PRICE_BOOK_ROW_TARGET' },
    { code: 'PRICE_BOOK_ROW_LIMIT' },
    { code: 'PRICE_BOOK_STALE' },
    { code: 'PRECEDENCE_CHANGE_UNAVAILABLE' },
  ],
});

/** Legacy export retained for backward compatibility. */
export const priceListsManifest = settings;

/**
 * What this module offers the admin home dashboard's Recent Activity card —
 * feature 080, T042j / D-163.1.
 *
 * The **declaration** axis: eligibility, never a decision. Whether these rows
 * appear is the operator's, held in `price_lists.recent_activity_visible` and
 * defaulting to visible, flipped beside this module's activation control on the
 * platform modules screen.
 */
export const recentActivity = defineModuleRecentActivity({
  entries: [
    {
      action: 'price_list.create',
      icon: 'CircleDollarSign',
      labelKey: 'activity.verb.price_list.create',
    },
    { action: 'price_list.update', icon: 'Edit', labelKey: 'activity.verb.price_list.update' },
    {
      action: 'price_list.activate',
      icon: 'CircleDollarSign',
      labelKey: 'activity.verb.price_list.activate',
    },
    { action: 'price_list.draftify', icon: 'Edit', labelKey: 'activity.verb.price_list.draftify' },
    {
      action: 'price_list.duplicate',
      icon: 'Plus',
      labelKey: 'activity.verb.price_list.duplicate',
    },
    { action: 'price_list.expire', icon: 'Archive', labelKey: 'activity.verb.price_list.expire' },
    {
      action: 'price_list.products_replace',
      icon: 'Edit',
      labelKey: 'activity.verb.price_list.products_replace',
    },
    {
      action: 'price_list.products_add',
      icon: 'Plus',
      labelKey: 'activity.verb.price_list.products_add',
    },
    {
      action: 'price_list.bracket_update',
      icon: 'CircleDollarSign',
      labelKey: 'activity.verb.price_list.bracket_update',
    },
    // Feature 148 — the price matrix.
    {
      action: 'price_list.matrix_entry_create',
      icon: 'Plus',
      labelKey: 'activity.verb.price_list.matrix_entry_create',
    },
    {
      action: 'price_list.matrix_entry_update',
      icon: 'Edit',
      labelKey: 'activity.verb.price_list.matrix_entry_update',
    },
    {
      action: 'price_list.matrix_entry_delete',
      icon: 'Archive',
      labelKey: 'activity.verb.price_list.matrix_entry_delete',
    },
    // Feature 160 — price books.
    {
      action: 'price_list.base_prices_set',
      icon: 'CircleDollarSign',
      labelKey: 'activity.verb.price_list.base_prices_set',
    },
    {
      action: 'price_list.channels_replace',
      icon: 'Edit',
      labelKey: 'activity.verb.price_list.channels_replace',
    },
    {
      action: 'price_list.rows_replace',
      icon: 'Edit',
      labelKey: 'activity.verb.price_list.rows_replace',
    },
    { action: 'price_list.delete', icon: 'Archive', labelKey: 'activity.verb.price_list.delete' },
  ],
});
