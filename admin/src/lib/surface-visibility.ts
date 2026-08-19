import { useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { useModulePresence } from '@/lib/module-presence';

/**
 * One predicate for "may this operator see this destination at all", shared by
 * every static index the admin renders: the sidebar, the ⌘K palette's Navigate
 * group and the dashboard's quick actions.
 *
 * Issue #230. The three surfaces used to answer the question three times. The
 * sidebar checked a permission and module presence, the palette checked only
 * module presence — its item type had no field for a permission, so no amount
 * of data could have gated it — and the quick-action card checked only module
 * presence too. The result was a palette that advertised screens the operator's
 * role cannot open, which Principle XVI item 2 forbids in as many words ("so
 * the palette never advertises a 403").
 *
 * Keeping the predicate here rather than in `AppShell.tsx` is the anti-drift
 * measure: `HomePage` cannot reach into a component module for it, so a copy is
 * what it would otherwise have grown, and a copy is what drifts.
 */

/**
 * A permission code, or a set of codes any one of which suffices.
 *
 * The array form exists because the routes have it: `/api/v1/admin/organizations`
 * is gated by `requireAdminAny(['customers:read', 'customers:manage'])`
 * (`backend/src/modules/organizations/routes.admin.ts:148`). Naming only the
 * first of those in the UI hides the screen from a role that holds the second —
 * the failure mode this issue exists to remove, pointed the other way.
 */
export type PermissionRequirement = string | readonly string[];

/**
 * The gating half of a navigation entry, a palette entry or a quick action.
 * Each surface's own item type carries its label, icon and route on top of it.
 */
export interface GatedSurface {
  /**
   * The module that owns the destination, or `null` for a surface the admin
   * shell owns itself (the dashboard, `/platform/modules`). Feature 073 /
   * FR-031: presence is resolved from the server's effective enabled-set.
   */
  readonly module?: string | null;
  /**
   * The permission the destination's own route enforces — read from the route,
   * never copied from a neighbouring entry. Unset means the destination has no
   * gate beyond being an authenticated admin.
   */
  readonly requiredPermission?: PermissionRequirement;
}

/** Whether `hasPermission` satisfies the requirement (any-of for the array form). */
export function satisfiesPermission(
  requirement: PermissionRequirement | undefined,
  hasPermission: (code: string) => boolean,
): boolean {
  if (requirement === undefined) return true;
  if (typeof requirement === 'string') return hasPermission(requirement);
  // An empty array would mean "no code can satisfy this", which is never what
  // an author means; treat it as ungated rather than silently hiding a screen.
  if (requirement.length === 0) return true;
  return requirement.some((code) => hasPermission(code));
}

/**
 * The full predicate: permission first, then module presence.
 *
 * Both axes **hide** rather than disable. For module presence that was already
 * the rule (feature 073); extending it to permission is a deliberate choice and
 * not merely the cheaper branch — see the comment on `PALETTE_ITEMS` in
 * `AppShell.tsx` for the reasoning and its accessibility consequence.
 */
export function isSurfaceVisible(
  surface: GatedSurface,
  deps: {
    hasPermission: (code: string) => boolean;
    isModulePresent: (moduleId: string) => boolean;
  },
): boolean {
  return (
    satisfiesPermission(surface.requiredPermission, deps.hasPermission) &&
    (surface.module == null || deps.isModulePresent(surface.module))
  );
}

/**
 * Hook form, so the three call sites are one expression each and cannot drift
 * into three slightly different filters again.
 */
export function useSurfaceVisibility(): (surface: GatedSurface) => boolean {
  const { hasPermission } = useAuth();
  const { isPresent } = useModulePresence();
  return useCallback(
    (surface: GatedSurface): boolean =>
      isSurfaceVisible(surface, { hasPermission, isModulePresent: isPresent }),
    [hasPermission, isPresent],
  );
}
