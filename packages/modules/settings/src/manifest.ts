import {
  defineModuleManifest,
  defineModuleSettingsManifest,
  type ModuleCliCommand,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';

/**
 * Built-in settings manifest for the settings module itself — feature 004.
 *
 * Seeds the platform-wide `general` group on every backend boot so other
 * modules' manifests can default-attach to it without a chicken-and-egg
 * problem. The group is `isSystemProtected: true`, which the admin service
 * refuses to delete.
 */
const settings = defineModuleSettingsManifest({
  moduleCode: 'settings',
  groups: [
    {
      code: 'general',
      name: 'General',
      isSystemProtected: true,
      // Empty salesChannelCodes ⇒ applies to every sales channel.
    },
    {
      // Shop / company contact information surfaced across the storefront
      // (footer, 404 "need help?" block, contact form recipients, etc.).
      code: 'shop',
      name: 'Shop information',
      // Empty salesChannelCodes ⇒ applies to every sales channel; values can
      // still be overridden per channel via the standard scope mechanism.
    },
    {
      // Storefront-template behaviour toggles (performance hints, etc.).
      code: 'storefront',
      name: 'Storefront',
    },
  ],
  settings: [
    {
      // Image URL shown when a product has no image of its own, on product
      // cards / listings (and the product page). Resolvable globally or
      // per sales channel via the standard settings scope mechanism.
      code: 'product_image_placeholder_url',
      name: 'Product image placeholder',
      description:
        'Image displayed on product cards and listings when a product has no ' +
        'image of its own. Upload a file (drag-and-drop or file picker) or enter ' +
        'an image URL. Leave empty to show no placeholder. Can be overridden per ' +
        'sales channel.',
      groupCode: 'general',
      valueType: 'string',
      defaultValue: '',
    },
    {
      // Minutes of inactivity after which an admin is signed out of the Admin
      // UI. Enforced client-side by an idle timer in the admin app.
      code: 'admin.idle_logout_minutes',
      name: 'Admin idle logout (minutes)',
      description:
        'Number of minutes of inactivity after which an administrator is ' +
        'automatically signed out of the Admin UI. Default 60.',
      groupCode: 'general',
      valueType: 'number',
      defaultValue: 60,
    },
    {
      // Slug (URL path) of the CMS page to serve as the storefront home page.
      // Empty ⇒ the storefront falls back to its built-in landing page. Can be
      // overridden per sales channel.
      code: 'homepage_cms_page_slug',
      name: 'Home page CMS page',
      description:
        'Slug (URL path) of the CMS page to use as the storefront home page, ' +
        'e.g. "welcome". Leave empty to use the built-in landing page. Can be ' +
        'overridden per sales channel.',
      groupCode: 'general',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: 'shop.name',
      name: 'Shop name',
      description: 'Public name of the shop, shown across the storefront.',
      groupCode: 'shop',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: 'shop.address',
      name: 'Shop address',
      description: 'Postal address of the shop, shown across the storefront.',
      groupCode: 'shop',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: 'shop.contact_email',
      name: 'Main contact email',
      description: 'Primary email address used for general contact.',
      groupCode: 'shop',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: 'shop.support_email',
      name: 'Support / customer service email',
      description:
        'Email address of the support / customer service desk. Shown to ' +
        'customers when they need help (e.g. on the 404 page).',
      groupCode: 'shop',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: 'shop.phone',
      name: 'Shop phone number',
      description: 'Contact phone number for the shop. May be left empty.',
      groupCode: 'shop',
      valueType: 'string',
      defaultValue: '',
    },
    {
      code: 'shop.contact_form_recipient_emails',
      name: 'Contact form recipient emails',
      description:
        'Recipient email address(es) for the storefront contact form. ' +
        'Multiple addresses can be provided, separated by commas.',
      groupCode: 'shop',
      valueType: 'string',
      defaultValue: '',
    },
    {
      // Speculation Rules (prerender/prefetch) hint emitted by the storefront
      // template for near-instant navigations.
      code: 'storefront.speculation_rules.enabled',
      name: 'Enable Speculation Rules',
      description:
        'Emit a Speculation Rules script in the storefront so the browser can ' +
        'prerender/prefetch likely next pages for near-instant navigation. ' +
        'Note: this setting only has an effect if the active Storefront UI ' +
        'theme supports the Speculation Rules mechanism; themes that do not ' +
        'implement it will ignore the toggle.',
      groupCode: 'storefront',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      // Eagerness level for the Speculation Rules above. "moderate" prerenders
      // on hover/pointer intent — the recommended balance between instant
      // navigation and resource use; "eager" speculates aggressively on every
      // eligible link, "conservative" only on pointer-down.
      code: 'storefront.speculation_rules.eagerness',
      name: 'Speculation Rules eagerness',
      description:
        'Eagerness for the storefront Speculation Rules: "conservative" ' +
        '(on pointer-down), "moderate" (on hover — recommended), or "eager" ' +
        '(as soon as links are discovered). Only applies when Speculation ' +
        'Rules are enabled and supported by the active Storefront UI theme.',
      groupCode: 'storefront',
      valueType: 'string',
      defaultValue: 'moderate',
      enumOptions: ['conservative', 'moderate', 'eager'],
    },
    {
      // Whether the storefront product card shows an "Add to cart" button.
      code: 'storefront.product_card.show_add_to_cart',
      name: 'Show "Add to cart" on product cards',
      description:
        'Toggles the "Add to cart" button on storefront product card listings. ' +
        'Only has an effect if the active Storefront UI theme renders the button.',
      groupCode: 'general',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      // Whether the storefront product card shows an "Add to shopping list"
      // button (adds the product to the customer's default shopping list).
      code: 'storefront.product_card.show_add_to_shopping_list',
      name: 'Show "Add to shopping list" on product cards',
      description:
        'Toggles the "Add to shopping list" button on storefront product card ' +
        'listings; clicking it adds the product to the customer\'s default ' +
        'shopping list. Only has an effect if the active Storefront UI theme ' +
        'renders the button.',
      groupCode: 'general',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

/** Module-lifecycle manifest (feature 018) + i18n bundle declaration (feature 019). */
export const manifest = defineModuleManifest({
  id: 'settings',
  name: 'Settings',
  description: 'Per-module setting registry, admin UI, and value resolver.',
  version: '1.0.0',
  // Rule 1 (platform root) — specs/065-manifest-aware-migrations/research.md §R9.
  // `setting_values.sales_channel_id`, `setting_sales_channels` and
  // `setting_group_sales_channels` foreign-key `sales_channels`, and the edge is
  // deliberately not declared: settings is a platform root that every other
  // module (including sales_channels itself) installs on top of, and declaring
  // it would cycle settings → sales_channels → settings.
  //
  // Since feature 072 (T018/T019) all four of those tables are kernel-owned, so
  // the edge no longer crosses a module boundary at all and the acknowledged
  // entry in test/unit/db/acknowledged-fk-edges.ts has been removed. The
  // reasoning is kept because it is why this module declares no edge to
  // `sales_channels`.
  //
  // Feature 072 (T118) — `auth` *is* declared: the admin routes are gated by
  // `requireAdmin` and name the acting admin through `adminAuditActorResolver`,
  // both of which `auth` owns. It closes no cycle (`auth` → `admin_roles` → ∅)
  // and shifts no migration order, because T018 moved this module's tables into
  // the kernel and it ships no migrations of its own.
  dependencies: ['auth'],
  settings,
  // Feature 074 (Constitution XVII), test C2 — functional base, and named by
  // ruling 1. The control that used to be here was one of the nineteen that
  // never accepted a deactivation; making the lock explicit replaces an
  // accidental refusal with a declared one and takes the dead button off the
  // screen.
  //
  // The recoverability argument that used to carry the switch — D-36 moved the
  // activation controls onto the kernel-served `/platform/modules`, T118 made
  // the settings reader kernel-composed — is still true and is why switching
  // this off is survivable. It is not why it should be offered. This module is
  // the configuration surface for every other one, and a module that is off
  // has no editable configuration, so `settings` off means nothing on the
  // platform is configurable: a different product, not a smaller one.
  //
  // `settings.enabled` goes with the control. Left declared it would classify
  // as an ordinary editable boolean that changes nothing, which is the
  // present-but-ignored shape Principle XVII prohibits; the reconciler never
  // deletes a row it stops seeing, so the existing rows are removed by a core
  // data migration instead (feature 074, FR-010a).
  activation: {
    nonDeactivatable: true,
    reason:
      'The configuration surface for every other module. A module that is off has no editable ' +
      'configuration, so switching this off would leave nothing on the platform configurable.',
  },
  /**
   * The ten error codes this module owns — feature 090 Phase 3
   * (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md`
   * §1.1). This is where each one's sentence is looked up from: `errors.<CODE>`
   * in this module's own `i18n/{en,pl}.json`.
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
   * Nine of the ten carry a written sentence in both languages in this
   * package's bundles, and those nine are exactly the `errors.*` keys those
   * bundles hold — so there is no dead sentence in either direction. The tenth,
   * `SETTING_SECRET_KEY_MISSING`, is already a `check-error-translations.ts`
   * `UNTRANSLATED_ERROR_CODES` entry and stays one; declaring it changes
   * nothing about that ledger, which is keyed off the chain.
   *
   * **No shadow reaches this module, and it is the one module that could have
   * cast one.** Trap T1 is about the chain being an ordered `if`, and
   * `SETTING_` is its *first* branch — ahead even of the generic set — so
   * nothing above it can claim a `SETTING_`-prefixed code and every such member
   * of `ERROR_CODES` lands here. Reading the rule's source and reading the
   * chain's answer coincide, which for a migrating author is a conclusion of
   * reading the whole chain and never a premise: the list below still comes off
   * the answer. Nor does this branch take anything from a later one — no
   * `SETTING_`-prefixed code belongs anywhere else under any reading.
   *
   * **Two codes here read like another module's, and both stay** (trap T2).
   * `SETTING_OUT_OF_SCOPE_FOR_CHANNEL` names a sales channel and !1125 recorded
   * it as a code `sales_channels` would look for and not find;
   * `SETTING_SECRET_KEY_MISSING` is raised out of a secret codec that
   * `@endora-commerce/platform`, `credentials` and `ksef` each ship a copy of.
   * Both are refusals about a setting's value, which is the noun the chain
   * follows.
   *
   * **The inverse holds and is the larger half.** This module raises four codes
   * it does not own: `MODULE_ACTIVATION_PROTECTED` (twice) and
   * `MODULE_SETTING_READ_ONLY` on the chain's `MODULE_` branch,
   * `VERSION_CONFLICT` and `INTERNAL` in its generic set — all four route to
   * `core` and are not declared here. And `invoices`'
   * `INVOICE_NUMBER_PATTERN_COLLIDES` is refused *inside this module's write
   * path*: the D-95.2 validator seam has `settings` answer "what would every
   * channel's value be after this write" and the declaring module answer "is
   * that legal", so the throw is `invoices`' own and !1121 declared it there.
   * Routing follows the domain noun, never the thrower.
   *
   * **Three of the ten are raised outside this package**, which is the same
   * rule seen from the other side and is why the raise-site grep is over
   * `packages backend/src` rather than over this module: the platform's
   * activation Command and `audit_logs`' recent-activity Command each raise
   * `SETTING_NOT_REGISTERED` when a module declares a setting the reconciler
   * never created a row for, and `search`'s LLM toggle raises
   * `SETTING_OUT_OF_SCOPE_FOR_CHANNEL`.
   *
   * **Two of the ten are raised by nothing, and they are a kind the register
   * does not yet hold** — `SETTING_CODE_CONFLICT` and
   * `SETTING_BREAKING_CHANGE_REJECTED`.
   * Both rules exist, both are enforced today and both are asserted by
   * `backend/test/unit/settings/manifest-reconciler.test.ts`; they refuse where
   * no envelope reaches. `@endora-commerce/platform`'s settings manifest
   * reconciler throws `SettingCodeConflict` and `BreakingChangeRejected`, plain
   * `Error` subclasses, at boot and on `module:install`, and a setting
   * *definition* has no HTTP door at all — `routes.admin.ts` exposes values and
   * groups and never definitions — so the HTTP code was never wired to the
   * refusal it names. That is none of the four kinds
   * `specs/deferred-defects.md` records: the schema does not pre-empt it, no
   * sibling guard answers differently, no later rule superseded it, and it was
   * not left unbuilt. The rule was built, and the `errors.*` sentence is a
   * second representation of it that no client can receive. Not repaired here —
   * both are declared, because ownership follows the capture and not the raise
   * sites (trap T10), and dropping either reds the progress test as
   * `undeclared`.
   *
   * Both spellings were searched, which trap T12 asks for: `ERROR_CODES.<CODE>`
   * and the bare quoted literal, over `packages`, `backend`, `admin` and
   * `storefront`. The only occurrences of either are the enumeration entry in
   * `@endora-commerce/contracts` and this declaration. What makes the miss
   * legible is that the pattern which would have connected them exists in the
   * same directory and was not applied: `SettingNotRegistered`,
   * `SettingOutOfScopeForChannel` and `SettingValueShapeMismatch` in
   * `kernel/settings/settings.service.ts` each carry
   * `readonly code = 'SETTING_…' as const`, while `BreakingChangeRejected`
   * carries no `code` and `SettingCodeConflict`'s `code` is the *setting's*
   * code, not an error code — a name collision that reads like the link and is
   * not one.
   *
   * No `tokens`, derived rather than assumed. `refusalToken`
   * (`packages/platform/src/http/error-envelope.ts`) reads `details.code` and
   * nothing else; all seventeen raises of these ten codes across `packages` and
   * `backend/src` were read, fifteen pass no fourth argument at all, and the
   * two that do — `search`'s LLM toggle and this module's own `valueType`
   * refusal — pass the Zod-style `Array<{path, issue}>`, which `refusalToken`
   * returns `null` for by construction. The runbook's §5 raise-site scan
   * attributes the tree's ten token-carrying codes over 41 sites to `core`,
   * `invoices` and `carts` and names none of these, and the bundles hold no
   * `errors.<CODE>.<token>` key in the other direction.
   */
  errorCodes: [
    { code: 'SETTING_BREAKING_CHANGE_REJECTED' },
    { code: 'SETTING_CODE_CONFLICT' },
    { code: 'SETTING_EMPTY_SUBSET' },
    { code: 'SETTING_GROUP_CODE_CONFLICT' },
    { code: 'SETTING_GROUP_NOT_FOUND' },
    { code: 'SETTING_GROUP_PROTECTED' },
    { code: 'SETTING_NOT_REGISTERED' },
    { code: 'SETTING_OUT_OF_SCOPE_FOR_CHANNEL' },
    { code: 'SETTING_SECRET_KEY_MISSING' },
    { code: 'SETTING_VALUE_SHAPE_MISMATCH' },
  ],
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    { code: 'settings:read', label: 'View settings' },
    { code: 'settings:write', label: 'Edit settings' },
  ],
  actions: [
    {
      id: 'open-settings',
      labelKey: 'actions.openSettings.label',
      descriptionKey: 'actions.openSettings.description',
      icon: 'Settings',
      targetRoute: '/settings',
      // The only one of the 53 shipped actions that declared no code at all
      // (issue #232), while `/api/v1/admin/settings` is
      // `requireAdmin('settings:read')` — so the palette offered the screen to
      // every role and every role without the code collected a 403 on arrival.
      requiredPermission: 'settings:read',
      keywords: ['settings', 'preferences', 'config', 'ustawienia'],
      weight: 250,
    },
  ],
});

/** Legacy export retained for backward compatibility. */
export const settingsManifest = settings;

/**
 * The operator command this module declares — feature 080, T042b / D-160.9.
 *
 * It was `scripts/cache-clear.ts`, which opened its own Redis connection and
 * built its own `CacheAdminService`. It flushes through the composition's now.
 */
export const cliCommands: ReadonlyArray<ModuleCliCommand<ModuleContext>> = [
  {
    name: 'cache-clear',
    summary: 'Flush selected (or all) Redis cache namespaces.',
    run: async (context) => (await import('./backend/cli/cache-clear.js')).cacheClear(context),
  },
];
