// @ts-check
// Docusaurus configuration for the B2B Platform documentation site.
// Built to satisfy the constitution's Documentation Requirements: readable by both
// developers (enough detail to extend a module) and Product Owners (enough clarity
// to understand how to use a module and the system overall).

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'B2B Platform',
  tagline: 'Architecture and usage documentation for the B2B commerce platform',
  favicon: 'img/favicon.ico',

  url: 'http://localhost:3003',
  baseUrl: '/',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
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
        title: 'B2B Platform',
        items: [
          { type: 'docSidebar', sidebarId: 'main', position: 'left', label: 'Docs' },
        ],
      },
      footer: {
        style: 'dark',
        copyright: 'Internal documentation — see the repository for the governing constitution.',
      },
    }),
};

module.exports = config;
