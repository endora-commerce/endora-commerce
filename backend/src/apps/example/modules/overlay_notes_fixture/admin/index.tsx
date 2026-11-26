import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/**
 * The overlay notes fixture's admin surface (`specs/190-overlay-full-modules/`
 * FR-080 – FR-086, #1855): the layer an overlay module ships at the fixed path
 * `admin/index.tsx`, exporting the `contributions` a package's `./admin` layer
 * exports.
 *
 * It is in `admin/src/deployments/example.generated.ts` and in no other
 * registry, so only an admin built with `DEPLOYMENT=example` holds it. The
 * component is a dynamic-import factory, as in a package's layer.
 */

/** The one screen, and the palette action's target. */
const ROUTE_PATH = '/overlay-notes-fixture';

/** The code the screen's one API read is gated on (`backend.ts`). */
const READ_PERMISSION = 'overlay_notes_fixture:read';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/OverlayNotesFixturePage.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      labelKey: 'nav.overlayNotesFixture.label',
      icon: 'FileText',
      section: 'platform',
      weight: 900,
      requiredPermission: READ_PERMISSION,
    },
  ],
};
