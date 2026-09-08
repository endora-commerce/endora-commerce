import {
  type AdminContributions,
} from '@endora-commerce/admin-kit/contributions';

const READ_PERMISSION = 'invoice_ledger:read';
const DELIVERIES_PATH = '/invoice-ledger/deliveries';
const ROUTING_PATH = '/invoice-ledger/routing';

export const contributions: AdminContributions = {
  routes: [
    {
      path: DELIVERIES_PATH,
      component: () => import('./pages/LedgerDeliveriesPage.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      path: ROUTING_PATH,
      component: () => import('./pages/LedgerRoutingPage.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  nav: [
    {
      to: DELIVERIES_PATH,
      labelKey: 'nav.deliveries.label',
      icon: 'ClipboardList',
      section: 'sales',
      weight: 610,
      requiredPermission: READ_PERMISSION,
    },
  ],
};
