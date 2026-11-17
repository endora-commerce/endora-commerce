/**
 * The language of a storefront page is the first segment of its path
 * (`specs/167-storefront-locale-path/`, issue #396): `/pl/p/wiertarka`, `/en/p/drill`.
 *
 * This is the pure core of it, shared by the middleware (which parses a request and
 * answers the redirects of `contracts/url-shape.md` §3) and by every link the
 * storefront renders (`localizePath`, through the adapters in `localized-link.tsx`
 * and `navigation.ts`). The prefixes are **never derived here**: the backend answers
 * them on the public channel read (`urlLanguages`, `urlLanguageAliases`), so this
 * file only matches against them.
 *
 * Middleware-safe: no `next/*` import, no validation library. The barrel import from
 * the contracts is type-only and erased; the one value import is the `accept-language`
 * subpath, a dependency-free module, so the edge bundle never reaches the Zod schemas.
 */

import type { ChannelUrlLanguage, ChannelUrlLanguageAlias } from '@endora-commerce/contracts';
import { parseAcceptLanguage } from '@endora-commerce/contracts/accept-language';
import { LANGUAGE_NEUTRAL_SEGMENTS } from '../../app/reserved-segments';

/** The channel's URL languages and the language of the current URL. */
export interface UrlLanguageState {
  /** The channel's URL languages as `GET /api/v1/storefront/sales-channel` answered them. */
  readonly languages: readonly ChannelUrlLanguage[];
  readonly aliases: readonly ChannelUrlLanguageAlias[];
  /** The language of the current URL. */
  readonly current: string;
}

export type LocaleParse =
  | { kind: 'render'; languageCode: string; prefix: string; logicalPath: string }
  | { kind: 'redirect'; status: 307 | 308; location: string; varyOnLanguageInputs: boolean };

export interface ParseLocalePathInput {
  readonly pathname: string;
  /** The query string with its `?`, or `''`. */
  readonly search: string;
  readonly acceptLanguage: string | null;
  /** The `lang` cookie; consulted only for the 307s (url-shape §3 rows 3–4, §5). */
  readonly langCookie: string | null;
  readonly languages: readonly ChannelUrlLanguage[];
  readonly aliases: readonly ChannelUrlLanguageAlias[];
}

const NEUTRAL: ReadonlySet<string> = new Set(LANGUAGE_NEUTRAL_SEGMENTS);

/** The request header carrying the page language to the render (url-shape §3). Written or deleted on every request. */
export const LANGUAGE_REQUEST_HEADER = 'x-storefront-language';
/** The request header carrying the prefix of the current URL — empty for the unprefixed default. */
export const LANGUAGE_PREFIX_REQUEST_HEADER = 'x-storefront-language-prefix';

/** The first segment of a root-relative path and the rest (`/` when nothing follows). */
function splitFirstSegment(pathname: string): { first: string; rest: string } {
  const slash = pathname.indexOf('/', 1);
  if (slash === -1) return { first: pathname.slice(1), rest: '/' };
  return { first: pathname.slice(1, slash), rest: pathname.slice(slash) };
}

/** `/` + prefix + rest, without a trailing slash for the home page. */
function withPrefix(prefix: string, rest: string): string {
  if (rest === '/' || rest === '') return `/${prefix}`;
  if (rest.startsWith('/?') || rest.startsWith('/#')) return `/${prefix}${rest.slice(1)}`;
  return `/${prefix}${rest}`;
}

/** The URL of a logical path in one URL language. */
function urlIn(language: ChannelUrlLanguage, logicalPath: string): string {
  return language.prefixed ? withPrefix(language.prefix, logicalPath) : logicalPath;
}

/** The raw query without any `lang` parameter, other parameters kept verbatim and in order. */
function withoutLang(search: string): { query: string; lang: string[] } {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (raw === '') return { query: '', lang: [] };
  const kept: string[] = [];
  const lang: string[] = [];
  for (const pair of raw.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const name = safeDecode(eq === -1 ? pair : pair.slice(0, eq));
    if (name === 'lang') {
      lang.push(safeDecode(eq === -1 ? '' : pair.slice(eq + 1)));
    } else {
      kept.push(pair);
    }
  }
  return { query: kept.length === 0 ? '' : `?${kept.join('&')}`, lang };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** A channel language matching `tag`: exact (case-insensitive), then primary subtag. */
function matchLanguage(
  tag: string | null | undefined,
  among: readonly ChannelUrlLanguage[],
): ChannelUrlLanguage | undefined {
  if (!tag) return undefined;
  const wanted = tag.trim().toLowerCase();
  if (wanted === '') return undefined;
  const exact = among.find((l) => l.languageCode.toLowerCase() === wanted);
  if (exact) return exact;
  const primary = wanted.split('-')[0];
  return among.find((l) => l.languageCode.split('-')[0]!.toLowerCase() === primary);
}

/**
 * `Accept-Language` tags by descending q-weight, through the shared parse
 * (`parseAcceptLanguage`, `@endora-commerce/contracts`, issue #1011) — so the bounds
 * (512 characters, ten tags after weighting), a malformed `q` dropping its tag, `q`
 * read case-insensitively and a tag at `q=0` or below dropped as "not acceptable"
 * (RFC 9110, issue #1315) are the backend's. What stays the redirect's own: `*` names
 * no language, so it is never a redirect target.
 */
export function acceptLanguageTags(header: string | null | undefined): string[] {
  return parseAcceptLanguage(header ?? undefined).filter((tag) => tag !== '*');
}

function matchAcceptLanguage(
  header: string | null,
  among: readonly ChannelUrlLanguage[],
): ChannelUrlLanguage | undefined {
  for (const tag of acceptLanguageTags(header)) {
    const hit = matchLanguage(tag, among);
    if (hit) return hit;
  }
  return undefined;
}

const redirect = (status: 307 | 308, location: string): LocaleParse => ({
  kind: 'redirect',
  status,
  location,
  varyOnLanguageInputs: status === 307,
});

/**
 * What a document request for `pathname` is answered with
 * (`contracts/url-shape.md` §3 and §5): render a language at a logical path, or
 * redirect. The caller has already set aside language-neutral paths (§4).
 */
export function parseLocalePath(input: ParseLocalePathInput): LocaleParse {
  const languages = input.languages;
  const defaultLanguage = languages.find((l) => l.isDefault) ?? languages[0];
  if (defaultLanguage === undefined) {
    return { kind: 'render', languageCode: '', prefix: '', logicalPath: input.pathname };
  }
  const { first, rest } = splitFirstSegment(input.pathname);
  const lower = first.toLowerCase();

  // Row 1 / row 2: a channel prefix.
  const prefixed = lower === '' ? undefined : languages.find((l) => l.prefix === lower);
  if (prefixed !== undefined) {
    if (first !== lower) return redirect(308, `${withPrefix(lower, rest)}${input.search}`);
    if (!prefixed.prefixed) return redirect(308, `${rest}${input.search}`);
    return { kind: 'render', languageCode: prefixed.languageCode, prefix: prefixed.prefix, logicalPath: rest };
  }

  // Row 3: a split alias.
  const alias = lower === '' ? undefined : input.aliases.find((a) => a.alias === lower);
  if (alias !== undefined) {
    const variants = alias.languageCodes
      .map((code) => languages.find((l) => l.languageCode === code))
      .filter((l): l is ChannelUrlLanguage => l !== undefined);
    if (variants.length > 0) {
      const chosen =
        matchLanguage(input.langCookie, variants) ?? matchAcceptLanguage(input.acceptLanguage, variants) ?? variants[0]!;
      return redirect(307, `${urlIn({ ...chosen, prefixed: true }, rest)}${input.search}`);
    }
  }

  // Row 4: no prefix — the whole pathname is the logical path.
  const logicalPath = input.pathname === '' ? '/' : input.pathname;
  const { query, lang } = withoutLang(input.search);
  const fromQuery = lang.map((value) => matchLanguage(value, languages)).find((l) => l !== undefined);

  if (defaultLanguage.prefixed) {
    // Setting on (OR-2, OR-11): ?lang= → cookie → Accept-Language → default.
    const chosen =
      fromQuery ??
      matchLanguage(input.langCookie, languages) ??
      matchAcceptLanguage(input.acceptLanguage, languages) ??
      defaultLanguage;
    return redirect(307, `${urlIn(chosen, logicalPath)}${query}`);
  }

  // Setting off (OR-3): only an explicit ?lang= naming a channel language moves.
  if (fromQuery !== undefined) return redirect(308, `${urlIn(fromQuery, logicalPath)}${query}`);
  return { kind: 'render', languageCode: defaultLanguage.languageCode, prefix: '', logicalPath };
}

/** Whether the first segment of `path` is a channel prefix or a split alias. */
function hasChannelPrefix(path: string, state: Pick<UrlLanguageState, 'languages' | 'aliases'>): boolean {
  const end = path.slice(1).search(/[/?#]/);
  const first = (end === -1 ? path.slice(1) : path.slice(1, end + 1)).toLowerCase();
  if (first === '') return false;
  return state.languages.some((l) => l.prefix === first) || state.aliases.some((a) => a.alias === first);
}

/** Whether `path` is language-neutral (url-shape §4): a neutral segment or a file at the root. */
export function isLanguageNeutral(path: string): boolean {
  const end = path.slice(1).search(/[/?#]/);
  const first = end === -1 ? path.slice(1) : path.slice(1, end + 1);
  if (NEUTRAL.has(first)) return true;
  // A file at the root (`/robots.txt`, `/favicon.ico`, `/sitemap.xml`): not a page.
  return end === -1 && first.includes('.');
}

/**
 * The path of `path` in a language (`contracts/storefront-navigation.md` §2): a
 * logical path gets the language's prefix, or stays as it is for the unprefixed
 * default. Idempotent; anything that is not a root-relative page path — `''`, `#…`,
 * `?…`, `mailto:`, `tel:`, absolute and protocol-relative URLs, language-neutral
 * paths — is returned unchanged, query and fragment verbatim.
 */
export function localizePath(path: string, state: UrlLanguageState, languageCode?: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  if (state.languages.length === 0) return path;
  if (hasChannelPrefix(path, state) || isLanguageNeutral(path)) return path;
  const wanted = (languageCode ?? state.current).toLowerCase();
  const language = state.languages.find((l) => l.languageCode.toLowerCase() === wanted);
  if (language === undefined) return path;
  return urlIn(language, path);
}

/** The logical path of a browser path: the prefix removed when it is a channel prefix. */
export function stripLocalePrefix(pathname: string, state: Pick<UrlLanguageState, 'languages' | 'aliases'>): string {
  if (!hasChannelPrefix(pathname, state)) return pathname;
  const { rest } = splitFirstSegment(pathname);
  return rest;
}

/**
 * Canonical, `hreflang` alternates and `x-default` for a page whose logical path is
 * the same in every language (url-shape §8): home, catalogue, category, search, CMS,
 * blog, contact. `x-default` is the unprefixed URL in both setting states.
 */
export function pageAlternates(
  logicalPath: string,
  state: UrlLanguageState,
): { canonical: string; languages: Record<string, string> } {
  const languages: Record<string, string> = {};
  for (const language of state.languages) languages[language.languageCode] = urlIn(language, logicalPath);
  languages['x-default'] = logicalPath;
  return { canonical: localizePath(logicalPath, state), languages };
}
