/**
 * The top-level path segments this storefront serves itself
 * (`specs/105-cms-root-page-urls/` FR-034;
 * `contracts/cms-page-url.md` §5.3.1).
 *
 * ## Why a storefront publishes this
 *
 * A CMS page is served at the site root, `/{slug}`, so a page slugged `cart`
 * saves, publishes and is **never shown**: a root catch-all is Next's
 * lowest-priority match and `/cart` wins, with nothing configured and nothing
 * built (`research.md` D-9). The `cms` module refuses such a slug at save time,
 * and it refuses it against a **Setting the deployment owns** — because the set
 * is a fact about a *storefront's route table*, a headless backend serves
 * storefronts it did not build, and a list held inside `cms` would be a derived
 * fact about a consumer written into the owner.
 *
 * That leaves the deployment copying its Setting value from somewhere. This
 * array is that somewhere: a published, reconciled source rather than somebody's
 * memory of what the route tree holds.
 *
 * ## It is hand-written, and that is the point
 *
 * `check:storefront-indexability` reconciles it against the route tree in both
 * directions — a segment the tree serves and this array does not name is a
 * finding, and an entry naming no segment is a finding. Computing it from the
 * route tree would make the reconciliation a mirror, which is the same argument
 * `SITEMAP_STATIC_ROUTES` and `SITEMAP_DYNAMIC_ROUTES` are written by hand for.
 *
 * The two directions fail differently, and the asymmetry is why the check lives
 * on this side of the boundary: a segment that has *left* the storefront and is
 * still reserved refuses a slug that is actually free — annoying, one settings
 * edit, fail-**safe**; a segment *added* here and never reserved is the original
 * defect returning, fail-**open**. The instrument sits where segments are added.
 *
 * ## What it covers
 *
 * Every first path segment produced by a `page.tsx` or a `route.ts` under
 * `app/`, excluding dynamic segments — `[...slug]` is the CMS catch-all itself
 * and is what a page slug *is*.
 *
 * `robots.txt` and `sitemap.xml` are not here: they are produced by `app/robots.ts`
 * and `app/sitemap.ts`, files at the app root rather than directories, so no
 * segment of the route tree names them. Nothing is lost by it — a CMS slug
 * cannot contain a `.` (`cmsSlugRe`), so neither URL is reachable by any slug an
 * operator can save.
 */
export const RESERVED_TOP_LEVEL_SEGMENTS: readonly string[] = [
  'account',
  'addresses',
  'api',
  'auth',
  'blog',
  'c',
  'cart',
  'catalog',
  'checkout',
  'compare',
  'invitations',
  'kontakt',
  'login',
  'manifest.webmanifest',
  'newsletter',
  'offline',
  'orders',
  'organization',
  'p',
  'password-reset',
  'preferences',
  'pwa',
  'quick-order',
  'quote-request',
  'quote-requests',
  'register',
  'register-customer',
  'returns',
  'search',
  'session-expired',
  'shopping-lists',
  'verify',
];
