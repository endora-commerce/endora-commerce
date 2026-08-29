/**
 * How many admin routes and sidebar entries each module still declares in the
 * admin's two hand-written registries (feature 091, FR-018).
 *
 * **A two-way ratchet, and never a number to raise.** A count below the walk is
 * a module that grew a hand-written registration nobody was asked about — the
 * shape this feature exists to stop being the only way to add an admin screen.
 * A count above it is a number left standing after the registrations went,
 * which is the stale direction every ledger in this tree refuses.
 *
 * It exists because those two counts are facts *about* the module surface
 * directories and are derived nowhere, and **the batch that moves a directory
 * does not touch either file** — the exact shape AGENTS.md records as having
 * produced three reds on `master` in a row. A batch that moves `blog`'s seven
 * screens into its package and leaves its seven `<Route>` elements standing
 * produces an admin that declares each of them twice, with `react-router`
 * silently taking the first match.
 *
 * The numbers below were measured on 2026-08-29 against a tree in which **no**
 * admin directory has moved: 149 routes and 100 nav entries, of which 145 and
 * 97 belong to a module. They shrink with every Story 3 batch, and when the
 * last module entry goes the check has nothing to ratchet and is deleted with
 * this file — `expected=0` is exit 2 in the `read:` grammar, and an instrument
 * with an empty population is the done signal that says nothing.
 *
 * Two attributions, deliberately different, because the tree disagrees about
 * one screen: a **route** belongs to the module whose surface directory
 * `App.tsx` imports its component from, and a **nav entry** belongs to the
 * `module` field it already carries — `/admin-roles` renders a component
 * `admin_users` holds while its sidebar row declares `module: 'admin_roles'`,
 * and forcing one attribution on both would lose whichever fact it did not
 * pick.
 *
 * `host` is the admin application's own: the four routes and three nav entries
 * that belong to no module. `platform` renders `/platform/modules`, which D-36
 * says belongs to no module and must stay host-owned.
 */

/** What one owner still declares. */
export interface AdminRegistrationCounts {
  /** `<Route>` elements in `App.tsx` whose component is this owner's. */
  readonly routes: number;
  /** Nav entries in `AppShell.tsx` whose `module` field is this owner's. */
  readonly nav: number;
}

/** The admin application's own registrations, as opposed to a module's. */
export const HOST_OWNER = 'host';

export const ADMIN_REGISTRATIONS_BASELINE: Readonly<Record<string, AdminRegistrationCounts>> = {
  host: { routes: 4, nav: 3 },
  admin_roles: { routes: 0, nav: 1 },
  admin_users: { routes: 2, nav: 1 },
  analytics: { routes: 1, nav: 1 },
  api_keys: { routes: 1, nav: 2 },
  assets_library: { routes: 1, nav: 1 },
  audit_logs: { routes: 1, nav: 1 },
  autopay: { routes: 1, nav: 0 },
  blog: { routes: 7, nav: 3 },
  carts: { routes: 2, nav: 0 },
  catalog: { routes: 8, nav: 9 },
  cms: { routes: 11, nav: 4 },
  comparisons: { routes: 2, nav: 2 },
  credentials: { routes: 2, nav: 2 },
  credit_limits: { routes: 1, nav: 2 },
  custom_fields: { routes: 1, nav: 1 },
  customer_accounts: { routes: 1, nav: 1 },
  customers: { routes: 3, nav: 2 },
  delivery_methods: { routes: 1, nav: 2 },
  dhl_parcel: { routes: 1, nav: 0 },
  dictionaries: { routes: 3, nav: 4 },
  google_analytics: { routes: 3, nav: 1 },
  import_export: { routes: 1, nav: 1 },
  // Arrived with the InPost integration (!1103), which landed between this
  // baseline being written and the check that reads it. Same shape as
  // `dhl_parcel` above: a carrier settings route the host registers and no nav
  // entry of its own, reached from the delivery-methods card.
  inpost: { routes: 1, nav: 0 },
  inventory: { routes: 7, nav: 6 },
  invoices: { routes: 4, nav: 1 },
  ksef: { routes: 1, nav: 1 },
  linkedin_ads: { routes: 3, nav: 1 },
  megamenu: { routes: 2, nav: 1 },
  meta_ads: { routes: 3, nav: 1 },
  mfa: { routes: 1, nav: 0 },
  newsletter: { routes: 11, nav: 9 },
  orders: { routes: 4, nav: 4 },
  organizations: { routes: 2, nav: 2 },
  payment_methods: { routes: 1, nav: 2 },
  paypal: { routes: 1, nav: 0 },
  payu: { routes: 1, nav: 0 },
  pim_ergonode: { routes: 5, nav: 1 },
  price_lists: { routes: 3, nav: 2 },
  product_feeds: { routes: 10, nav: 1 },
  promotions: { routes: 5, nav: 4 },
  pwa: { routes: 0, nav: 1 },
  quick_order: { routes: 1, nav: 0 },
  quote_requests: { routes: 3, nav: 2 },
  returns: { routes: 5, nav: 1 },
  sales_channels: { routes: 3, nav: 2 },
  seo: { routes: 1, nav: 1 },
  settings: { routes: 4, nav: 4 },
  stripe: { routes: 1, nav: 0 },
  taxes: { routes: 1, nav: 1 },
  tpay: { routes: 1, nav: 0 },
  transactional_emails: { routes: 6, nav: 6 },
  webhooks: { routes: 1, nav: 2 },
};
