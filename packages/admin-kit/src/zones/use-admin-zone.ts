/**
 * The zone primitive — the visible, matched, ordered contributions for one
 * place (feature 091, P4a; Z4/Z5, §4).
 *
 * ## Where the presence filter goes, and why it is here
 *
 * **The registry does not filter. This does, at enumeration.** That is
 * D-67/D-68's boot-hook rule pointed at the frontend and the rule
 * `admin/src/lib/module-registry/index.ts` already states for routes and nav:
 * an operator's activation flip must take effect without a rebuild, so the
 * registry answers *"what could be here"* and the enumeration answers *"what is
 * here for this operator right now"*.
 *
 * ## The order the four steps run in is the design
 *
 *   1. the contributions whose `zone` is this one;
 *   2. minus those whose `match` disagrees with the mount's props;
 *   3. minus those `isSurfaceVisible({ module, requiredPermission })` rejects —
 *      the one predicate (FR-012), now with a fourth caller and still no second
 *      copy;
 *   4. sorted by `weight`, then module id.
 *
 * Steps 2 and 3 are decided **before** `React.lazy` is touched, which is FR-013
 * and not tidiness: a contributor that narrowed itself by returning `null`
 * would have its chunk fetched and evaluated on every screen the zone is
 * mounted on, and FR-013 says a module's admin page code must not be downloaded
 * by a browser that cannot reach it.
 *
 * `module` is the registry entry's key and never a declared field (D-142), so a
 * module cannot contribute under another module's presence.
 */
import { useMemo } from 'react';
import type { AdminZoneName, AdminZoneProps } from '@endora-commerce/contracts';

import { useSurfaceVisibility, type GatedSurface } from '../lib/surface-visibility.js';
import { useAdminContributions, type OwnedZoneContribution } from './AdminContributionsProvider.js';

/**
 * Whether every key of `match` agrees with the mount's props.
 *
 * A contribution with no `match` matches every mount. A key the props do not
 * carry never agrees — the fail-closed direction: a `match` naming a prop that
 * does not exist hides the contribution, where the other answer would widen it
 * silently.
 *
 * Comparison is by string value, so a non-string prop (`languageCodes`, an
 * array) is not matchable and a `match` naming it hides the contribution. That
 * is deliberate rather than a limit worked around: `match` is declarative data
 * a check has to be able to read, and a structural comparison is not.
 *
 * Exported so a test can drive the predicate directly — the classification is
 * what `match` is, and a test that reached it only through a rendered React
 * tree would be asserting the renderer instead.
 */
export function matchesZoneProps(
  match: Readonly<Record<string, string | readonly string[]>> | undefined,
  props: Readonly<Record<string, unknown>>,
): boolean {
  if (match === undefined) return true;
  for (const [key, wanted] of Object.entries(match)) {
    const value = props[key];
    if (typeof value !== 'string') return false;
    if (typeof wanted === 'string') {
      if (wanted !== value) return false;
      continue;
    }
    if (!wanted.includes(value)) return false;
  }
  return true;
}

/** The four steps, as a pure function of the registry, the props and the predicate. */
export function selectZoneContributions(
  contributions: readonly OwnedZoneContribution[],
  zone: string,
  props: Readonly<Record<string, unknown>>,
  isVisible: (surface: GatedSurface) => boolean,
): readonly OwnedZoneContribution[] {
  return contributions
    .filter((contribution) => contribution.zone === zone)
    .filter((contribution) => matchesZoneProps(contribution.match, props))
    .filter((contribution) =>
      isVisible({
        module: contribution.module,
        // `exactOptionalPropertyTypes` is on: an absent requirement is an
        // absent property, not an explicit `undefined`.
        ...(contribution.requiredPermission === undefined
          ? {}
          : { requiredPermission: contribution.requiredPermission }),
      }),
    )
    .sort(
      (left, right) =>
        left.weight - right.weight || left.module.localeCompare(right.module),
    );
}

/**
 * The contributions to render at this mount of `zone`, in order.
 *
 * The zone name is a **string literal** at every call site (Z7): the two-way
 * refusal in `check:admin-zones` compares rendered names to declared ones, and
 * a name it cannot read is a zone it would report as rendered by nobody.
 */
export function useAdminZone<Z extends AdminZoneName>(
  zone: Z,
  props: AdminZoneProps<Z>,
): readonly OwnedZoneContribution[] {
  const contributions = useAdminContributions();
  const isVisible = useSurfaceVisibility();
  return useMemo(
    () =>
      selectZoneContributions(
        contributions,
        zone,
        props as unknown as Readonly<Record<string, unknown>>,
        isVisible,
      ),
    [contributions, zone, props, isVisible],
  );
}
