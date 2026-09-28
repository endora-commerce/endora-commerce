// @ts-check
// Docusaurus configuration for the B2B Platform documentation site.
// Built to satisfy the constitution's Documentation Requirements: readable by both
// developers (enough detail to extend a module) and Product Owners (enough clarity
// to understand how to use a module and the system overall).

const localesConfig = require('./locales.config.json');

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Endora Commerce',
  tagline: 'Architecture and usage documentation for the B2B commerce platform',
  favicon: 'img/favicon.svg',

  // The public origin is a **literal** (FR-001, research R1). `url` is the single input
  // Docusaurus derives four artefacts from — the canonical link, `og:url`, the `hreflang`
  // alternates and both sitemaps — so an environment variable with a `localhost` default
  // would reintroduce the silent failure this feature exists to end, and a defaultless one
  // would break every local build (`build` does not load `docs/.env`). `docusaurus start`
  // ignores `url`, so local development is unaffected and `docs/.env` keeps `PORT` alone.
  url: 'https://docs.commerce.endora.software',
  baseUrl: '/',

  // Frozen at first publication (FR-006, FR-042, research R2): the URL served, the URL
  // declared canonical and the URL listed in the sitemap are one string, and nginx's index
  // module never 301-redirects to add a slash. Changing this later is a URL move that
  // carries a redirect obligation.
  trailingSlash: true,

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: localesConfig.defaultLocale,
    locales: localesConfig.locales,
    localeConfigs: {
      pl: {
        label: 'Polski',
      },
    },
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
        sitemap: {
          // `/search` is a route a reader can land on, not a published
          // documentation page. The search plugin marks it `noindex` in the
          // *page HTML*, which is not the route **metadata**
          // `@docusaurus/plugin-sitemap` reads, so it appears in the sitemap
          // unless it is excluded here (measured on the Phase 4 build).
          //
          // **Pin the route root; never glob the segment.** The obvious
          // `'**/search'` also drops `/module-reference/search/` and
          // `/modules/search/` — two real published pages owned by the `search`
          // module. The matcher anchors each pattern (`^(?:\/search\/)$`), and
          // every locale is built with its own `baseUrl`, so the route path
          // carries the locale prefix and the list is derived from the locales
          // rather than written out.
          ignorePatterns: localesConfig.locales.map((locale) =>
            locale === localesConfig.defaultLocale ? '/search/' : `/${locale}/search/`,
          ),
        },
      }),
    ],
  ],

  themes: [
    [
      // Build-time search served from our own origin: no account, no query-time
      // third-party request (FR-040, FR-045, research R10).
      require.resolve('@easyops-cn/docusaurus-search-local'),
      // No JSDoc type import here: the package declares no `types` entry point, so
      // `import('@easyops-cn/docusaurus-search-local')` does not resolve under `@ts-check`.
      {
        // `hashed: true` hashes the **query string**, not the filename: the two indexes
        // are emitted at the stable paths `search-index.json` and `pl/search-index.json`
        // and requested as `search-index.json?_=<hash>` (measured on the Phase 4 build,
        // 2026-09-23). The flag stays — the query string is what stops a reader reusing a
        // previous build's index — but it puts nothing under `/assets/`, so the immutable
        // cache rule there does not reach them. `deploy/nginx.docs.example.conf` gives them
        // their own revalidating rule and records why.
        hashed: true,
        // The classic preset serves docs at the site root, not under /docs.
        docsRouteBasePath: '/',
        indexDocs: true,
        indexBlog: false,
        // Verified at integration rather than assumed: `lunr-languages@1.22.0` does
        // ship `lunr.pl` (Snowball stemmer, trimmer and stop-word list), so Polish is
        // stemmed rather than tokenised with the English pipeline. With two languages
        // the plugin loads `lunr.multi` and builds one multi-language index per locale.
        language: ['en', 'pl'],
      },
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: 'Endora Commerce',
        items: [
          { type: 'docSidebar', sidebarId: 'main', position: 'left', label: 'Docs' },
          { type: 'localeDropdown', position: 'right' },
        ],
      },
      footer: {
        style: 'dark',
        // Public-facing (FR-009, FR-010): the publisher, the licence under which
        // this documentation is published, and the route back to the project.
        // The licence is stated as **text** rather than linked: `LICENSE` and
        // `LICENSING.md` live in a repository a public reader cannot
        // open, so a link to either would be the dead-link class FR-035 exists
        // to remove — and `LICENSING.md` states a mechanism and
        // grants nothing. No published surface describes this site as internal.
        links: [
          {
            label: 'commerce.endora.software',
            href: 'https://commerce.endora.software',
          },
        ],
        copyright: '© 2026 Endora — documentation published under the MIT licence.',
      },
    }),
};

module.exports = config;
