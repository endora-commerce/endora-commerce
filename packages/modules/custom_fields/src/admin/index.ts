/**
 * `custom_fields`' admin surface — one route and one sidebar entry
 * (feature 091, Phase 4, batch 9;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **Its drain was four incoming reaches and it is zero**, and the reason is
 * worth more than the count. `admin-registrations.ts` filed those four under
 * *"reached as components by screens other modules own, which is FR-007's
 * contribution-zone question"*; `admin-component-contribution.md` §9.1 read
 * them instead of counting them and measured the opposite.
 * `CustomFieldValuesPanel`'s props are `(entityType, values, save)` — data in,
 * edited data back — so all four call sites hand it the **host's** own stored
 * bag and the host's own writer, and this module's admin API serves definitions
 * and no values at all. Nothing of the owner's crosses that seam, so it was
 * never a zone contribution; P4e published it into
 * `@endora-commerce/admin-kit/components` and the four consumers name the
 * subpath directly.
 *
 * **The re-export shim P4e left at `admin/src/modules/custom_fields/` goes with
 * this move.** Its own doc block kept it *"for the owner's own screens"*, and
 * after this batch the owner has no screen under `admin/src` — a package screen
 * cannot resolve a `@/` specifier at all. No file in the tree named it; the
 * `admin-kit-identity.test.ts` case that proved it forwarded rather than copied
 * is removed with the file it compared.
 *
 * **The palette action was already declared** (`open-custom-fields` in
 * `manifest.ts`), which is what makes this module's advertisement the one
 * surface the server's effective enabled-set already filtered. This batch adds
 * none and changes none; the off-state test drives it.
 *
 * **`nonDeactivatable`, so the operator axis is the platform's** (`plan.md`
 * Ruling 2). It is Principle XIV's extensibility mechanism — the answer the
 * platform gives to "add a field" instead of a bespoke column — and switching
 * it off would make the values already stored against every host entity
 * unreachable. The permission axis is what this module still has and is what
 * the off-state test drives; the missing axis is read off the manifest rather
 * than skipped.
 *
 * **This entry exports data and nothing else** (R2); the component is a
 * dynamic-import factory (R6).
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's only route: definitions per entity type, list and create. */
const ROUTE_PATH = '/custom-fields';

/**
 * The code the definition reads enforce, and the one the manifest's
 * `open-custom-fields` action already declares — so the palette entry, the
 * sidebar entry and the route agree by construction rather than by three
 * authors remembering.
 *
 * `custom_fields:write` gates the create and delete calls the same screen
 * makes; it is deliberately not the surface gate, because an operator holding
 * only the read code opens the screen and sees the write affordances refuse.
 */
const CUSTOM_FIELDS_READ_PERMISSION = 'custom_fields:read';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/CustomFieldsPage.js'),
      requiredPermission: CUSTOM_FIELDS_READ_PERMISSION,
      index: true,
    },
  ],
  nav: [
    {
      to: ROUTE_PATH,
      // Module-relative (R8), resolved in this module's own namespace out of
      // `packages/modules/custom_fields/i18n/`. It was
      // `appShell.nav.customFields` in the shared `_i18n` bundle, one of the
      // four shared files a module author had to edit.
      labelKey: 'nav.customFields.label',
      // The glyph `AppShell.tsx` rendered by hand, and already on
      // `KnownIconNameSchema` — this module's own palette action names it.
      icon: 'Layers',
      // Custom fields extend Organizations, Orders, Customers, Categories and
      // more, so the entry belongs to *System* rather than to any one domain —
      // the placement the host comment carried and this declaration keeps.
      section: 'system',
      // The hand-written position in *System* times a hundred, which is batch
      // four's convention: `/custom-fields` was the fifth row of that section
      // before the drain began, between `/catalog/bulk-operations` and
      // `/audit-log`. The weights already declared there — `admin_users` 200,
      // `admin_roles` 300, `audit_logs` 600, `api_keys` 700, `webhooks` 800 —
      // leave 500 exactly where this row sat among them. *System* still holds
      // host-declared entries, so `composeNav` appends every registry row after
      // all of them whatever the weight says.
      weight: 500,
      requiredPermission: CUSTOM_FIELDS_READ_PERMISSION,
    },
  ],
};
