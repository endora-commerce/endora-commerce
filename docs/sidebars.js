// @ts-check

/** Stable sidebar translation key (`sidebar.main.category.<slug>`) with English label. */
function categoryLabel(slug, message) {
  return message;
}

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  main: [
    'intro',
    'getting-started',
    {
      type: 'category',
      key: 'admin-ui',
      label: categoryLabel('admin-ui', 'Admin UI'),
      items: ['admin/mobile-responsive'],
    },
    {
      type: 'category',
      key: 'architecture',
      label: categoryLabel('architecture', 'Architecture'),
      link: { type: 'generated-index', title: 'Architecture' },
      items: [
        'architecture/tenant-scoping',
        'architecture/api-interceptor',
        'architecture/migrations',
        'architecture/command-bus',
        'architecture/custom-fields',
        'architecture/overlay-pattern',
        'architecture/customisation-ladder',
        'architecture/permissions',
        'architecture/pim-connector',
      ],
    },
    {
      type: 'category',
      key: 'api-contracts',
      label: categoryLabel('api-contracts', 'API contracts'),
      link: { type: 'doc', id: 'contracts/README' },
      items: [],
    },
    {
      type: 'category',
      key: 'modules',
      label: categoryLabel('modules', 'Modules'),
      link: { type: 'doc', id: 'modules/README' },
      // Generated — feature 100 / roadmap F12. Every entry is derived from the
      // generated manifest index and the pages on disk; regenerate with
      // `pnpm --filter backend run composer:generate`, and never hand-edit it.
      // A module addition therefore touches no file under `docs/` but its own
      // page, which is what stopped seven modules shipping a page nothing linked.
      items: require('./sidebars.modules.generated.js'),
    },
    {
      type: 'category',
      key: 'integrations',
      label: categoryLabel('integrations', 'Integrations'),
      link: { type: 'generated-index', title: 'Integrations' },
      items: ['integrations/README', 'integrations/api-access'],
    },
    {
      type: 'category',
      key: 'operations',
      label: categoryLabel('operations', 'Operations'),
      link: { type: 'generated-index', title: 'Operations' },
      items: [
        'operations/health-endpoint',
        'operations/queue-consumers',
        'operations/warden',
        {
          type: 'category',
          key: 'runbooks',
          label: categoryLabel('runbooks', 'Runbooks'),
          link: { type: 'generated-index', title: 'Runbooks' },
          items: [
            'operations/runbooks/block-name-migration',
            'operations/runbooks/module-lifecycle-stuck-lock',
          ],
        },
      ],
    },
    {
      type: 'category',
      key: 'deployment',
      label: categoryLabel('deployment', 'Deployment'),
      link: { type: 'generated-index', title: 'Deployment' },
      items: ['deployment/first-deployment-checklist'],
    },
  ],
};

module.exports = sidebars;
