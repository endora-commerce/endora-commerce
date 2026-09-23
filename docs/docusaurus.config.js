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
  favicon: 'img/favicon.ico',

  url: 'http://localhost:3003',
  baseUrl: '/',

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
      }),
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
        // `LICENSE-COMMERCIAL.md` live in a repository a public reader cannot
        // open, so a link to either would be the dead-link class FR-035 exists
        // to remove — and `LICENSE-COMMERCIAL.md` is a self-declared
        // placeholder that grants nothing. No published surface describes this
        // site as internal.
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
