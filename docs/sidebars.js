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
      label: 'API contracts',
      link: { type: 'doc', id: 'contracts/README' },
      items: [],
    },
    {
      type: 'category',
      label: 'Modules',
      link: { type: 'doc', id: 'modules/README' },
      items: [
        'modules/addresses',
        'modules/admin_roles',
        'modules/admin_users',
        'modules/api_keys',
        'modules/assets',
        'modules/audit_logs',
        'modules/auth',
        'modules/carts',
        'modules/catalog',
        'modules/credit_limits',
        'modules/customer_accounts',
        'modules/delivery_methods',
        'modules/health_checks',
        'modules/integrations',
        'modules/inventory',
        'modules/invoices',
        'modules/orders',
        'modules/organizations',
        'modules/payment_methods',
        'modules/payments',
        'modules/quote_requests',
        'modules/search',
        'modules/webhooks',
      ],
    },
    {
      type: 'category',
      label: 'Integrations',
      link: { type: 'generated-index', title: 'Integrations' },
      items: ['integrations/README'],
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
