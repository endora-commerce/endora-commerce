import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';

/**
 * `related_payers`' admin layer (`specs/182-related-payers/`).
 *
 * Two places. The **Payers** section of the organization card, `organization.detail.after`
 * (RP-12, research R-7), behind `related_payers:read` — the code its API enforces. Weight 500:
 * after the four contributors already there (sales channels 100, price display mode 200, quick
 * order 300, carts 400). And the operator queue of payer requests (FR-023): the module's landing
 * route and its sidebar entry under *Customers*, behind the same code; the manifest's palette
 * action `open-payer-requests` opens it (FR-024, Principle XVI).
 */
const QUEUE_ROUTE = '/related-payers/requests';
const READ = 'related_payers:read';

export const contributions: AdminContributions = {
  routes: [
    {
      path: QUEUE_ROUTE,
      component: () => import('./pages/RequestsQueue.js'),
      requiredPermission: READ,
      index: true,
    },
  ],
  nav: [
    {
      to: QUEUE_ROUTE,
      labelKey: 'nav.payerRequests.label',
      icon: 'Inbox',
      section: 'customers',
      // After `/comparisons` (500), the section's last module-declared entry.
      weight: 600,
      requiredPermission: READ,
    },
  ],
  zones: [
    zoneComponent('organization.detail.after', () => import('./panels/PayersPanel.js'), {
      weight: 500,
      requiredPermission: 'related_payers:read',
    }),
  ],
};
