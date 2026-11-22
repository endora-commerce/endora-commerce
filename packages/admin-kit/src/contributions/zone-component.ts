/**
 * The contributor's end of a zone's props contract (feature 091, P4a; Z3).
 *
 * A zone's props are declared once, in `AdminZonePropsMap`, and checked by
 * `tsc` at **both** ends and by nothing at runtime. This file is the
 * contributor's end: it turns the module's own `() => import('./Whatever.js')`
 * into a factory whose module's default export is constrained to
 * `ComponentType<AdminZoneProps<Z>>` for the zone the contribution names.
 *
 * Without it a contributor has no compile-time relationship to the props at
 * all: `AdminComponentFactory` resolves to `{ default: unknown }` deliberately,
 * because `@endora-commerce/contracts` compiles in the backend and may acquire
 * no React dependency. The `unknown` in the middle is not a hole — it is the
 * courier between two ends checked against the same map — but it is only not a
 * hole while the contributor's end is checked, and this is what checks it.
 *
 * It carries **no runtime behaviour**: the returned object is the declaration
 * the module would have written by hand, with the factory passed through
 * unchanged. `React.lazy` is the renderer's, and it is reached only after the
 * renderer has decided presence, permission and `match` (FR-013).
 */
import type {
  AdminZoneContribution,
  AdminZoneName,
  AdminZoneProps,
  PermissionRequirement,
  RecordTabDeclaration,
  RecordTabZoneName,
} from '@endora-commerce/contracts';
import type { ComponentType } from 'react';

/**
 * What a module's zone component must be, for the zone it contributes to.
 *
 * Exported in its own right because a contributor that keeps its component in
 * a separate file wants to annotate that file's export, which is where a
 * mismatch is cheapest to read.
 */
export type AdminZoneComponent<Z extends AdminZoneName> = ComponentType<AdminZoneProps<Z>>;

/** Everything a contribution declares beyond its zone and its component. */
export interface ZoneComponentOptions {
  /**
   * Order within the zone. Ties are broken by module id, so the order is a
   * function of the declarations and never of the registry's walk order.
   *
   * Defaults to `0`: a contributor with no opinion should not have to invent
   * one, and every contributor with no opinion then sorts by module id.
   */
  readonly weight?: number;
  /** The permission the contributed surface needs, if it needs one. */
  readonly requiredPermission?: PermissionRequirement;
  /**
   * Narrow this contribution to the mounts whose props agree — see
   * `AdminZoneContributionSchema`'s `match`.
   *
   * Typed as the zone's own props, partially and by value, so a key the zone
   * does not carry is a compile error here rather than a contribution that
   * silently matches nothing.
   */
  readonly match?: {
    readonly [K in keyof AdminZoneProps<AdminZoneName> & string]?: string | readonly string[];
  } & Readonly<Record<string, string | readonly string[]>>;
}

/**
 * Every zone whose contributions are panels of a stack — every member except a
 * record-tab zone, whose contributions are whole tabs and are declared with
 * {@link recordTabComponent} (`specs/183-record-tab-contributions/` R3).
 */
export type StackZoneName = Exclude<AdminZoneName, RecordTabZoneName>;

/**
 * Declare a contribution to `zone`, with its component type-checked against
 * that zone's props.
 *
 * A record-tab zone is refused at compile time: its contributions need tab
 * data, which this helper does not take.
 *
 * ```ts
 * zoneComponent('product.editor.field.after', () => import('./FieldProtection.js'), {
 *   weight: 10,
 *   requiredPermission: 'catalog:write',
 * })
 * ```
 */
export function zoneComponent<Z extends StackZoneName>(
  zone: Z,
  load: () => Promise<{ readonly default: AdminZoneComponent<Z> }>,
  options: ZoneComponentOptions = {},
): AdminZoneContribution {
  // `exactOptionalPropertyTypes` is on, so an absent option is an absent
  // property rather than an explicit `undefined` — the distinction the flag
  // exists for, and the reason these are spreads and not fields.
  return {
    zone,
    weight: options.weight ?? 0,
    ...(options.requiredPermission === undefined
      ? {}
      : { requiredPermission: options.requiredPermission }),
    ...(options.match === undefined ? {} : { match: options.match }),
    component: load,
  };
}

/**
 * A record tab's count loader, for the zone it contributes to: called with the
 * zone's props and a signal the renderer aborts when the read is superseded or
 * the host unmounts. It calls only the contributor's own API, honours
 * `signal`, and resolves to a non-negative integer or rejects
 * (`specs/183-record-tab-contributions/contracts/record-tab-zone.md` RT2).
 */
export type RecordTabCounter<Z extends AdminZoneName> = (
  props: AdminZoneProps<Z>,
  signal: AbortSignal,
) => Promise<number>;

/** Everything a record tab declares beyond its zone and its panel. */
export interface RecordTabComponentOptions<Z extends RecordTabZoneName> extends ZoneComponentOptions {
  /** The tab's id (part of `?tab=`), and its label keys in the contributor's own bundle. */
  readonly tab: RecordTabDeclaration;
  /**
   * The tab's count, as its own chunk: imported only for a tab the reader can
   * see, and run once per mount and per change of the zone props. Omitted, the
   * tab shows no count.
   */
  readonly count?: () => Promise<{ readonly default: RecordTabCounter<Z> }>;
}

/**
 * Declare a whole tab of a host's record tab strip, with its panel and its
 * count loader type-checked against the zone's props.
 *
 * ```ts
 * recordTabComponent('opportunity.detail.tabs', () => import('./zones/OpportunityTasksTab.js'), {
 *   tab: { id: 'tasks', labelKey: 'recordTab.label', countLabelKey: 'recordTab.countLabel' },
 *   count: () => import('./zones/opportunity-task-count.js'),
 *   weight: 100,
 *   requiredPermission: 'tasks:read',
 * })
 * ```
 *
 * Only a record-tab zone is accepted — a stack zone is a compile error — and,
 * like {@link zoneComponent}, it carries no runtime behaviour: the factories
 * pass through untouched.
 */
export function recordTabComponent<Z extends RecordTabZoneName>(
  zone: Z,
  load: () => Promise<{ readonly default: AdminZoneComponent<Z> }>,
  options: RecordTabComponentOptions<Z>,
): AdminZoneContribution {
  return {
    zone,
    weight: options.weight ?? 0,
    ...(options.requiredPermission === undefined
      ? {}
      : { requiredPermission: options.requiredPermission }),
    ...(options.match === undefined ? {} : { match: options.match }),
    tab: options.tab,
    ...(options.count === undefined ? {} : { count: options.count }),
    component: load,
  };
}
