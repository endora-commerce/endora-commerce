// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  main: [
    'intro',
    {
      type: 'category',
      label: 'Architecture',
      link: { type: 'generated-index', title: 'Architecture' },
      items: [],
    },
    {
      type: 'category',
      label: 'Modules',
      link: { type: 'generated-index', title: 'Modules' },
      items: [],
    },
    {
      type: 'category',
      label: 'Integrations',
      link: { type: 'generated-index', title: 'Integrations' },
      items: [],
    },
    {
      type: 'category',
      label: 'Deployment',
      link: { type: 'generated-index', title: 'Deployment' },
      items: [],
    },
  ],
};

module.exports = sidebars;
