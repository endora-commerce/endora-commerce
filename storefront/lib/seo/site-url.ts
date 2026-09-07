/**
 * The origin this deployment serves, for canonicals, the sitemap and robots.
 *
 * One value in one place (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-012).
 * Every canonical in the tree is a **path**; the root layout stamps this as
 * Next's `metadataBase` and Next resolves the two. A route that spelled an
 * absolute URL would keep working after the deployment moved and would keep
 * pointing at where it used to be, which is the failure mode a canonical has:
 * silent, and worse than having none.
 */

/** The fallback, used only when nothing declares an origin. */
const DEVELOPMENT_ORIGIN = 'http://localhost:3000';

/**
 * `NEXT_PUBLIC_SITE_URL` first — it is the one an operator sets for the public
 * origin — then `STOREFRONT_URL`, which the Playwright configuration and the
 * visual suite already use for the same thing.
 */
export function siteUrl(): URL {
  const declared =
    process.env['NEXT_PUBLIC_SITE_URL'] ?? process.env['STOREFRONT_URL'] ?? '';
  try {
    return new URL(declared.length > 0 ? declared : DEVELOPMENT_ORIGIN);
  } catch {
    // A malformed origin is an operator's typo. Rendering every canonical
    // against a URL that will not parse would take the whole page down with a
    // `TypeError` from `metadataBase`; falling back keeps the page served and
    // leaves the canonical obviously wrong, which is the direction to be wrong
    // in. Narrow by construction: the only thing in the `try` is `new URL`.
    return new URL(DEVELOPMENT_ORIGIN);
  }
}

/** An absolute URL for `path`, for the sitemap, which cannot use a path. */
export function absoluteUrl(path: string): string {
  return new URL(path, siteUrl()).toString();
}
