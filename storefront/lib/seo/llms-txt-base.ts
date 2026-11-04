import { SITEMAP_STATIC_ROUTES } from '../../app/sitemap';
import { absoluteUrl, siteUrl } from './site-url';

/**
 * The part of `llms.txt` this storefront generates
 * (`specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §5; FR-025).
 *
 * ```text
 * # <the shop's name>
 *
 * ## Pages
 *
 * - [Home](https://shop.example/)
 * - [Catalog](https://shop.example/catalog)
 * …
 *
 * ## Sitemap
 *
 * - [Sitemap](https://shop.example/sitemap.xml)
 * ```
 *
 * The shape is the one <https://llmstxt.org> proposes — a heading that names
 * the site, then sections of links — as far as this storefront can fill it in
 * on its own. It has no summary of the shop to offer, so it writes none; what
 * an operator adds follows this part and may say anything the proposal allows.
 *
 * ## Which pages, and why exactly these
 *
 * **`SITEMAP_STATIC_ROUTES`, and nothing else.** That list is the storefront's
 * hand-written statement of its public, indexable, static addresses, and
 * `check:storefront-indexability` already reconciles it against the route
 * tree in both directions. Reading it means "only public and indexable
 * addresses" is inherited from an instrument rather than restated here, and
 * that no address from a family `robots.txt` closes can appear:
 * `test/seo/llms-txt-base.test.ts` holds every address this file writes
 * against the rule list `robots-system-rules.ts` owns.
 *
 * **Less {@link LLMS_TXT_CONDITIONAL_PAGES} that are not served right now.** A
 * static route is not always a page: `/blog` answers "not found" while the
 * `blog` module is switched off and while the sales channel has no blog. A
 * file that sends a reader to a missing page is worse than one that does not
 * mention it, so the caller says which of those are absent
 * (`llms-txt-pages.ts`) and they are left out. Every other listed page is
 * served by this storefront whatever is switched on behind it.
 *
 * Nothing is computed from the route tree, and nothing is taken from a
 * request.
 *
 * **One origin, for every sales channel.** The addresses are built from
 * `siteUrl()`, the deployment's public origin, which the build fixes
 * (`NEXT_PUBLIC_SITE_URL`). A storefront that serves several channels names
 * that one origin in every channel's file, exactly as its sitemap does; what
 * differs per channel is the shop's name and which pages are there.
 */

/**
 * How each listed page is named in the file. In English, like the rest of the
 * generated part: the file is read by software, and its operator's own words
 * follow it in whatever language they write.
 *
 * Keyed by the entries of `SITEMAP_STATIC_ROUTES`; the test holds the two sets
 * equal, so a static route added to the sitemap is named here in the same
 * change. A route without a title would still be listed, under its path.
 */
export const LLMS_TXT_PAGE_TITLES: Readonly<Record<string, string>> = {
  '/': 'Home',
  '/catalog': 'Catalog',
  '/search': 'Search',
  '/blog': 'Blog',
  '/kontakt': 'Contact',
};

/**
 * The listed pages this storefront serves only while something behind them is
 * there, and what that is. The value names the question `llms-txt-pages.ts`
 * asks; a page not here is always listed.
 */
export const LLMS_TXT_CONDITIONAL_PAGES = {
  '/blog': 'blog',
} as const satisfies Readonly<Record<string, string>>;

export type LlmsTxtConditionalPath = keyof typeof LLMS_TXT_CONDITIONAL_PAGES;

export interface LlmsTxtBaseInput {
  /** The channel's configured shop name, or `''`. */
  readonly shopName: string;
  /**
   * The paths not served right now. Only a member of
   * {@link LLMS_TXT_CONDITIONAL_PAGES} is ever left out; anything else here is
   * ignored, so this can remove a line and can never add one.
   */
  readonly unservedPaths: readonly string[];
  /**
   * Feature 171 — a listed page served under another address than its route: the
   * blog under the operator's prefix. Linked there, under the page's own title.
   */
  readonly servedAt?: Readonly<Record<string, string>> | undefined;
}

/**
 * Characters that are never part of a name and can make text read as
 * something it is not: the C0 and C1 controls other than the whitespace ones
 * (those are separators, below), and the bidirectional embedding, override
 * and isolate controls, which reorder what follows them on screen. One
 * character class, so removing them costs the length of the name.
 */
const NOT_NAME_CHARACTERS = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

/**
 * The shop's name as one line of a heading: the characters above removed,
 * surrounding whitespace removed and every run of whitespace inside — a line
 * break included — made one space, so that a name cannot start a line of its
 * own in the file. Falls back to the site's host when nothing is left.
 *
 * `split` on a single-character class and a filter, rather than a pattern
 * with a quantifier: its cost is the length of the name whatever the name is.
 */
function headingText(shopName: string): string {
  const words = shopName
    .replace(NOT_NAME_CHARACTERS, '')
    .split(/\s/)
    .filter((word) => word.length > 0);
  return words.length > 0 ? words.join(' ') : siteUrl().host;
}

/** The generated part, ending in exactly one line break. */
export function renderLlmsTxtBase({ shopName, unservedPaths, servedAt }: LlmsTxtBaseInput): string {
  const pages = SITEMAP_STATIC_ROUTES.filter(
    (path) => !(Object.hasOwn(LLMS_TXT_CONDITIONAL_PAGES, path) && unservedPaths.includes(path)),
  );
  return [
    `# ${headingText(shopName)}`,
    '',
    '## Pages',
    '',
    ...pages.map((path) => `- [${LLMS_TXT_PAGE_TITLES[path] ?? path}](${absoluteUrl(servedAt?.[path] ?? path)})`),
    '',
    '## Sitemap',
    '',
    `- [Sitemap](${absoluteUrl('/sitemap.xml')})`,
    '',
  ].join('\n');
}

/**
 * What a store closed to anonymous visitors says to AI assistants
 * (`specs/154-sales-channel-access/`): its name, as the generated part names
 * it, and that its content is for signed-in customers — the summary
 * <https://llmstxt.org> puts under the heading. No page and no sitemap: every
 * page answers an anonymous reader with the sign-in page, and the sitemap of
 * a closed store is empty.
 */
export function renderClosedStoreLlmsTxt(shopName: string): string {
  return [
    `# ${headingText(shopName)}`,
    '',
    '> The content of this store is available to signed-in customers only.',
    '',
  ].join('\n');
}
