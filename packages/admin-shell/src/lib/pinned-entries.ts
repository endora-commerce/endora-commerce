import type { NavItem, NavSection } from '../components/sidebar/nav-types.js';
import { navItemMatchesExactly } from '../components/sidebar/nav-match.js';

/**
 * Feature 164 — pinned sidebar entries, as pure functions
 * (`specs/164-admin-user-preferences/contracts/admin-preferences-client.md` §2.1, §2.3).
 *
 * A pin is a destination string and nothing else. Its label, icon, section and
 * gating are the sidebar entry's own, resolved here from the composed sections
 * with the **same** visibility predicate the sections render with — so a pin
 * cannot be visible when its original is not (FR-006, SC-006), and the palette's
 * pin control, which reads the same map, cannot offer a hidden surface (FR-027).
 */

/** A visible sidebar entry, as both the Pinned section and the palette read it. */
export interface VisibleDestination {
  /** The composed entry's own object — label, icon, gating. */
  item: NavItem;
  /** The section it comes from, for the accessible "from …" description. */
  sectionKey: string;
  /**
   * Every destination of the original row's section — what its `NavLink`'s
   * `end` is computed from, against the current path (`pinMatchesExactly`).
   */
  sectionTargets: readonly string[];
}

export interface ResolvedPin extends VisibleDestination {
  destination: string;
}

/**
 * The `end` flag for a pinned row, at `pathname`: the rule `AppShell`'s section
 * rows apply (`navItemMatchesExactly`), over the original row's section, so a
 * pin lights up exactly when the row it copies does. It is computed per path
 * since issue #1550 — exact only while a more specific sibling is the open
 * screen — where it used to be a flag fixed when the map was built.
 */
export function pinMatchesExactly(destination: VisibleDestination, pathname: string): boolean {
  return navItemMatchesExactly(destination.item.to, destination.sectionTargets, pathname);
}

/** Every visible destination, the first visible entry per `to`, in section order. */
export function visibleDestinations(
  sections: readonly NavSection[],
  isVisible: (item: NavItem) => boolean,
): ReadonlyMap<string, VisibleDestination> {
  const map = new Map<string, VisibleDestination>();
  for (const section of sections) {
    for (const item of section.items) {
      if (map.has(item.to) || !isVisible(item)) continue;
      map.set(item.to, {
        item,
        sectionKey: section.key,
        sectionTargets: section.items.map((other) => other.to),
      });
    }
  }
  return map;
}

/**
 * The pins to render, in the admin's stored order. A destination with no
 * visible entry — permission withdrawn, module off or unavailable, route
 * retired — yields nothing: no placeholder, no count.
 */
export function resolvePinnedEntries(
  pins: readonly string[],
  sections: readonly NavSection[],
  isVisible: (item: NavItem) => boolean,
): ResolvedPin[] {
  return resolvePinsFrom(pins, visibleDestinations(sections, isVisible));
}

/** `resolvePinnedEntries` over a map already built (the one `AppShell` memoises). */
export function resolvePinsFrom(
  pins: readonly string[],
  visible: ReadonlyMap<string, VisibleDestination>,
): ResolvedPin[] {
  const resolved: ResolvedPin[] = [];
  for (const destination of pins) {
    const target = visible.get(destination);
    if (target) resolved.push({ destination, ...target });
  }
  return resolved;
}

/** Append `destination` if it is not pinned yet (FR-007); every other pin is kept in place. */
export function pinDestination(pins: readonly string[], destination: string): string[] {
  return pins.includes(destination) ? [...pins] : [...pins, destination];
}

export function unpinDestination(pins: readonly string[], destination: string): string[] {
  return pins.filter((pin) => pin !== destination);
}

/**
 * Slot-preserving reorder (FR-009): hidden pins keep their absolute positions,
 * and the visible pins are written into the remaining slots in their new order —
 * so a pin hidden today reappears where it was.
 */
export function reorderVisiblePins(
  pins: readonly string[],
  visibleOrder: readonly string[],
): string[] {
  const visible = new Set(visibleOrder);
  const queue = [...visibleOrder];
  return pins.map((pin) => (visible.has(pin) ? (queue.shift() ?? pin) : pin));
}
