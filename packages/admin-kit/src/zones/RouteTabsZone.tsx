/**
 * A zone rendered as a **tab strip** (feature 091, P4d; Z15's mechanism half).
 *
 * `<AdminZone>` renders a zone's contributions as a stack, which is the common
 * case and covers every member but this one. A strip is different in exactly
 * one way, and it is the way that made `OrderEntryTabs` a host component nobody
 * could publish: **the strip decides whether it exists from how many
 * contributions there are.** One tab is not a choice, so a strip with one tab
 * is worse than no strip — it tells the operator there is somewhere else to go
 * and then does not offer it.
 *
 * `useAdminZone` has already applied both presence axes and each contributor's
 * permission (§4), so counting what it returns is counting the tabs the
 * operator would actually see. That is the whole of *"fewer than two tabs is
 * not a choice"*, expressed as arithmetic over the hook rather than as a module
 * id a host has to know: `admin/src/components/OrderEntryTabs.tsx` used to
 * write the same rule with `orders` and `quick_order` spelled into it.
 *
 * ## Why the minimum is a constant and not a prop
 *
 * Two is a property of *tab strips*, not of this zone: a strip offers a choice
 * between siblings, and a choice needs two. A `minimum` prop would let a host
 * ask for a one-tab strip, which is the thing the rule refuses. If a strip ever
 * genuinely needs a different floor, the answer is a second renderer with its
 * own reason, not a number the caller picks.
 *
 * ## What it delegates, and why that matters
 *
 * The contributions themselves go through `<AdminZone>` — same lazy-component
 * cache, same `ZoneErrorBoundary` per contributor, same `Suspense`, same order.
 * The strip supplies only the chrome. So a contributed tab that throws takes
 * itself out of the strip and leaves the others (Z8), and a strip whose chunks
 * are still in flight renders an empty `tablist` for a moment rather than
 * pushing the host's content around. The **count** is known before any chunk is
 * requested, which is what keeps the "is there a choice at all" decision
 * immediate.
 *
 * A contributed tab renders `RouteTabLink` from `@endora-commerce/admin-kit/ui`;
 * its own doc block records the one thing a contributed tab cannot do that
 * `RouteTabs` can.
 */
import type { ReactNode } from 'react';
import type { AdminZoneName, AdminZoneProps } from '@endora-commerce/contracts';

import { cn } from '../lib/utils.js';
import { AdminZone } from './AdminZone.js';
import { useAdminZone } from './use-admin-zone.js';

/** A strip needs a choice, and a choice needs two. */
const MINIMUM_TABS = 2;

export interface RouteTabsZoneProps<Z extends AdminZoneName> {
  readonly name: Z;
  readonly props: AdminZoneProps<Z>;
  readonly className?: string;
}

/**
 * Render the zone `name` as a tab strip, or nothing at all when fewer than two
 * contributions survive presence and permission.
 *
 * ```tsx
 * <RouteTabsZone name="order.entry.tabs" props={{}} className="mb-4" />
 * ```
 *
 * The name is a **string literal**, always (Z7) — `check:admin-zones` reads
 * this tag beside `<AdminZone>` and reports a computed one rather than skipping
 * it.
 */
export function RouteTabsZone<Z extends AdminZoneName>({
  name,
  props,
  className,
}: RouteTabsZoneProps<Z>): ReactNode {
  const tabs = useAdminZone(name, props);
  if (tabs.length < MINIMUM_TABS) return null;
  return (
    <div className={cn('b2b-tabs-scroll', className)}>
      <div className="b2b-tabs" role="tablist">
        <AdminZone name={name} props={props} />
      </div>
    </div>
  );
}
