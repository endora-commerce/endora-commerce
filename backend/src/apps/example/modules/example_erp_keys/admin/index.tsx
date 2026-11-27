import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/**
 * `example_erp_keys`' admin layer (`specs/190-overlay-full-modules/` FR-080 –
 * FR-086): the object a package's `./admin` layer exports, at the fixed path an
 * overlay ships it — one landing screen and its sidebar entry, both on the code
 * the screen's API read is gated on. The palette action that opens the same
 * screen is declared in `manifest.ts` (Principle XVI).
 *
 * It is in `admin/src/deployments/example.generated.ts` and in no other
 * registry, so only an admin built with `DEPLOYMENT=example` holds it, and the
 * shell renders it only while the module is effectively present.
 */

const ROUTE_PATH = '/example-erp-keys';

/** `manifest.ts`' `EXAMPLE_ERP_KEYS_PERMISSION`, spelt out: this layer imports no backend file. */
const READ_PERMISSION = 'example_erp_keys:read';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/ExampleErpKeysPage.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      labelKey: 'nav.exampleErpKeys.label',
      icon: 'KeyRound',
      section: 'customers',
      weight: 400,
      requiredPermission: READ_PERMISSION,
    },
  ],
};
