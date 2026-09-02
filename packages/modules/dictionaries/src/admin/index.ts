/**
 * `dictionaries`' admin surface — three routes and two sidebar entries,
 * declared by the module that owns them (feature 091, Phase 4, batch 10;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **Its drain fell from eleven to zero and it is coupled to nobody**, which is
 * why it travels with `settings` and `credentials` rather than blocking on
 * them. The eleven were `CountryPicker` and `CurrencyPicker` — two pickers over
 * this module's country and currency catalogues, reached by `taxes`,
 * `inventory`, `credit_limits`, `delivery_methods` and four more — plus five
 * gateways importing the admin API client for one country list. Batch 5 paid
 * the client reaches (each gateway builds
 * `GET /api/v1/admin/dictionary/countries` from the published `apiClient` and
 * `DictionaryCountriesPageResponse`), and batch 8 published both pickers into
 * `@endora-commerce/admin-kit/components` on P2's terms, moving their
 * `countryPicker.*` and `currencyPicker.*` keys to `core` with them. Neither
 * turned out to be this module's *code*: both name an endpoint and a contract
 * type, which is what Z1.1 measures rather than counts.
 *
 * **The two re-export shims go with the directory.** Batch 8 left
 * `components/{CountryPicker,CurrencyPicker}.tsx` forwarding to the kit; a `@/`
 * specifier does not resolve inside a package at all, and no file in the tree
 * named the old paths — the four consumers already name the kit subpath. That
 * is batch 9's `CustomFieldValuesPanel` decision arriving twice.
 *
 * **Two palette actions are declared here for the first time**, which is not a
 * product change: `AppShell.tsx`'s `PALETTE_ITEMS` carried a hand-written
 * *Navigate* row for each of these two screens, and a hand-written palette row
 * is a copy the server was never asked about — it went on advertising the
 * screens after an operator withdrew the module. Both arrive as manifest
 * actions instead, which is the surface the effective enabled-set filters, with
 * the same destinations, the same code and the same keywords the hand-written
 * rows carried. That is batches 7 and 8's shape, and it is why this module is
 * unlike batch 9's `assets_library`, which advertised nothing to begin with and
 * had none invented for it.
 *
 * **`nonDeactivatable`, so the operator axis is the platform's** (`plan.md`
 * Ruling 2). Countries, currencies and languages are what addresses, prices and
 * translations resolve against, and the manifest says so with a reason. The
 * permission axis is what this module still has and is what the off-state test
 * drives; the missing axis is read off the manifest rather than skipped.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's landing route: the three-tab registry screen. */
const ROUTE_PATH = '/dictionary';

/**
 * The audit screen's route, and the spelling the sidebar advertises.
 *
 * `App.tsx` declared it twice — `/dictionaries/audit` and
 * `/admin/dictionaries/audit` — while `AppShell.tsx`'s row and its palette row
 * both pointed at the `/admin` one. Both are kept, for the reason they were
 * both declared: a bookmark on either resolves. The `/admin`-prefixed path is
 * the one the nav entry names, so it is the one `registryCrumbs` derives a
 * breadcrumb for.
 */
const AUDIT_ROUTE_PATH = '/admin/dictionaries/audit';

/**
 * The legacy spelling of the audit route, unadvertised and still resolving.
 *
 * Nothing in the tree links to it and it predates the `/admin` prefix; it is
 * kept because removing a URL an operator may have bookmarked is a product
 * change and this batch is a file move.
 */
const AUDIT_LEGACY_ROUTE_PATH = '/dictionaries/audit';

/**
 * The one code this module declares, and the one every one of its admin routes
 * enforces.
 *
 * `dictionary.write` gates all 23 registrations under
 * `/api/v1/admin/dictionary/*` — including the reads, because the registry
 * screen is an editing surface and this module never split read from write. So
 * the routes, the sidebar rows and the palette actions all carry it, and the
 * screen never advertises a 403.
 */
const DICTIONARY_PERMISSION = 'dictionary.write';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/DictionaryPage.js'),
      requiredPermission: DICTIONARY_PERMISSION,
      index: true,
    },
    {
      path: AUDIT_LEGACY_ROUTE_PATH,
      component: () => import('./pages/AuditPage.js'),
      requiredPermission: DICTIONARY_PERMISSION,
    },
    {
      path: AUDIT_ROUTE_PATH,
      component: () => import('./pages/AuditPage.js'),
      requiredPermission: DICTIONARY_PERMISSION,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/dictionaries/i18n/`. It was `appShell.nav.dictionary`
      // in the shared `_i18n` bundle, one of the four shared files a module
      // author had to edit.
      labelKey: 'nav.dictionary.label',
      // The glyphs `AppShell.tsx` rendered by hand, both already on
      // `KnownIconNameSchema`.
      icon: 'Languages',
      section: 'channels',
      // The hand-written position in *Sales channels* times a hundred, which is
      // batch four's convention: `/dictionary` and the audit row were the
      // second and third of three, below `/sales-channels`. That row is still
      // the host's, so `composeNav` appends both of these after it — which is
      // exactly where they sat.
      weight: 200,
      requiredPermission: DICTIONARY_PERMISSION,
    },
    {
      to: AUDIT_ROUTE_PATH,
      labelKey: 'nav.dictionaryAudit.label',
      icon: 'ListChecks',
      section: 'channels',
      weight: 300,
      requiredPermission: DICTIONARY_PERMISSION,
    },
  ],
};
