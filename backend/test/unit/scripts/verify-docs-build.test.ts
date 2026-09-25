import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEV_HOSTS,
  ENGLISH_INTERNAL_FOOTER_LINE,
  SITEMAP_FLOOR,
  docsBuildExitCode,
  verifyDocsBuild,
  type DocsBuildVerificationInput,
} from '../../../scripts/verify-docs-build.js';

/**
 * Companion test for `verify-docs-build`
 * (`specs/133-docs-site-publication/contracts/published-artefact.md` §1).
 *
 * The verifier's population is an **emitted** tree, so every proof here builds a
 * synthetic `build/` on disk and enters through the walk rather than below it.
 * That is deliberate: the defect this instrument exists to refuse is not a wrong
 * assertion, it is a *vacuous* one — a verifier that reports clean because the
 * tree it was pointed at held nothing. A fixture handed in as parsed records
 * could not fail that way, and so could not prove it does not.
 *
 * Each of the twelve families is red at least once, and each red is paired with
 * the green it discriminates from, so that widening a family shows up as a test
 * that stopped failing rather than as a smaller number in a report.
 */

const ORIGIN = 'https://docs.example.com';
const SITE_TITLE = 'Endora Commerce';
const EN_COPYRIGHT = '© 2026 Endora — documentation published under the MIT licence.';
const PL_COPYRIGHT = '© 2026 Endora — dokumentacja publikowana na licencji MIT.';

let fixtureDir: string | undefined;

afterEach(() => {
  if (fixtureDir !== undefined) {
    rmSync(fixtureDir, { recursive: true, force: true });
    fixtureDir = undefined;
  }
});

interface PageSpec {
  /** Path inside the build, e.g. `pl/guide/index.html`. */
  readonly file: string;
  /** The URL path the page is served at, e.g. `/pl/guide/`. */
  readonly path: string;
  /** The counterpart locale's URL path for the same page. */
  readonly counterpartPath: string;
  readonly counterpartLocale: string;
  readonly locale: string;
  readonly title: string;
}

function page(spec: PageSpec): string {
  const navbarTitle = SITE_TITLE;
  const navbarLabel = spec.locale === 'pl' ? 'Dokumentacja' : 'Docs';
  const copyright = spec.locale === 'pl' ? PL_COPYRIGHT : EN_COPYRIGHT;
  const enPath = spec.locale === 'pl' ? spec.counterpartPath : spec.path;
  const plPath = spec.locale === 'pl' ? spec.path : spec.counterpartPath;
  // Each locale is built with its own `baseUrl` and gets its own copy of
  // `static/`, so the Polish tree references `/pl/img/favicon.svg`. The fixture
  // reproduces that rather than the shape a reader would guess.
  const localeBase = spec.locale === 'pl' ? '/pl/' : '/';
  return [
    `<!doctype html><html lang="${spec.locale}"><head>`,
    `<title data-rh="true">${spec.title} | ${SITE_TITLE}</title>`,
    `<meta data-rh="true" property="og:url" content="${ORIGIN}${spec.path}">`,
    `<link data-rh="true" rel="icon" href="${localeBase}img/favicon.svg">`,
    `<link data-rh="true" rel="canonical" href="${ORIGIN}${spec.path}">`,
    `<link data-rh="true" rel="alternate" href="${ORIGIN}${enPath}" hreflang="en">`,
    `<link data-rh="true" rel="alternate" href="${ORIGIN}${plPath}" hreflang="pl">`,
    `<link data-rh="true" rel="alternate" href="${ORIGIN}${enPath}" hreflang="x-default">`,
    `<link rel="stylesheet" href="/assets/css/styles.css">`,
    `<script src="/assets/js/main.js" defer></script>`,
    `</head><body>`,
    `<nav class="navbar"><b class="navbar__title text--truncate">${navbarTitle}</b>`,
    `<a class="navbar__item navbar__link" href="${spec.locale === 'pl' ? '/pl/' : '/'}">${navbarLabel}</a>`,
    `<ul class="dropdown__menu">`,
    `<li><a href="${enPath}" target="_self" class="dropdown__link" lang="en">English</a></li>`,
    `<li><a href="${plPath}" target="_self" class="dropdown__link" lang="pl">Polski</a></li>`,
    `</ul></nav>`,
    `<main><h1>${spec.title}</h1><p>See specs/133-docs-site-publication for the provenance.</p></main>`,
    `<footer><div class="footer__copyright">${copyright}</div></footer>`,
    `</body></html>`,
  ].join('\n');
}

function sitemap(paths: readonly string[]): string {
  const locs = paths.map((path) => `<url><loc>${ORIGIN}${path}</loc></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset>${locs}</urlset>`;
}

function write(dir: string, file: string, content: string): void {
  const absolute = join(dir, file);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

/** The pages both trees hold: the home, one doc, and the search route. */
const ROUTES: readonly { readonly slug: string; readonly title: string }[] = [
  { slug: '', title: 'B2B Platform — Introduction' },
  { slug: 'guide/', title: 'The guide' },
  { slug: 'search/', title: 'Search the documentation' },
];

/**
 * A complete, clean synthetic build — the green every red below is measured
 * against. Anything a test wants red, it breaks after this has written it.
 */
function cleanBuild(): string {
  const dir = mkdtempSync(join(tmpdir(), 'verify-docs-build-'));
  fixtureDir = dir;
  for (const route of ROUTES) {
    write(
      dir,
      `${route.slug}index.html`,
      page({
        file: `${route.slug}index.html`,
        path: `/${route.slug}`,
        counterpartPath: `/pl/${route.slug}`,
        counterpartLocale: 'pl',
        locale: 'en',
        title: route.title,
      }),
    );
    write(
      dir,
      `pl/${route.slug}index.html`,
      page({
        file: `pl/${route.slug}index.html`,
        path: `/pl/${route.slug}`,
        counterpartPath: `/${route.slug}`,
        counterpartLocale: 'en',
        locale: 'pl',
        title: route.title,
      }),
    );
  }
  write(dir, 'sitemap.xml', sitemap(['/', '/guide/']));
  write(dir, 'pl/sitemap.xml', sitemap(['/pl/', '/pl/guide/']));
  write(
    dir,
    'robots.txt',
    ['User-agent: *', 'Allow: /', '', `Sitemap: ${ORIGIN}/sitemap.xml`, `Sitemap: ${ORIGIN}/pl/sitemap.xml`].join(
      '\n',
    ),
  );
  write(dir, 'img/favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  write(dir, 'pl/img/favicon.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  return dir;
}

function input(dir: string, overrides: Partial<DocsBuildVerificationInput> = {}): DocsBuildVerificationInput {
  return {
    buildDir: dir,
    site: {
      url: ORIGIN,
      baseUrl: '/',
      title: SITE_TITLE,
      favicon: 'img/favicon.svg',
      defaultLocale: 'en',
      locales: ['en', 'pl'],
      navbarTitle: SITE_TITLE,
      navbarItemLabels: ['Docs'],
      footerCopyright: EN_COPYRIGHT,
    },
    chrome: [
      {
        locale: 'pl',
        navbarTitle: SITE_TITLE,
        navbarItemLabels: ['Dokumentacja'],
        footerCopyright: PL_COPYRIGHT,
      },
    ],
    // Two routes per locale is a deliberate fixture: the real floor is asserted
    // separately, on the constant rather than on a 193-page fixture.
    sitemapFloor: 2,
    inventory: null,
    redirects: new Set<string>(),
    ...overrides,
  };
}

function families(result: { readonly findings: readonly { readonly family: number }[] }): number[] {
  return [...new Set(result.findings.map((finding) => finding.family))].sort((a, b) => a - b);
}

function kinds(result: { readonly findings: readonly { readonly kind: string }[] }): string[] {
  return [...new Set(result.findings.map((finding) => finding.kind))].sort();
}

describe('verify-docs-build — the clean artefact', () => {
  it('passes a complete build with no finding in any family', () => {
    const dir = cleanBuild();
    const result = verifyDocsBuild(input(dir));
    expect(result.findings).toEqual([]);
    expect(docsBuildExitCode(result)).toBe(0);
    expect(result.pages).toBe(ROUTES.length * 2);
  });
});

describe('verify-docs-build — the vacuous-pass guard', () => {
  it('refuses an empty build directory instead of reporting clean', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-docs-build-empty-'));
    fixtureDir = dir;
    const result = verifyDocsBuild(input(dir));
    expect(result.pages).toBe(0);
    expect(kinds(result)).toContain('empty-build');
    expect(docsBuildExitCode(result)).toBe(2);
  });

  it('refuses a build directory that does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-docs-build-missing-'));
    fixtureDir = dir;
    const result = verifyDocsBuild(input(join(dir, 'build')));
    expect(kinds(result)).toContain('build-absent');
    expect(docsBuildExitCode(result)).toBe(2);
  });

  it('refuses a partial build — the Polish tree emitted and the English one not', () => {
    const dir = cleanBuild();
    rmSync(join(dir, 'index.html'));
    rmSync(join(dir, 'guide'), { recursive: true });
    rmSync(join(dir, 'search'), { recursive: true });
    const result = verifyDocsBuild(input(dir));
    expect(families(result)).toContain(1);
    expect(docsBuildExitCode(result)).toBe(2);
  });
});

describe('verify-docs-build — family 1, both locales built', () => {
  it('reds when a locale home page is missing', () => {
    const dir = cleanBuild();
    rmSync(join(dir, 'pl/index.html'));
    const result = verifyDocsBuild(input(dir));
    expect(families(result)).toContain(1);
    expect(kinds(result)).toContain('locale-home-missing');
  });

  it('reds when a locale home page exists but is empty', () => {
    const dir = cleanBuild();
    writeFileSync(join(dir, 'pl/index.html'), '', 'utf8');
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('locale-home-empty');
  });
});

describe('verify-docs-build — family 2, canonical and the origin shape', () => {
  it('refuses a http origin however the configuration spells it', () => {
    const dir = cleanBuild();
    const result = verifyDocsBuild(input(dir, { site: { ...input(dir).site, url: 'http://docs.example.com' } }));
    expect(kinds(result)).toContain('origin-not-https');
    expect(families(result)).toContain(2);
  });

  it('refuses an origin carrying a port — the pre-publication shape', () => {
    const dir = cleanBuild();
    const result = verifyDocsBuild(
      input(dir, { site: { ...input(dir).site, url: 'https://docs.example.com:3003' } }),
    );
    expect(kinds(result)).toContain('origin-has-port');
  });

  it.each(DEV_HOSTS.map((host) => [host] as const))(
    'refuses %s as an origin host, which is what makes this family the ordering instrument',
    (host) => {
      const dir = cleanBuild();
      const result = verifyDocsBuild(input(dir, { site: { ...input(dir).site, url: `https://${host}` } }));
      expect(kinds(result)).toContain('origin-dev-host');
    },
  );

  it('refuses a wildcard dev host — `docs.local` is not a public origin', () => {
    const dir = cleanBuild();
    const result = verifyDocsBuild(input(dir, { site: { ...input(dir).site, url: 'https://docs.local' } }));
    expect(kinds(result)).toContain('origin-dev-host');
  });

  it('reds on a canonical that names another origin', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace(`rel="canonical" href="${ORIGIN}/guide/"`, 'rel="canonical" href="https://elsewhere.example.com/guide/"');
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('canonical-off-origin');
  });

  it('reds on a canonical that names the right origin but the wrong page', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace(`rel="canonical" href="${ORIGIN}/guide/"`, `rel="canonical" href="${ORIGIN}/"`);
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('canonical-mismatch');
  });

  it('reds on a development host left in head metadata even when the origin is public', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace('<link rel="stylesheet" href="/assets/css/styles.css">', '<link rel="preconnect" href="http://localhost:3003">');
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('dev-origin-in-head');
  });

  it('leaves a development host in page prose alone — the family is about head metadata', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace('<h1>The guide</h1>', '<h1>The guide</h1><pre>curl http://localhost:3001/api/v1/health</pre>');
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).not.toContain('dev-origin-in-head');
  });

  it('reds on a page carrying no canonical at all', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace(/<link data-rh="true" rel="canonical"[^>]*>/, '');
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('canonical-absent');
  });
});

describe('verify-docs-build — family 3, og:url', () => {
  it('reds when og:url names a different page', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace(`property="og:url" content="${ORIGIN}/guide/"`, `property="og:url" content="${ORIGIN}/other/"`);
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(families(result)).toContain(3);
    expect(kinds(result)).toContain('og-url-mismatch');
  });

  it('reds when og:url is absent', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace(/<meta data-rh="true" property="og:url"[^>]*>/, '');
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('og-url-absent');
  });
});

describe('verify-docs-build — family 4, hreflang', () => {
  it('reds when a page drops the x-default alternate', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace(/<link data-rh="true" rel="alternate"[^>]*hreflang="x-default">/, '');
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(families(result)).toContain(4);
    expect(kinds(result)).toContain('hreflang-missing');
  });

  it('reds when an alternate points at the wrong locale URL', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace(`href="${ORIGIN}/pl/guide/" hreflang="pl"`, `href="${ORIGIN}/pl/" hreflang="pl"`);
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('hreflang-mismatch');
  });

  it('reds when an alternate is served from another origin', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace(`href="${ORIGIN}/pl/guide/" hreflang="pl"`, 'href="https://elsewhere.example.com/pl/guide/" hreflang="pl"');
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('hreflang-off-origin');
  });
});

describe('verify-docs-build — family 5, sitemaps', () => {
  it('reds when a locale sitemap is missing', () => {
    const dir = cleanBuild();
    rmSync(join(dir, 'pl/sitemap.xml'));
    const result = verifyDocsBuild(input(dir));
    expect(families(result)).toContain(5);
    expect(kinds(result)).toContain('sitemap-missing');
  });

  it('reds when a <loc> is not on the expected origin', () => {
    const dir = cleanBuild();
    write(dir, 'sitemap.xml', sitemap(['/', '/guide/']).replace(`${ORIGIN}/guide/`, 'https://elsewhere.example.com/guide/'));
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('sitemap-loc-off-origin');
  });

  it('reds when the two locales disagree on how many URLs they publish', () => {
    const dir = cleanBuild();
    write(dir, 'pl/sitemap.xml', sitemap(['/pl/']));
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('sitemap-count-mismatch');
  });

  it('reds when a sitemap falls below the recorded floor', () => {
    const dir = cleanBuild();
    const result = verifyDocsBuild(input(dir, { sitemapFloor: 50 }));
    expect(kinds(result)).toContain('sitemap-below-floor');
  });

  it('pins the floor SC-005 records from the current build', () => {
    expect(SITEMAP_FLOOR).toBe(193);
  });

  it('reds when the search route appears in a sitemap', () => {
    const dir = cleanBuild();
    write(dir, 'sitemap.xml', sitemap(['/', '/guide/', '/search/']));
    write(dir, 'pl/sitemap.xml', sitemap(['/pl/', '/pl/guide/', '/pl/search/']));
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('sitemap-search-route');
    expect(result.findings.filter((finding) => finding.kind === 'sitemap-search-route')).toHaveLength(2);
  });

  it('leaves a documentation page whose last segment is `search` in the sitemap', () => {
    // The trap the fallback pattern walks into: `**/search` drops
    // `/module-reference/search/` and `/modules/search/`, two published pages
    // the `search` module owns. The route root is what is excluded, not the segment.
    const dir = cleanBuild();
    write(dir, 'sitemap.xml', sitemap(['/', '/guide/', '/modules/search/', '/module-reference/search/']));
    write(dir, 'pl/sitemap.xml', sitemap(['/pl/', '/pl/guide/', '/pl/modules/search/', '/pl/module-reference/search/']));
    write(dir, 'modules/search/index.html', '<!doctype html><html><head></head><body></body></html>');
    write(dir, 'module-reference/search/index.html', '<!doctype html><html><head></head><body></body></html>');
    write(dir, 'pl/modules/search/index.html', '<!doctype html><html><head></head><body></body></html>');
    write(dir, 'pl/module-reference/search/index.html', '<!doctype html><html><head></head><body></body></html>');
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).not.toContain('sitemap-search-route');
  });
});

describe('verify-docs-build — family 6, robots.txt', () => {
  it('reds when robots.txt is absent', () => {
    const dir = cleanBuild();
    rmSync(join(dir, 'robots.txt'));
    const result = verifyDocsBuild(input(dir));
    expect(families(result)).toContain(6);
    expect(kinds(result)).toContain('robots-absent');
  });

  it('reds when robots.txt forbids crawling outright', () => {
    const dir = cleanBuild();
    write(dir, 'robots.txt', ['User-agent: *', 'Disallow: /', '', `Sitemap: ${ORIGIN}/sitemap.xml`, `Sitemap: ${ORIGIN}/pl/sitemap.xml`].join('\n'));
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('robots-disallows-all');
  });

  it('reds when a sitemap this build emitted is not named in robots.txt', () => {
    const dir = cleanBuild();
    write(dir, 'robots.txt', ['User-agent: *', 'Allow: /', '', `Sitemap: ${ORIGIN}/sitemap.xml`].join('\n'));
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('robots-sitemap-unlisted');
  });

  it('reds when robots.txt names a sitemap this build did not emit', () => {
    const dir = cleanBuild();
    write(
      dir,
      'robots.txt',
      ['User-agent: *', 'Allow: /', '', `Sitemap: ${ORIGIN}/sitemap.xml`, `Sitemap: ${ORIGIN}/pl/sitemap.xml`, `Sitemap: ${ORIGIN}/de/sitemap.xml`].join('\n'),
    );
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('robots-sitemap-unbuilt');
  });

  it('reds when robots.txt names the sitemaps on a development origin — the other half of the ordering instrument', () => {
    const dir = cleanBuild();
    write(
      dir,
      'robots.txt',
      ['User-agent: *', 'Allow: /', '', 'Sitemap: http://localhost:3003/sitemap.xml', 'Sitemap: http://localhost:3003/pl/sitemap.xml'].join('\n'),
    );
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('robots-sitemap-unbuilt');
  });
});

describe('verify-docs-build — family 7, trailing slash', () => {
  it('reds on a sitemap <loc> with no trailing slash', () => {
    const dir = cleanBuild();
    write(dir, 'sitemap.xml', sitemap(['/', '/guide']));
    const result = verifyDocsBuild(input(dir));
    expect(families(result)).toContain(7);
    expect(kinds(result)).toContain('loc-no-trailing-slash');
  });

  it('reds on a sitemap <loc> that resolves to no page in the build', () => {
    const dir = cleanBuild();
    write(dir, 'sitemap.xml', sitemap(['/', '/guide/', '/withdrawn/']));
    write(dir, 'pl/sitemap.xml', sitemap(['/pl/', '/pl/guide/', '/pl/withdrawn/']));
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('loc-unresolved');
  });

  it('reds on a canonical with no trailing slash', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace(`rel="canonical" href="${ORIGIN}/guide/"`, `rel="canonical" href="${ORIGIN}/guide"`);
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('canonical-no-trailing-slash');
  });
});

describe('verify-docs-build — family 8, declared assets', () => {
  it('reds when the declared favicon is not in the build output', () => {
    const dir = cleanBuild();
    rmSync(join(dir, 'img/favicon.svg'));
    const result = verifyDocsBuild(input(dir));
    expect(families(result)).toContain(8);
    expect(kinds(result)).toContain('favicon-absent');
  });

  it('reds when a page references a favicon other than the declared one', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace('rel="icon" href="/img/favicon.svg"', 'rel="icon" href="/img/other.svg"');
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('favicon-not-referenced');
  });

  it('accepts the Polish tree referencing the favicon under its own locale base', () => {
    const dir = cleanBuild();
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).not.toContain('favicon-not-referenced');
  });

  it('reds when a locale references the declared favicon but its copy is missing', () => {
    const dir = cleanBuild();
    rmSync(join(dir, 'pl/img/favicon.svg'));
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('favicon-unresolved');
  });
});

describe('verify-docs-build — family 9, no doc-id titles', () => {
  it('reds when a page title is the doc id its URL path derives', () => {
    const dir = cleanBuild();
    write(dir, 'module-reference/addresses/index.html', docIdTitledPage('/module-reference/addresses/', 'module-reference/addresses'));
    const result = verifyDocsBuild(input(dir));
    expect(families(result)).toContain(9);
    expect(kinds(result)).toContain('doc-id-title');
  });

  it('leaves a human title that happens to capitalise its path segment alone', () => {
    const dir = cleanBuild();
    write(dir, 'checkout/index.html', docIdTitledPage('/checkout/', 'Checkout'));
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).not.toContain('doc-id-title');
  });

  function docIdTitledPage(path: string, title: string): string {
    const plPath = `/pl${path}`;
    return [
      '<!doctype html><html lang="en"><head>',
      `<title data-rh="true">${title} | ${SITE_TITLE}</title>`,
      `<meta data-rh="true" property="og:url" content="${ORIGIN}${path}">`,
      `<link data-rh="true" rel="icon" href="/img/favicon.svg">`,
      `<link data-rh="true" rel="canonical" href="${ORIGIN}${path}">`,
      `<link data-rh="true" rel="alternate" href="${ORIGIN}${path}" hreflang="en">`,
      `<link data-rh="true" rel="alternate" href="${ORIGIN}${plPath}" hreflang="pl">`,
      `<link data-rh="true" rel="alternate" href="${ORIGIN}${path}" hreflang="x-default">`,
      '</head><body>',
      `<nav class="navbar"><b class="navbar__title text--truncate">${SITE_TITLE}</b>`,
      '<a class="navbar__item navbar__link" href="/">Docs</a>',
      '<ul class="dropdown__menu">',
      `<li><a href="${path}" target="_self" class="dropdown__link" lang="en">English</a></li>`,
      `<li><a href="${plPath}" target="_self" class="dropdown__link" lang="pl">Polski</a></li>`,
      '</ul></nav>',
      `<footer><div class="footer__copyright">${EN_COPYRIGHT}</div></footer>`,
      '</body></html>',
    ].join('\n');
  }
});

describe('verify-docs-build — family 10, chrome in both trees and the locale switcher', () => {
  it('reds when a Polish page carries the English footer copyright', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'pl/guide/index.html',
      path: '/pl/guide/',
      counterpartPath: '/guide/',
      counterpartLocale: 'en',
      locale: 'pl',
      title: 'The guide',
    }).replace(PL_COPYRIGHT, EN_COPYRIGHT);
    write(dir, 'pl/guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(families(result)).toContain(10);
    expect(kinds(result)).toContain('locale-chrome-missing');
  });

  it('reds when a Polish page carries the English navbar item label', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'pl/guide/index.html',
      path: '/pl/guide/',
      counterpartPath: '/guide/',
      counterpartLocale: 'en',
      locale: 'pl',
      title: 'The guide',
    }).replace('>Dokumentacja</a>', '>Docs</a>');
    write(dir, 'pl/guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('locale-chrome-missing');
  });

  it('reds on the English internal footer line in the English tree', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace(EN_COPYRIGHT, ENGLISH_INTERNAL_FOOTER_LINE);
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('internal-footer-line');
  });

  it('reds on the English internal footer line in the Polish tree as well', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'pl/guide/index.html',
      path: '/pl/guide/',
      counterpartPath: '/guide/',
      counterpartLocale: 'en',
      locale: 'pl',
      title: 'The guide',
    }).replace(PL_COPYRIGHT, ENGLISH_INTERNAL_FOOTER_LINE);
    write(dir, 'pl/guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('internal-footer-line');
  });

  it('reds when an English page loses the configured navbar title', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace(`>${SITE_TITLE}</b>`, '>B2B Platform</b>');
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('site-chrome-missing');
  });

  it('reds when a page carries no locale-switcher anchor to its counterpart', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace(/<li><a href="\/pl\/guide\/"[^>]*lang="pl">[^<]*<\/a><\/li>/, '');
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('locale-switcher-missing');
  });

  it('accepts the 404 page whose switcher names the route Docusaurus gives it, not its synthetic URL', () => {
    // `404.html` is served on error and has no URL of its own — its canonical is
    // the synthetic `/404.html/` while its switcher points at `/pl/404/`. The
    // anchor is there and works; pinning its href would red a correct build.
    const dir = cleanBuild();
    write(dir, '404.html', notFoundPage('en'));
    write(dir, 'pl/404.html', notFoundPage('pl'));
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).not.toContain('locale-switcher-missing');
  });

  it('still reds when the 404 page carries no switcher anchor at all', () => {
    const dir = cleanBuild();
    write(dir, '404.html', notFoundPage('en').replace(/<li><a href="\/pl\/404\/"[\s\S]*?<\/li>/, ''));
    write(dir, 'pl/404.html', notFoundPage('pl'));
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('locale-switcher-missing');
  });

  function notFoundPage(locale: 'en' | 'pl'): string {
    const path = locale === 'pl' ? '/pl/404.html/' : '/404.html/';
    const localeBase = locale === 'pl' ? '/pl/' : '/';
    const copyright = locale === 'pl' ? PL_COPYRIGHT : EN_COPYRIGHT;
    const label = locale === 'pl' ? 'Dokumentacja' : 'Docs';
    return [
      `<!doctype html><html lang="${locale}"><head>`,
      `<title data-rh="true">Page Not Found | ${SITE_TITLE}</title>`,
      `<meta data-rh="true" property="og:url" content="${ORIGIN}${path}">`,
      `<link data-rh="true" rel="icon" href="${localeBase}img/favicon.svg">`,
      `<link data-rh="true" rel="canonical" href="${ORIGIN}${path}">`,
      `<link data-rh="true" rel="alternate" href="${ORIGIN}/404.html/" hreflang="en">`,
      `<link data-rh="true" rel="alternate" href="${ORIGIN}/pl/404.html/" hreflang="pl">`,
      `<link data-rh="true" rel="alternate" href="${ORIGIN}/404.html/" hreflang="x-default">`,
      '</head><body>',
      `<nav class="navbar"><b class="navbar__title text--truncate">${SITE_TITLE}</b>`,
      `<a class="navbar__item navbar__link" href="${localeBase}">${label}</a>`,
      '<ul class="dropdown__menu">',
      '<li><a href="/404/" target="_self" class="dropdown__link" lang="en">English</a></li>',
      '<li><a href="/pl/404/" target="_self" class="dropdown__link" lang="pl">Polski</a></li>',
      '</ul></nav>',
      `<footer><div class="footer__copyright">${copyright}</div></footer>`,
      '</body></html>',
    ].join('\n');
  }

  it('reds when the switcher anchor points at the counterpart locale home rather than this page', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace('<li><a href="/pl/guide/"', '<li><a href="/pl/"');
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('locale-switcher-missing');
  });
});

describe('verify-docs-build — family 11, third-party requests and specs hyperlinks', () => {
  it('reds on a third-party script', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace('</head>', '<script src="https://www.googletagmanager.com/gtag/js"></script></head>');
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(families(result)).toContain(11);
    expect(kinds(result)).toContain('third-party-request');
  });

  it('reds on a third-party stylesheet, preconnect, image and frame alike', () => {
    const dir = cleanBuild();
    const extras = [
      '<link rel="stylesheet" href="https://fonts.example.net/css">',
      '<link rel="preconnect" href="https://cdn.example.net">',
      '<img src="https://images.example.net/a.png">',
      '<iframe src="https://player.example.net/v"></iframe>',
    ].join('');
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace('</body>', `${extras}</body>`);
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(result.findings.filter((finding) => finding.kind === 'third-party-request')).toHaveLength(4);
  });

  it('leaves a prose anchor to an external site alone — the family is about requests made on load', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace('</main>', '<a href="https://commerce.endora.software">Endora</a></main>');
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).not.toContain('third-party-request');
  });

  it('reds on an <a href> targeting a specs/ path', () => {
    const dir = cleanBuild();
    const html = page({
      file: 'guide/index.html',
      path: '/guide/',
      counterpartPath: '/pl/guide/',
      counterpartLocale: 'pl',
      locale: 'en',
      title: 'The guide',
    }).replace('</main>', '<a href="/specs/133-docs-site-publication/spec.md">the spec</a></main>');
    write(dir, 'guide/index.html', html);
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).toContain('specs-hyperlink');
  });

  it('leaves a specs/NNN citation in prose alone — it is text, not a link', () => {
    const dir = cleanBuild();
    const result = verifyDocsBuild(input(dir));
    expect(kinds(result)).not.toContain('specs-hyperlink');
  });
});

describe('verify-docs-build — family 12, the URL inventory', () => {
  it('skips with a printed note, not silently, when the inventory does not exist yet', () => {
    const dir = cleanBuild();
    const result = verifyDocsBuild(input(dir));
    expect(result.notes.some((note) => note.includes('inventory absent'))).toBe(true);
    expect(families(result)).not.toContain(12);
  });

  it('reds when an inventoried URL is no longer published and no redirect covers it', () => {
    const dir = cleanBuild();
    const result = verifyDocsBuild(input(dir, { inventory: [`${ORIGIN}/`, `${ORIGIN}/withdrawn/`] }));
    expect(families(result)).toContain(12);
    expect(kinds(result)).toContain('inventory-url-dropped');
  });

  it('accepts an inventoried URL a committed redirect map covers', () => {
    const dir = cleanBuild();
    const result = verifyDocsBuild(
      input(dir, {
        inventory: [`${ORIGIN}/`, `${ORIGIN}/withdrawn/`],
        redirects: new Set([`${ORIGIN}/withdrawn/`]),
      }),
    );
    expect(kinds(result)).not.toContain('inventory-url-dropped');
  });

  it('accepts an inventory every sitemap still carries', () => {
    const dir = cleanBuild();
    const result = verifyDocsBuild(input(dir, { inventory: [`${ORIGIN}/`, `${ORIGIN}/pl/guide/`] }));
    expect(result.findings).toEqual([]);
    expect(docsBuildExitCode(result)).toBe(0);
  });
});
