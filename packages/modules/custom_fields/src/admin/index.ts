/**
 * `custom_fields`' admin surface — the list, the definition editor's two
 * routes (issue #1804) and one sidebar entry (feature 091, Phase 4, batch 9;
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
 * surface the server's effective enabled-set already filtered; the off-state
 * test drives it. Issue #1804 adds `new-custom-field`, aimed at the create
 * page.
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

/** The list: definitions per entity type. */
const ROUTE_PATH = '/custom-fields';

/**
 * The code the definition reads enforce, and the one the manifest's
 * `open-custom-fields` action already declares — so the palette entry, the
 * sidebar entry and the route agree by construction rather than by three
 * authors remembering.
 *
 * `custom_fields:write` gates the create and delete calls the same screen
 * makes; it is deliberately not the list's gate, because an operator holding
 * only the read code opens the screen and is offered no write.
 */
const CUSTOM_FIELDS_READ_PERMISSION = 'custom_fields:read';
/**
 * The create page writes and nothing else, so it is gated on the write code
 * the create call enforces; the edit page opens for a reader too, who sees the
 * field without being offered it (issue #1804).
 */
const CUSTOM_FIELDS_WRITE_PERMISSION = 'custom_fields:write';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/CustomFieldsPage.js'),
      requiredPermission: CUSTOM_FIELDS_READ_PERMISSION,
      index: true,
    },
    // Issue #1804 — the definition editor on its own route (the kit README's
    // five-field rule), deep-linkable. `new` is static, so the palette's
    // *New custom field* can target it.
    {
      path: `${ROUTE_PATH}/new`,
      component: () => import('./pages/CustomFieldEditorPage.js'),
      requiredPermission: CUSTOM_FIELDS_WRITE_PERMISSION,
    },
    {
      path: `${ROUTE_PATH}/:id`,
      component: () => import('./pages/CustomFieldEditorPage.js'),
      requiredPermission: CUSTOM_FIELDS_READ_PERMISSION,
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
      section: 'platform',
      // Issue #1519 (UX audit SHELL-11, DEC-02) split *System*: *Platform* is
      // how the instance is configured and extended, ordered with the host's
      // own rows by weight — Modules 100, Settings 200, Custom fields 300,
      // Import/export 400, Bulk operations 500, Webhooks 600, Global search
      // 700, PWA 800, Command hooks 900, API description 1000. Custom fields
      // extend Organizations, Orders, Customers, Categories and more, so the
      // row belongs to no one domain.
      weight: 300,
      requiredPermission: CUSTOM_FIELDS_READ_PERMISSION,
    },
  ],
};
