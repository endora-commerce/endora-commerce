import type { LucideIcon } from 'lucide-react';
import type { GatedSurface, PermissionRequirement } from '@endora-commerce/admin-kit/lib';

/**
 * The sidebar's entry and section shapes, shared by `AppShell` and the Pinned
 * section (feature 164) — the pin helpers in `lib/pinned-entries.ts` name them.
 */

export interface NavItem extends GatedSurface {
  to: string;
  /**
   * Translation key under the `core` scope. Resolved at render time so
   * the label flips when the admin changes preferred language.
   */
  labelKey: string;
  /**
   * The i18n scope `labelKey` resolves in. Absent means `'core'`, the shared
   * bundle every host entry's key lives in.
   *
   * A module-contributed entry (feature 091) carries its own module id here:
   * its `labelKey` is module-relative (`nav.importExport.label`) and its
   * translations ship in the module's own `i18n/` directory, which is what
   * takes a new module's sidebar label out of the shared `_i18n` bundle — one
   * of the four shared files 11 of the last 12 module additions had to edit.
   */
  labelScope?: string;
  icon: LucideIcon;
  /**
   * The permission code (or any-of set) that gates the entry's visibility, read
   * from the **route that gates the destination** rather than copied from the
   * entry above it. When unset, the entry renders for every authenticated admin
   * because the destination genuinely has no gate. When set, the entry is hidden
   * unless `useAuth().hasPermission(code)` returns true (the wildcard `*`
   * permission held by `platform_admin` satisfies every code).
   *
   * Issue #230 filled the gaps this comment used to record as an open count:
   * `/orders` (`orders:read`) and `/quote-requests` (`rfqs:handle`) were both
   * advertised to roles that would collect a 403 on arrival.
   */
  requiredPermission?: PermissionRequirement;
  /**
   * The module that owns this destination, or `null` for a surface the admin
   * shell owns itself (the dashboard). Feature 073 / FR-031: the sidebar is
   * resolved from the server's effective enabled-set, and permission is not a
   * proxy for module ownership — the two axes are filtered separately by
   * `isSurfaceVisible`. Explicit attribution is what keeps a new entry from
   * being silently unfiltered.
   */
  module: string | null;
}

export interface NavSection {
  /** Stable key — the group's collapse key in `sidebarCollapsedGroups`. */
  key: string;
  /**
   * Translation key under the `core` scope for the section heading.
   * Empty string = no group label (rendered flat).
   */
  labelKey: string;
  items: NavItem[];
}
