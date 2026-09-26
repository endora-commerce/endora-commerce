/**
 * The published artefact, judged as it was emitted
 * (`specs/133-docs-site-publication/contracts/published-artefact.md` §1).
 *
 * `check:docs-translations` reads the markdown **sources** and cannot see a
 * route with no source — the generated `category/*` indexes, `/search`,
 * `/404.html`. This reads `docs/build/` and cannot see a front-matter defect
 * before a build. Neither instrument can see what the other sees, which is why
 * there are two, and why this one is **not** a `check-*` script: it needs a
 * Docusaurus build to have run, and `specs/conventions/check-estate.md` is
 * explicit that a build inside a unit run is not a test.
 *
 * ## Why the expected origin is read from the configuration
 *
 * One home for the value: the artefact is compared against `docusaurus.config.js`
 * rather than against a second copy of the string. That is a **correctness**
 * property and deliberately not the ordering guarantee — a verifier reading the
 * origin from the file it judges is *self-consistent*, so families 3, 5 and 7
 * would all pass against a `localhost` configuration, every canonical and every
 * `<loc>` agreeing with the `url` they were built from. What refuses a
 * correctly-wrong build is **family 2**, which judges the origin's *shape*
 * whatever the configuration says — not `https`, carrying a port, or a host on
 * {@link DEV_HOSTS} — and **family 6**, which cross-checks `robots.txt` against
 * the sitemaps this build actually emitted.
 *
 * Usage: `pnpm --filter backend run verify:docs-build`
 *
 * Exit 0 = every family clean; exit 2 = any finding, or a walk that read
 * nothing (`reportReadSize` refuses a vacuous pass).
 */
/* eslint-disable no-console -- CLI verifier: stdout/stderr is the interface. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadDocsSiteConfig } from './lib/docs-chrome-messages.js';
import { loadDocsLocales } from './lib/docs-locales.js';
import { findRepoRoot } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

const PREFIX = '[verify-docs-build]';

/**
 * The floor SC-005 records from the build that first carried the public origin.
 * A sitemap that shrinks past it has lost pages, whatever the build said.
 *
 * Re-measured, never computed from a delta, from a fresh build counted off the
 * built `sitemap.xml` and `pl/sitemap.xml`. **2026-09-25: 193 -> 174**, at
 * 20129efdb; **2026-09-25: 174 -> 172**, on a tree based on 447510342;
 * **2026-09-26: 172 -> 170**, on a tree based on cb54356ae.
 * Both moves are pages that left this repository; the URL inventory records
 * which.
 */
export const SITEMAP_FLOOR = 170;

/**
 * Hosts that are never a published origin, as `URL.hostname` spells them — the
 * IPv6 loopback included in its bracketed form, because that is the value the
 * parser reports and a bare `::1` does not parse as a URL host at all.
 * `*.local` and `*.localhost` are refused by suffix beside these.
 */
export const DEV_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];

/** Suffixes that make a host a development name however it is spelled. */
const DEV_HOST_SUFFIXES: readonly string[] = ['.local', '.localhost'];

/** Tokens that make a head a development origin's, whatever the configuration says. */
const DEV_ORIGIN_TOKENS: readonly string[] = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];

/**
 * FR-009's English half. The line described this site as internal; asserting
 * its absence under `/pl/` alone says nothing about the tree served at `/`, so
 * both trees are searched for it.
 */
export const ENGLISH_INTERNAL_FOOTER_LINE =
  'Internal documentation — see the repository for the governing constitution.';

/** Analytics and tag managers, refused even when served from our own origin (SC-020). */
const ANALYTICS_TOKENS: readonly string[] = [
  'googletagmanager.com',
  'google-analytics.com',
  'gtag/js',
  'plausible.io',
  'matomo.js',
  'hotjar.com',
  'segment.com/analytics.js',
  'cdn.mxpnl.com',
];

export interface DocsBuildFinding {
  /** Which of the twelve contract families this belongs to. */
  readonly family: number;
  readonly kind: string;
  readonly detail: string;
}

/** The chrome a non-default locale must actually render, from its translation files. */
export interface DocsBuildLocaleChrome {
  readonly locale: string;
  readonly navbarTitle: string;
  readonly navbarItemLabels: readonly string[];
  readonly footerCopyright: string;
}

/** What `docusaurus.config.js` declares, and nothing this script re-states. */
export interface DocsBuildSiteConfig {
  readonly url: string;
  readonly baseUrl: string;
  readonly title: string;
  readonly favicon: string;
  readonly defaultLocale: string;
  readonly locales: readonly string[];
  readonly navbarTitle: string;
  readonly navbarItemLabels: readonly string[];
  readonly footerCopyright: string;
}

export interface DocsBuildVerificationInput {
  readonly buildDir: string;
  readonly site: DocsBuildSiteConfig;
  readonly chrome: readonly DocsBuildLocaleChrome[];
  /** Defaults to {@link SITEMAP_FLOOR}; a fixture may lower it, the CLI never does. */
  readonly sitemapFloor?: number;
  /** `null` when `url-inventory.txt` does not exist yet — family 12 skips, with a note. */
  readonly inventory: readonly string[] | null;
  readonly redirects: ReadonlySet<string>;
}

export interface DocsBuildVerificationResult {
  readonly findings: readonly DocsBuildFinding[];
  readonly files: number;
  readonly sites: number;
  readonly pages: number;
  readonly notes: readonly string[];
}

/** One emitted page, parsed once: every family reads from here. */
interface ParsedPage {
  readonly file: string;
  readonly urlPath: string;
  readonly locale: string;
  readonly head: string;
  readonly html: string;
  readonly title: string | null;
  readonly canonical: string | null;
  readonly ogUrl: string | null;
  readonly alternates: ReadonlyMap<string, string>;
  readonly icon: string | null;
  readonly navbarTitle: string | null;
  readonly navbarLabels: readonly string[];
  readonly localeAnchors: ReadonlyMap<string, readonly string[]>;
}

const ENTITIES: ReadonlyMap<string, string> = new Map([
  ['&amp;', '&'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&#39;', "'"],
  ['&#x27;', "'"],
  ['&nbsp;', '\u00a0'],
]);

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (match) => ENTITIES.get(match) ?? match);
}

function toPosix(value: string): string {
  return value.split('\\').join('/');
}

/** Every `*.html` under the build, relative and sorted — the population. */
export function collectBuiltPages(buildDir: string): readonly string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.html')) {
        found.push(toPosix(relative(buildDir, absolute)));
      }
    }
  };
  walk(buildDir);
  return found;
}

function normalisedBase(baseUrl: string): string {
  const withLeading = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

/**
 * The URL a built file is served at, under `trailingSlash: true`.
 * `index.html` → `/`; `guide/index.html` → `/guide/`; `404.html` → `/404.html/`,
 * which is what Docusaurus itself puts in that page's canonical.
 */
export function urlPathForFile(file: string, baseUrl: string): string {
  const base = normalisedBase(baseUrl);
  const posix = toPosix(file);
  if (posix === 'index.html') {
    return base;
  }
  if (posix.endsWith('/index.html')) {
    return `${base}${posix.slice(0, -'index.html'.length)}`;
  }
  return `${base}${posix}/`;
}

function localeForPath(urlPath: string, baseUrl: string, site: DocsBuildSiteConfig): string {
  const rest = urlPath.slice(normalisedBase(baseUrl).length);
  const first = rest.split('/')[0] ?? '';
  return site.locales.includes(first) && first !== site.defaultLocale ? first : site.defaultLocale;
}

/** The same page in another locale, by URL path. */
function counterpartPath(
  urlPath: string,
  pageLocale: string,
  target: string,
  site: DocsBuildSiteConfig,
): string {
  const base = normalisedBase(site.baseUrl);
  let inner = urlPath.slice(base.length);
  if (pageLocale !== site.defaultLocale) {
    inner = inner.slice(`${pageLocale}/`.length);
  }
  return target === site.defaultLocale ? `${base}${inner}` : `${base}${target}/${inner}`;
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag);
  return match === null ? null : decodeEntities(match[1] ?? '');
}

function parsePage(buildDir: string, file: string, site: DocsBuildSiteConfig): ParsedPage {
  const html = readFileSync(join(buildDir, file), 'utf8');
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
  const titleRaw = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? null;

  let canonical: string | null = null;
  let icon: string | null = null;
  const alternates = new Map<string, string>();
  for (const match of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = (attribute(tag, 'rel') ?? '').toLowerCase();
    if (rel === 'canonical') {
      canonical = attribute(tag, 'href');
    } else if (rel === 'icon') {
      icon = attribute(tag, 'href');
    } else if (rel === 'alternate') {
      const hreflang = attribute(tag, 'hreflang');
      const href = attribute(tag, 'href');
      if (hreflang !== null && href !== null) {
        alternates.set(hreflang, href);
      }
    }
  }

  let ogUrl: string | null = null;
  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
    if (attribute(match[0], 'property') === 'og:url') {
      ogUrl = attribute(match[0], 'content');
    }
  }

  const navbarTitle = /<b\b[^>]*class="[^"]*navbar__title[^"]*"[^>]*>([\s\S]*?)<\/b>/i.exec(html)?.[1] ?? null;
  const navbarLabels: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*class="[^"]*navbar__link[^"]*"[^>]*>([^<]*)<\/a>/gi)) {
    const label = decodeEntities(match[1] ?? '').trim();
    if (label.length > 0) {
      navbarLabels.push(label);
    }
  }

  const localeAnchors = new Map<string, string[]>();
  for (const match of html.matchAll(/<a\b([^>]*\blang="[^"]*"[^>]*)>/gi)) {
    const tag = `<a${match[1] ?? ''}>`;
    const lang = attribute(tag, 'lang');
    const href = attribute(tag, 'href');
    if (lang === null || href === null) {
      continue;
    }
    const bucket = localeAnchors.get(lang) ?? [];
    bucket.push(href);
    localeAnchors.set(lang, bucket);
  }

  const urlPath = urlPathForFile(file, site.baseUrl);
  return {
    file,
    urlPath,
    locale: localeForPath(urlPath, site.baseUrl, site),
    head,
    html,
    title: titleRaw === null ? null : decodeEntities(titleRaw).trim(),
    canonical,
    ogUrl,
    alternates,
    icon,
    navbarTitle: navbarTitle === null ? null : decodeEntities(navbarTitle).trim(),
    navbarLabels,
    localeAnchors,
  };
}

/** Family 2's origin-shape half, judged without consulting the artefact. */
export function originShapeFindings(url: string): readonly DocsBuildFinding[] {
  const findings: DocsBuildFinding[] = [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [{ family: 2, kind: 'origin-unparseable', detail: `origin-unparseable:${url}` }];
  }
  if (parsed.protocol !== 'https:') {
    findings.push({ family: 2, kind: 'origin-not-https', detail: `origin-not-https:${url}` });
  }
  if (parsed.port !== '') {
    findings.push({ family: 2, kind: 'origin-has-port', detail: `origin-has-port:${url}` });
  }
  const host = parsed.hostname.toLowerCase();
  if (DEV_HOSTS.includes(host) || DEV_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    findings.push({ family: 2, kind: 'origin-dev-host', detail: `origin-dev-host:${host}` });
  }
  return findings;
}

function sitemapPathFor(locale: string, site: DocsBuildSiteConfig): string {
  return locale === site.defaultLocale ? 'sitemap.xml' : `${locale}/sitemap.xml`;
}

/** Pure verification over an emitted tree — the unit tests enter here. */
export function verifyDocsBuild(input: DocsBuildVerificationInput): DocsBuildVerificationResult {
  const findings: DocsBuildFinding[] = [];
  const notes: string[] = [];
  const { buildDir, site } = input;
  const base = normalisedBase(site.baseUrl);
  const origin = site.url.replace(/\/+$/, '');
  const floor = input.sitemapFloor ?? SITEMAP_FLOOR;
  let files = 0;

  findings.push(...originShapeFindings(site.url));

  if (!existsSync(buildDir) || !statSync(buildDir).isDirectory()) {
    findings.push({
      family: 1,
      kind: 'build-absent',
      detail: `build-absent:${buildDir} — run \`pnpm --filter docs run build\` first`,
    });
    return { findings, files: 0, sites: 0, pages: 0, notes };
  }

  const pageFiles = collectBuiltPages(buildDir);
  if (pageFiles.length === 0) {
    findings.push({
      family: 1,
      kind: 'empty-build',
      detail: `empty-build:${buildDir} — no *.html emitted; refusing a vacuous pass`,
    });
    return { findings, files: 0, sites: 0, pages: 0, notes };
  }

  const pages = pageFiles.map((file) => parsePage(buildDir, file, site));
  files += pages.length;
  const byPath = new Map(pages.map((page) => [page.urlPath, page]));
  const chromeByLocale = new Map(input.chrome.map((entry) => [entry.locale, entry]));

  // ---- Family 1: both locales built -------------------------------------
  for (const locale of site.locales) {
    const home = locale === site.defaultLocale ? 'index.html' : `${locale}/index.html`;
    const absolute = join(buildDir, home);
    if (!existsSync(absolute)) {
      findings.push({ family: 1, kind: 'locale-home-missing', detail: `locale-home-missing:${home}` });
      continue;
    }
    if (statSync(absolute).size === 0) {
      findings.push({ family: 1, kind: 'locale-home-empty', detail: `locale-home-empty:${home}` });
    }
  }

  for (const page of pages) {
    const expectedUrl = `${origin}${page.urlPath}`;

    // ---- Family 2: canonical, and no development origin in head metadata ---
    if (page.canonical === null) {
      findings.push({ family: 2, kind: 'canonical-absent', detail: `canonical-absent:${page.file}` });
    } else if (!page.canonical.startsWith(`${origin}/`)) {
      findings.push({
        family: 2,
        kind: 'canonical-off-origin',
        detail: `canonical-off-origin:${page.file}:${page.canonical}`,
      });
    } else if (page.canonical !== expectedUrl) {
      findings.push({
        family: 2,
        kind: 'canonical-mismatch',
        detail: `canonical-mismatch:${page.file}:${page.canonical} != ${expectedUrl}`,
      });
    }
    for (const token of DEV_ORIGIN_TOKENS) {
      if (page.head.includes(token)) {
        findings.push({
          family: 2,
          kind: 'dev-origin-in-head',
          detail: `dev-origin-in-head:${page.file}:${token}`,
        });
      }
    }

    // ---- Family 3: og:url --------------------------------------------------
    if (page.ogUrl === null) {
      findings.push({ family: 3, kind: 'og-url-absent', detail: `og-url-absent:${page.file}` });
    } else if (page.ogUrl !== expectedUrl) {
      findings.push({
        family: 3,
        kind: 'og-url-mismatch',
        detail: `og-url-mismatch:${page.file}:${page.ogUrl} != ${expectedUrl}`,
      });
    }

    // ---- Family 4: hreflang, whole tree ------------------------------------
    const alternatesExpected = new Map<string, string>();
    for (const locale of site.locales) {
      const path = counterpartPath(page.urlPath, page.locale, locale, site);
      if (byPath.has(path)) {
        alternatesExpected.set(locale, `${origin}${path}`);
      }
    }
    const defaultPath = counterpartPath(page.urlPath, page.locale, site.defaultLocale, site);
    if (byPath.has(defaultPath)) {
      alternatesExpected.set('x-default', `${origin}${defaultPath}`);
    }
    for (const [hreflang, expected] of alternatesExpected) {
      const actual = page.alternates.get(hreflang);
      if (actual === undefined) {
        findings.push({
          family: 4,
          kind: 'hreflang-missing',
          detail: `hreflang-missing:${page.file}:${hreflang}`,
        });
      } else if (!actual.startsWith(`${origin}/`)) {
        findings.push({
          family: 4,
          kind: 'hreflang-off-origin',
          detail: `hreflang-off-origin:${page.file}:${hreflang}:${actual}`,
        });
      } else if (actual !== expected) {
        findings.push({
          family: 4,
          kind: 'hreflang-mismatch',
          detail: `hreflang-mismatch:${page.file}:${hreflang}:${actual} != ${expected}`,
        });
      }
    }

    // ---- Family 7: the canonical's trailing slash ---------------------------
    if (page.canonical !== null && !page.canonical.endsWith('/')) {
      findings.push({
        family: 7,
        kind: 'canonical-no-trailing-slash',
        detail: `canonical-no-trailing-slash:${page.file}:${page.canonical}`,
      });
    }

    // ---- Family 8: the declared favicon, as every page references it --------
    // Docusaurus builds each locale with its own `baseUrl`, and copies `static/`
    // into every locale's output, so the Polish tree references
    // `/pl/img/favicon.svg` and not the English `/img/favicon.svg`. Both are the
    // declared favicon; the assertion is that the reference resolves.
    const localeBase = page.locale === site.defaultLocale ? base : `${base}${page.locale}/`;
    if (page.icon !== null && page.icon !== `${localeBase}${site.favicon}`) {
      findings.push({
        family: 8,
        kind: 'favicon-not-referenced',
        detail: `favicon-not-referenced:${page.file}:${page.icon} != ${localeBase}${site.favicon}`,
      });
    } else if (page.icon !== null && !existsSync(join(buildDir, page.icon.slice(base.length)))) {
      findings.push({
        family: 8,
        kind: 'favicon-unresolved',
        detail: `favicon-unresolved:${page.file}:${page.icon}`,
      });
    }

    // ---- Family 9: no doc-id titles ----------------------------------------
    const docId = page.urlPath.slice(base.length).replace(/\/$/, '');
    const bareTitle =
      page.title !== null && page.title.endsWith(` | ${site.title}`)
        ? page.title.slice(0, -` | ${site.title}`.length)
        : page.title;
    if (docId.length > 0 && bareTitle !== null && bareTitle === docId) {
      findings.push({ family: 9, kind: 'doc-id-title', detail: `doc-id-title:${page.file}:${bareTitle}` });
    }

    // ---- Family 10: chrome in both trees, and the locale switcher -----------
    const chrome = chromeByLocale.get(page.locale);
    const expectedNavbarTitle = chrome?.navbarTitle ?? site.navbarTitle;
    const expectedLabels = chrome?.navbarItemLabels ?? site.navbarItemLabels;
    const expectedCopyright = chrome?.footerCopyright ?? site.footerCopyright;
    const chromeKind = page.locale === site.defaultLocale ? 'site-chrome-missing' : 'locale-chrome-missing';
    if (page.navbarTitle !== expectedNavbarTitle) {
      findings.push({
        family: 10,
        kind: chromeKind,
        detail: `${chromeKind}:${page.file}:navbar.title:${page.navbarTitle ?? '<absent>'} != ${expectedNavbarTitle}`,
      });
    }
    for (const label of expectedLabels) {
      if (!page.navbarLabels.includes(label)) {
        findings.push({
          family: 10,
          kind: chromeKind,
          detail: `${chromeKind}:${page.file}:navbar.item.label:${label}`,
        });
      }
    }
    if (!page.html.includes(expectedCopyright)) {
      findings.push({
        family: 10,
        kind: chromeKind,
        detail: `${chromeKind}:${page.file}:footer.copyright`,
      });
    }
    if (page.html.includes(ENGLISH_INTERNAL_FOOTER_LINE)) {
      findings.push({
        family: 10,
        kind: 'internal-footer-line',
        detail: `internal-footer-line:${page.file}`,
      });
    }
    // FR-014's only instrument: a switcher "reachable on every published page"
    // is a whole-tree claim. The href is pinned to *this* page's counterpart on
    // every route; on `404.html` — which is served on error and has no URL of
    // its own, its canonical being the synthetic `/404.html/` — only the
    // anchor's presence is asserted, because Docusaurus spells its target
    // `/pl/404/`, a route neither path derivation produces.
    const isRoute = page.file === 'index.html' || page.file.endsWith('/index.html');
    for (const locale of site.locales) {
      if (locale === page.locale) {
        continue;
      }
      const path = counterpartPath(page.urlPath, page.locale, locale, site);
      if (!byPath.has(path)) {
        continue;
      }
      const anchors = page.localeAnchors.get(locale) ?? [];
      if (isRoute ? !anchors.includes(path) : anchors.length === 0) {
        findings.push({
          family: 10,
          kind: 'locale-switcher-missing',
          detail: `locale-switcher-missing:${page.file}:${locale}:${path}`,
        });
      }
    }

    // ---- Family 11: third-party requests, and specs/ hyperlinks ------------
    for (const match of page.html.matchAll(/<(script|link|img|iframe)\b([^>]*)>/gi)) {
      const tag = match[0];
      const name = (match[1] ?? '').toLowerCase();
      if (name === 'link') {
        const rel = (attribute(tag, 'rel') ?? '').toLowerCase();
        if (!['stylesheet', 'preconnect', 'dns-prefetch'].includes(rel)) {
          continue;
        }
      }
      const target = attribute(tag, 'src') ?? attribute(tag, 'href');
      if (target === null || !/^(?:https?:)?\/\//i.test(target)) {
        continue;
      }
      if (!target.startsWith(`${origin}/`) && target !== origin) {
        findings.push({
          family: 11,
          kind: 'third-party-request',
          detail: `third-party-request:${page.file}:${name}:${target}`,
        });
      }
    }
    for (const match of page.html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      const region = match[0];
      for (const token of ANALYTICS_TOKENS) {
        if (region.includes(token)) {
          findings.push({
            family: 11,
            kind: 'analytics-script',
            detail: `analytics-script:${page.file}:${token}`,
          });
        }
      }
    }
    for (const match of page.html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/gi)) {
      const href = decodeEntities(match[1] ?? '');
      if (/(?:^|\/)specs\//.test(href)) {
        findings.push({ family: 11, kind: 'specs-hyperlink', detail: `specs-hyperlink:${page.file}:${href}` });
      }
    }
  }

  // ---- Family 5 and 7: the sitemaps --------------------------------------
  const locsByLocale = new Map<string, readonly string[]>();
  const publishedUrls = new Set<string>();
  for (const locale of site.locales) {
    const sitemapPath = sitemapPathFor(locale, site);
    const absolute = join(buildDir, sitemapPath);
    if (!existsSync(absolute)) {
      findings.push({ family: 5, kind: 'sitemap-missing', detail: `sitemap-missing:${sitemapPath}` });
      continue;
    }
    files += 1;
    const xml = readFileSync(absolute, 'utf8');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decodeEntities(match[1] ?? ''));
    locsByLocale.set(locale, locs);
    const searchRoute =
      locale === site.defaultLocale ? `${base}search/` : `${base}${locale}/search/`;
    for (const loc of locs) {
      publishedUrls.add(loc);
      if (!loc.startsWith(`${origin}/`)) {
        findings.push({
          family: 5,
          kind: 'sitemap-loc-off-origin',
          detail: `sitemap-loc-off-origin:${sitemapPath}:${loc}`,
        });
        continue;
      }
      const path = loc.slice(origin.length);
      if (path === searchRoute) {
        findings.push({
          family: 5,
          kind: 'sitemap-search-route',
          detail: `sitemap-search-route:${sitemapPath}:${loc}`,
        });
      }
      if (!path.endsWith('/')) {
        findings.push({
          family: 7,
          kind: 'loc-no-trailing-slash',
          detail: `loc-no-trailing-slash:${sitemapPath}:${loc}`,
        });
        continue;
      }
      if (!existsSync(join(buildDir, path.slice(base.length), 'index.html'))) {
        findings.push({ family: 7, kind: 'loc-unresolved', detail: `loc-unresolved:${sitemapPath}:${loc}` });
      }
    }
    if (locs.length < floor) {
      findings.push({
        family: 5,
        kind: 'sitemap-below-floor',
        detail: `sitemap-below-floor:${sitemapPath}:${locs.length} < ${floor}`,
      });
    }
  }
  const counts = [...new Set([...locsByLocale.values()].map((locs) => locs.length))];
  if (counts.length > 1) {
    findings.push({
      family: 5,
      kind: 'sitemap-count-mismatch',
      detail: `sitemap-count-mismatch:${[...locsByLocale]
        .map(([locale, locs]) => `${locale}=${locs.length}`)
        .join(',')}`,
    });
  }

  // ---- Family 6: robots.txt ----------------------------------------------
  const robotsPath = join(buildDir, 'robots.txt');
  if (!existsSync(robotsPath)) {
    findings.push({ family: 6, kind: 'robots-absent', detail: 'robots-absent:robots.txt' });
  } else {
    files += 1;
    const robots = readFileSync(robotsPath, 'utf8');
    const lines = robots.split('\n').map((line) => line.trim());
    if (lines.some((line) => /^Disallow:\s*\/$/i.test(line))) {
      findings.push({
        family: 6,
        kind: 'robots-disallows-all',
        detail: 'robots-disallows-all:robots.txt',
      });
    }
    const declared = new Set(
      lines
        .map((line) => /^Sitemap:\s*(\S+)$/i.exec(line)?.[1])
        .filter((value): value is string => value !== undefined),
    );
    // Only the sitemaps this build actually emitted, on the expected origin.
    const emitted = new Set(
      site.locales
        .filter((locale) => existsSync(join(buildDir, sitemapPathFor(locale, site))))
        .map((locale) => `${origin}${base}${sitemapPathFor(locale, site)}`),
    );
    for (const url of emitted) {
      if (!declared.has(url)) {
        findings.push({
          family: 6,
          kind: 'robots-sitemap-unlisted',
          detail: `robots-sitemap-unlisted:${url}`,
        });
      }
    }
    for (const url of declared) {
      if (!emitted.has(url)) {
        findings.push({
          family: 6,
          kind: 'robots-sitemap-unbuilt',
          detail: `robots-sitemap-unbuilt:${url}`,
        });
      }
    }
  }

  // ---- Family 8: the declared favicon exists ------------------------------
  if (!existsSync(join(buildDir, site.favicon))) {
    findings.push({ family: 8, kind: 'favicon-absent', detail: `favicon-absent:${site.favicon}` });
  }

  // ---- Family 12: the URL inventory --------------------------------------
  if (input.inventory === null) {
    notes.push('family 12 — URL inventory absent, skipped (the build that creates it is the one that skips).');
  } else {
    files += 1;
    for (const url of input.inventory) {
      if (!publishedUrls.has(url) && !input.redirects.has(url)) {
        findings.push({
          family: 12,
          kind: 'inventory-url-dropped',
          detail: `inventory-url-dropped:${url}`,
        });
      }
    }
  }

  const sites =
    pages.length +
    [...locsByLocale.values()].reduce((total, locs) => total + locs.length, 0) +
    (input.inventory?.length ?? 0);

  return {
    findings: findings.sort((a, b) => a.family - b.family || a.detail.localeCompare(b.detail)),
    files,
    sites,
    pages: pages.length,
    notes,
  };
}

/** Exit 0 clean, exit 2 on any finding — "nothing read" is already a finding. */
export function docsBuildExitCode(result: DocsBuildVerificationResult): 0 | 2 {
  return result.findings.length > 0 || result.pages === 0 ? 2 : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function navbarLabelsOf(navbar: Record<string, unknown>): readonly string[] {
  const items = Array.isArray(navbar['items']) ? navbar['items'] : [];
  return items
    .map((item) => asRecord(item)['label'])
    .filter((label): label is string => typeof label === 'string' && label.length > 0);
}

/**
 * The chrome a non-default locale must render, read from the files Docusaurus
 * itself reads — never from `code.json`, whose ids are inert for these
 * (`contracts/published-artefact.md` §2).
 */
function localeChromeFor(
  docsDir: string,
  locale: string,
  site: DocsBuildSiteConfig,
): DocsBuildLocaleChrome {
  const read = (file: string): Record<string, unknown> => {
    const path = join(docsDir, 'i18n', locale, file);
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : {};
  };
  const navbar = read('docusaurus-theme-classic/navbar.json');
  const footer = read('docusaurus-theme-classic/footer.json');
  const message = (source: Record<string, unknown>, id: string): string | null => {
    const value = asRecord(source[id])['message'];
    return typeof value === 'string' ? value : null;
  };
  return {
    locale,
    navbarTitle: message(navbar, 'title') ?? site.navbarTitle,
    navbarItemLabels: site.navbarItemLabels.map(
      (label) => message(navbar, `item.label.${label}`) ?? label,
    ),
    footerCopyright: message(footer, 'copyright') ?? site.footerCopyright,
  };
}

function readLines(path: string): readonly string[] | null {
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function main(): void {
  const repoRoot = findRepoRoot(fileURLToPath(new URL('.', import.meta.url)));
  if (repoRoot === null) {
    console.error(`${PREFIX} could not locate the repository root from pnpm-workspace.yaml.`);
    process.exit(2);
  }
  const docsDir = join(repoRoot, 'docs');
  const config = loadDocsSiteConfig(docsDir);
  const locales = loadDocsLocales();
  const themeConfig = asRecord(config['themeConfig']);
  const navbar = asRecord(themeConfig['navbar']);
  const footer = asRecord(themeConfig['footer']);

  const site: DocsBuildSiteConfig = {
    url: String(config['url'] ?? ''),
    baseUrl: String(config['baseUrl'] ?? '/'),
    title: String(config['title'] ?? ''),
    favicon: String(config['favicon'] ?? ''),
    defaultLocale: locales.defaultLocale,
    locales: locales.locales,
    navbarTitle: String(navbar['title'] ?? ''),
    navbarItemLabels: navbarLabelsOf(navbar),
    footerCopyright: String(footer['copyright'] ?? ''),
  };

  const inventoryPath = join(repoRoot, 'specs/133-docs-site-publication/url-inventory.txt');
  const redirectPath = join(repoRoot, 'specs/133-docs-site-publication/redirect-map.txt');

  const result = verifyDocsBuild({
    buildDir: join(docsDir, 'build'),
    site,
    chrome: site.locales
      .filter((locale) => locale !== site.defaultLocale)
      .map((locale) => localeChromeFor(docsDir, locale, site)),
    inventory: readLines(inventoryPath),
    redirects: new Set(readLines(redirectPath) ?? []),
  });

  // The two config files this run judged the artefact against, plus the locale
  // list, count towards what it read: a verifier that could not open them would
  // be comparing the build with nothing.
  reportReadSize({
    prefix: PREFIX,
    files: result.files + 3,
    sites: result.sites,
    coverage: [],
  });
  for (const note of result.notes) {
    console.log(`${PREFIX} ${note}`);
  }
  console.log(
    `${PREFIX} origin=${site.url} pages=${result.pages} findings=${result.findings.length}`,
  );

  if (result.findings.length === 0) {
    process.exit(0);
  }
  for (const finding of result.findings) {
    console.error(`  - [family ${finding.family}] ${finding.detail}`);
  }
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
