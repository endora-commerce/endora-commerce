/**
 * `sales_channels`' admin surface — three routes, one sidebar entry and two
 * zone contributions (feature 091, P7a and P7b for the zones, Phase 4 batch 14
 * for the registrations;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-component-contribution.md`
 * §10).
 *
 * **Batch 14 added the three routes and the sidebar entry**, and it is the
 * paragraph that used to stand here arriving as a fact: this entry said its
 * screens *"are still under `admin/src/modules/sales_channels/` and move in
 * Phase 4's batch 14"*. They are this package's now. The property that let the
 * zones land first is unchanged and is what schedules both halves —
 * `check:admin-registrations` counts routes and nav entries and a zone is
 * neither, so a contributor and a host may each move without the other.
 *
 * **This module is also a zone *host*, which is the other half of batch 14.**
 * `SalesChannelEditPage.tsx` renders `sales_channel.editor.after`, the member
 * P7c published for it, and `inventory` contributes its warehouse routing panel
 * there.
 *
 * **What it drains**: the third admin key in
 * `backend/scripts/ledgers/cross-module-imports/catalog.ts` —
 * `ProductEditor.tsx` importing `EntityChannelMembership` from this module's
 * admin directory and rendering it as the whole body of its Channels tab. The
 * host keeps the tab and its label, which is its own vocabulary (Z14), and
 * counts this contribution to decide whether to show the button (Z15).
 *
 * **Zone and not a published component**, decided from the signature read off
 * the file in this merge request (§9.3): `(entityType, entityId, onChanged?)` —
 * identifiers in, a change notification back and no `value`/`onChange` pair, so
 * the component owns its own persistence. That is Z1 question 2.
 *
 * **P7b added the second contribution**, over the same component: it drains the
 * `EntityChannelMembership` key of
 * `backend/scripts/ledgers/cross-module-imports/organizations.ts`, and it is a
 * contribution to a *different* member rather than a `match` on this one,
 * because two hosts with a place each are two members (Z13).
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import {
  zoneComponent,
  type AdminContributions,
} from '@endora-commerce/admin-kit/contributions';

/**
 * The one code that opens every surface below — the three screens and the two
 * contributions alike.
 *
 * `packages/modules/sales_channels/src/backend/routes.admin.ts` gates the
 * channel roster and one channel with `sales_channels:read` and every write
 * with `sales_channels:write`, which each screen checks for itself through
 * `useAuth().hasPermission`. It also gates
 * `GET /api/v1/admin/sales-channels/by-entity/:entityType/:entityId` and
 * `GET /api/v1/admin/sales-channels` with `sales_channels:read`; the add and
 * remove behind the panel's two controls take `sales_channels:write`, which a
 * contribution cannot declare a second time. The read code is what makes the
 * surface appear, and it is the honest one: an operator holding it can see the
 * memberships even if the buttons then refuse.
 */
const READ_PERMISSION = 'sales_channels:read';

/**
 * The code the create route enforces.
 *
 * `POST /api/v1/admin/sales-channels` is `requireAdmin('sales_channels:write')`
 * and `/sales-channels/new` lands straight on the form — a screen whose only
 * purpose is a write. The codes are opaque strings, so an operator holding the
 * read code alone must not reach it; this module's own `new-sales-channel`
 * palette action declares the same code, which is what
 * `check:action-route-permissions` holds the pair to. Batch 10 settled the
 * shape for `credentials`' `/credentials/new`, and this is the same screen one
 * module over.
 *
 * **One operator-visible tightening, recorded rather than glossed.** The route
 * was `App.tsx`'s and therefore ungated, so a read-only operator could open a
 * create form whose save button would then refuse. The roster's *+ New channel*
 * button was ungated too and is gated on this code in the same merge request,
 * so the dead end is closed at both ends rather than moved from one to the
 * other.
 */
const WRITE_PERMISSION = 'sales_channels:write';

/** The module's landing route: the channel roster. */
const ROUTE_PATH = '/sales-channels';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/SalesChannelsListPage.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      // The create form and the editor are one component, told apart by the
      // `:code` parameter — `App.tsx` declared them as two routes over one
      // element and this declaration keeps that shape. `/sales-channels/new` is
      // declared first, and `<Routes>` ranks by specificity rather than by
      // declaration order, so the static segment wins whatever the order; the
      // ordering is kept anyway, so a reader does not have to know that to see
      // why the parametric route is safe here.
      //
      // **The create route carries the write code and the editor carries the
      // read one**, which is the split `credentials` already ships: a screen
      // whose only purpose is a write is opened by the code that write demands,
      // and an existing channel is opened by the code that reads it.
      path: `${ROUTE_PATH}/new`,
      component: () => import('./pages/SalesChannelEditPage.js'),
      requiredPermission: WRITE_PERMISSION,
    },
    {
      path: `${ROUTE_PATH}/:code`,
      component: () => import('./pages/SalesChannelEditPage.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/sales_channels/i18n/`. It was
      // `appShell.nav.salesChannels` in the shared `_i18n` bundle, one of the
      // four shared files a module author had to edit.
      labelKey: 'nav.salesChannels.label',
      // The glyph `AppShell.tsx` rendered by hand, and already on
      // `KnownIconNameSchema`.
      icon: 'Store',
      section: 'channels',
      // First in *Channels*, which is where the hand-written table put it and
      // where the operator has always seen it. `dictionaries` declares 200 and
      // 300 and `seo` 400, and the host declares no row in this section once
      // this one leaves, so 100 is the whole of what keeps this row on top.
      weight: 100,
      requiredPermission: READ_PERMISSION,
    },
  ],
  zones: [
    zoneComponent(
      'product.editor.channels',
      () => import('./zones/ProductChannelMembership.js'),
      {
        // The only contribution to this place, so the weight orders nothing
        // today. Declared rather than defaulted so a second contributor arrives
        // beside it rather than ahead of it by accident.
        weight: 100,
        requiredPermission: READ_PERMISSION,
      },
    ),
    // Weight 100 of four contributors to the organization detail's zone
    // (feature 091, P7b): this panel first, then `price_lists` at 200,
    // `quick_order` at 300 and `carts` at 400. That is the order the operator
    // saw when the panels were scattered through `OrganizationDetail.tsx`,
    // preserved rather than re-chosen.
    zoneComponent(
      'organization.detail.after',
      () => import('./zones/OrganizationChannelMembership.js'),
      { weight: 100, requiredPermission: READ_PERMISSION },
    ),
  ],
};
