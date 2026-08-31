/**
 * The common case: render every contribution to this mount, in order (feature
 * 091, P4a; Z6/Z8).
 *
 * `useAdminZone` is the primitive and stays exported, because a host whose zone
 * is not a stack of components needs the list rather than the rendering — a tab
 * strip counts its contributions, and `<RouteTabsZone>` is built on the hook,
 * not on this.
 *
 * Generic on the literal zone name, so `props` is checked against
 * `AdminZonePropsMap` at the host's end (Z3). That is one of the two ends the
 * map holds; the contributor's is `zoneComponent()` on `./contributions`.
 */
import { Suspense, lazy, useMemo, type ComponentType, type ReactNode } from 'react';
import type {
  AdminComponentFactory,
  AdminZoneName,
  AdminZoneProps,
} from '@endora-commerce/contracts';

import { useAdminZone } from './use-admin-zone.js';
import { ZoneErrorBoundary } from './ZoneErrorBoundary.js';

/**
 * One lazy component per factory, for the life of the page.
 *
 * Keyed on the **factory**, not on the mount: a zone's props object is written
 * as a literal at the call site and so has a new identity every render, and
 * memoising on it would build a new component type each time and remount the
 * contribution underneath the operator, losing any state it holds. The factory
 * is a field of a declaration the registry built once, so it is stable for as
 * long as the registry is — which is what makes a `WeakMap` the right lifetime
 * here rather than a `useMemo`.
 */
type ZoneComponentType = ComponentType<Record<string, unknown>>;

const lazyByFactory = new WeakMap<AdminComponentFactory, ZoneComponentType>();

function lazyComponentFor(load: AdminComponentFactory): ZoneComponentType {
  const known = lazyByFactory.get(load);
  if (known !== undefined) return known;
  // The registry's factory is `{ default: unknown }` by construction — see the
  // note on `AdminComponentFactory` — and the assertion here is the courier's
  // end of the map, not a hole: `zoneComponent()` constrained the contributor's
  // export and this component's generic constrains the host's props against the
  // same `AdminZonePropsMap`.
  const built = lazy(async () => ({
    default: (await load()).default as ZoneComponentType,
  }));
  lazyByFactory.set(load, built);
  return built;
}

export interface AdminZoneRenderProps<Z extends AdminZoneName> {
  readonly name: Z;
  readonly props: AdminZoneProps<Z>;
}

/**
 * Render the zone `name` at this mount.
 *
 * ```tsx
 * <AdminZone name="product.editor.field.after" props={{ productId, fieldPath: 'name', languageCodes: LOCALES }} />
 * ```
 *
 * The name is a **string literal**, always (Z7).
 */
export function AdminZone<Z extends AdminZoneName>({
  name,
  props,
}: AdminZoneRenderProps<Z>): ReactNode {
  const contributions = useAdminZone(name, props);
  // One entry per contribution, so a contributor added or removed by a presence
  // flip does not rebuild the others' component types.
  const rendered = useMemo(
    () =>
      contributions.map((contribution, index) => ({
        // A module may declare two contributions to one zone, so the key is
        // the module **and** its position in the ordered list, never the module
        // alone: two children under one key is a silent remount in React.
        key: `${contribution.module}:${index}`,
        module: contribution.module,
        Component: lazyComponentFor(contribution.component),
      })),
    [contributions],
  );
  if (rendered.length === 0) return null;
  return (
    <>
      {rendered.map(({ key, module, Component }) => (
        <ZoneErrorBoundary key={key} module={module} zone={name}>
          {/* `null`, not a spinner: a contribution is an addition, and a chunk
              still in flight must not push the host's own content around or
              block it. */}
          <Suspense fallback={null}>
            <Component {...(props as unknown as Record<string, unknown>)} />
          </Suspense>
        </ZoneErrorBoundary>
      ))}
    </>
  );
}
