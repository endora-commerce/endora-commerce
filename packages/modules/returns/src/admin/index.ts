/**
 * `returns`' admin surface — five routes and one sidebar entry, declared by the
 * module that owns them (feature 091, Phase 4, batch 8;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **Its two drains were both `orders`'**, and both took the same exit:
 * publication into `@endora-commerce/admin-kit`.
 * `backend/scripts/ledgers/cross-module-imports/returns.ts` recorded
 * `orderStatusBadgeStyle` — two pure functions over a hex string that cannot
 * tell an order status from a return one, so it is published as
 * `statusBadgeStyle` — and `StatusTransitionGraph`, which
 * `admin-component-contribution.md` Z1 question 1 classifies as a published
 * component rather than a zone contribution: it takes data in and callbacks out
 * and holds no `orders` vocabulary. The shard is deleted rather than edited.
 *
 * **Five routes and one nav entry, and the four sub-screens deliberately have
 * none.** `/returns/statuses`, `/returns/reasons` and
 * `/returns/delivery-methods` are configuration surfaces reached from the list,
 * and `/returns/:id` is a row's detail; a nav entry is a landing surface, and
 * `registryCrumbs` derives all four trails from this entry's own `to` because
 * it matches anything beneath it.
 *
 * **Route order is load-bearing here and nowhere else in this batch.** The
 * three literal sub-paths are declared before `/returns/:id`, because
 * `react-router` ranks a static segment above a dynamic one but the registry's
 * order is what the generated table preserves, and a `:id` route that matched
 * `statuses` first would render the detail screen over a configuration URL.
 *
 * **Both palette actions are already the manifest's** (`open-returns`,
 * `return-statuses`), so nothing about the ⌘K surface moves here.
 *
 * **This entry exports data and nothing else** (R2); every component is a
 * dynamic-import factory (R6).
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's landing route: the returns/RMA case list. */
const LIST_ROUTE = '/returns';

/**
 * Every `/api/v1/admin/returns/*` `GET` enforces this, the three configuration
 * screens' included — so it is the code that opens all five screens, and the
 * write code gates the mutations they offer. Hiding a screen a read-only
 * operator can legitimately open is issue #232's finding.
 */
const RETURNS_READ = 'returns:read';

export const contributions: AdminContributions = {
  routes: [
    {
      path: LIST_ROUTE,
      component: () => import('./pages/ReturnsList.js'),
      requiredPermission: RETURNS_READ,
      index: true,
    },
    {
      path: '/returns/statuses',
      component: () => import('./pages/ReturnStatusesConfigPage.js'),
      requiredPermission: RETURNS_READ,
    },
    {
      path: '/returns/reasons',
      component: () => import('./pages/ReturnReasonsPage.js'),
      requiredPermission: RETURNS_READ,
    },
    {
      path: '/returns/delivery-methods',
      component: () => import('./pages/ReturnDeliveryMethodsPage.js'),
      requiredPermission: RETURNS_READ,
    },
    {
      path: '/returns/:id',
      component: () => import('./pages/ReturnDetail.js'),
      requiredPermission: RETURNS_READ,
    },
  ],
  nav: [
    {
      to: LIST_ROUTE,
      // Module-relative (R8), out of `packages/modules/returns/i18n/`. It was
      // `appShell.nav.returns` in the shared `_i18n` bundle.
      labelKey: 'nav.returns.label',
      icon: 'Package',
      section: 'sales',
      // Fourth of seven in the hand-written *Sales* table, after the three
      // `/orders*` rows and before `/quote-requests`. Every other row there is
      // still the host's, so this appends after all of them; the weight is what
      // restores the position once `orders` (batch 12) and `quote_requests`
      // (batch 10) convert.
      weight: 400,
      requiredPermission: RETURNS_READ,
    },
  ],
};
