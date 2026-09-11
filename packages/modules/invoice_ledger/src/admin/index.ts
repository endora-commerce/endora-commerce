import {
  zoneComponent,
  type AdminContributions,
} from '@endora-commerce/admin-kit/contributions';

const READ_PERMISSION = 'invoice_ledger:read';
const DELIVERIES_PATH = '/invoice-ledger/deliveries';
const ROUTING_PATH = '/invoice-ledger/routing';

/**
 * Invoice-ledger admin: two routes, one sidebar row, two strip tabs.
 *
 * Routing is not a second Sales destination. It sits on `ledger.section.tabs`
 * next to deliveries, the same way invoice templates sit behind
 * `InvoiceSectionTabs` rather than a sidebar row. Vendor adapters (Infakt)
 * contribute further tabs; this module does not name them.
 */
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
  zones: [
    zoneComponent('invoice.detail.after', () => import('./zones/InvoiceLedgerRemoteIdPanel.js'), {
      weight: 90,
      requiredPermission: READ_PERMISSION,
    }),
    zoneComponent('ledger.section.tabs', () => import('./zones/LedgerDeliveriesTab.js'), {
      weight: 100,
      requiredPermission: READ_PERMISSION,
    }),
    zoneComponent('ledger.section.tabs', () => import('./zones/LedgerRoutingTab.js'), {
      weight: 200,
      requiredPermission: READ_PERMISSION,
    }),
  ],
};
