/**
 * `@endora-commerce/admin-kit/zones` — the **host's** side of a zone (feature
 * 091, P4a; Z6).
 *
 * `AdminContributionsProvider` is mounted once by
 * the admin application with its generated registry; `useAdminZone(name, props)`
 * is the primitive — the visible, matched, ordered contributions for one mount;
 * `<AdminZone name props />` is the common case, rendering them all with an
 * error boundary and a `Suspense` each; `<RouteTabsZone name props />` is the
 * one place a zone is a **tab strip**, where the count decides whether the
 * strip exists at all (feature 091, P4d).
 *
 * **A separate subpath from `./contributions`, and the split is deliberate.**
 * `./contributions` is the contributor's side and is data-only — a module's
 * `src/admin/index.ts` imports it — while this subpath renders React. One
 * subpath would let a declaration file import a component, which R2 of
 * `admin-contribution.md` exists to prevent.
 *
 * The barrel is **explicit and holds no `export *`**, per
 * `admin-kit-surface.md` R2.
 */
export { AdminZone } from './AdminZone.js';
export type { AdminZoneRenderProps } from './AdminZone.js';
export { RouteTabsZone } from './RouteTabsZone.js';
export type { RouteTabsZoneProps } from './RouteTabsZone.js';
export {
  AdminContributionsProvider,
  AdminContributionsUnavailableError,
  useAdminContributions,
} from './AdminContributionsProvider.js';
export type {
  AdminContributionsProviderProps,
  AdminZoneRegistryEntry,
  OwnedZoneContribution,
} from './AdminContributionsProvider.js';
export { matchesZoneProps, selectZoneContributions, useAdminZone } from './use-admin-zone.js';
export { ZoneErrorBoundary } from './ZoneErrorBoundary.js';
export type { ZoneErrorBoundaryProps } from './ZoneErrorBoundary.js';
