/**
 * The host's end of a **record-tab zone** — the tabs other modules add to a
 * record's tab strip (`specs/183-record-tab-contributions/contracts/record-tab-zone.md`
 * RT3–RT5; FR-004–FR-008).
 *
 * A hook and not a component, because the host needs the contributed tabs in
 * two places of one `RecordTabs`: the items, spliced into its own array where
 * the host decides, and the body of the selected one. The host keeps its own
 * strip, its own tabs and its own `?tab=`; it learns nothing about who
 * contributes.
 *
 * - **`tabs` is synchronous.** It is `selectZoneContributions` — both presence
 *   axes, the permission and `match`, decided before any chunk is touched —
 *   minus the contributions that carry no tab data, whose id the host reserves
 *   or whose id an earlier contribution took. Each drop warns once in
 *   development, naming the module.
 * - **Counts are lazy and keyed on values.** A count module is imported only
 *   for a tab in `tabs`, run once per mount and per change of the zone props'
 *   *values* (an unmemoised props literal does not re-read), aborted when it is
 *   superseded and on unmount. While pending, after a failure, or for an
 *   answer that is not a non-negative integer, the tab has no count.
 * - **`renderPanel(id)`** renders the contributed panel inside the zone's
 *   error boundary, contribution context and `Suspense`, with `section`
 *   chrome — or `null` for an id that is not in `tabs`.
 */
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  AdminZoneProps,
  RecordTabDeclaration,
  RecordTabZoneName,
} from '@endora-commerce/contracts';

import { useTranslationContext } from '../i18n/TranslationProvider.js';
import { useSurfaceVisibility } from '../lib/surface-visibility.js';
import { ZoneContributionContext, type ZoneContributionInfo } from '../save-session/contribution-context.js';
import { EditorSectionChromeProvider } from '../ui/editor-section.js';
import { lazyComponentFor } from './AdminZone.js';
import { useAdminContributions, type OwnedZoneContribution } from './AdminContributionsProvider.js';
import { selectZoneContributions } from './use-admin-zone.js';
import { ZoneErrorBoundary } from './ZoneErrorBoundary.js';

/** One contributed tab, shaped to spread into the kit's `TabItem` (`value: id`). */
export interface RecordTabZoneItem {
  /** The tab's id — the host's `?tab=` value. */
  readonly id: string;
  /** Resolved in the contributing module's bundle. */
  readonly label: string;
  /** `null` while pending, after a failure, or when the tab declares no count. */
  readonly count: number | null;
  /** The accessible name with the count, when the tab declares one and the count is known. */
  readonly countLabel?: string;
  /** The contributing module — the registry entry's key (D-142). */
  readonly module: string;
}

export interface RecordTabZoneOptions {
  /** The host's own tab ids; a contribution claiming one is not drawn (FR-008). */
  readonly reservedIds?: readonly string[];
  /** What a panel shows while its chunk loads — the host's loading line. Default: nothing. */
  readonly fallback?: ReactNode;
}

export interface RecordTabZone {
  readonly tabs: readonly RecordTabZoneItem[];
  /** The panel of contributed tab `id`, or `null` for an id that is not in `tabs`. */
  renderPanel(id: string): ReactNode;
}

type Counter = (props: unknown, signal: AbortSignal) => Promise<number>;

interface VisibleTab {
  readonly contribution: OwnedZoneContribution;
  readonly tab: RecordTabDeclaration;
}

const warned = new Set<string>();

function warnOnce(subject: string, message: string, options: { always?: boolean; cause?: unknown } = {}): void {
  if (!options.always && !import.meta.env.DEV) return;
  if (warned.has(subject)) return;
  warned.add(subject);
  if (options.cause === undefined) console.warn(message);
  else console.warn(message, options.cause);
}

/** The zone props as a value, so two literals with the same values are the same read. */
function propsKeyOf(props: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(
    Object.keys(props)
      .sort()
      .map((key) => [key, props[key]]),
  );
}

/** The contributions that become tabs, in order, minus the ones that may not (FR-008). */
function visibleTabs(
  selected: readonly OwnedZoneContribution[],
  zone: string,
  reserved: ReadonlySet<string>,
): VisibleTab[] {
  const taken = new Map<string, string>();
  const tabs: VisibleTab[] = [];
  for (const contribution of selected) {
    const { tab, module } = contribution;
    if (tab === undefined) {
      warnOnce(
        `untabbed:${zone}:${module}`,
        `[admin-zone] '${module}' contributes to the record-tab zone '${zone}' without tab data; ` +
          'it is not drawn. Declare it with recordTabComponent().',
      );
      continue;
    }
    if (reserved.has(tab.id)) {
      warnOnce(
        `reserved:${zone}:${module}:${tab.id}`,
        `[admin-zone] '${module}' contributes the tab '${tab.id}' to '${zone}', ` +
          'which is one of the host’s own tabs; the host’s tab wins and the contribution is not drawn.',
      );
      continue;
    }
    const earlier = taken.get(tab.id);
    if (earlier !== undefined) {
      warnOnce(
        `duplicate:${zone}:${module}:${tab.id}`,
        `[admin-zone] '${module}' contributes the tab '${tab.id}' to '${zone}', ` +
          `which '${earlier}' already contributes; the earlier one wins and this one is not drawn.`,
      );
      continue;
    }
    taken.set(tab.id, module);
    tabs.push({ contribution, tab });
  }
  return tabs;
}

/**
 * The tabs contributed to the record-tab zone `zone` at this mount, and their
 * panels.
 *
 * ```tsx
 * const contributed = useRecordTabZone('opportunity.detail.tabs', { opportunityId }, {
 *   reservedIds: OPPORTUNITY_TABS.map((tab) => tab.id),
 * });
 * ```
 *
 * The zone name is a **string literal** at every call site (Z7):
 * `check:admin-zones` reads it as the zone's render site.
 */
export function useRecordTabZone<Z extends RecordTabZoneName>(
  zone: Z,
  props: AdminZoneProps<Z>,
  options: RecordTabZoneOptions = {},
): RecordTabZone {
  const contributions = useAdminContributions();
  const isVisible = useSurfaceVisibility();
  const { t } = useTranslationContext();
  const propsRecord = props as unknown as Readonly<Record<string, unknown>>;
  const propsKey = propsKeyOf(propsRecord);
  const reservedKey = JSON.stringify(options.reservedIds ?? []);

  const visible = useMemo(
    () =>
      visibleTabs(
        selectZoneContributions(contributions, zone, propsRecord, isVisible),
        zone,
        new Set(JSON.parse(reservedKey) as string[]),
      ),
    // Keyed on the props' values, not their identity (RT3): a literal written
    // at the call site is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contributions, zone, propsKey, isVisible, reservedKey],
  );

  /** What the counts are counts of: these props and these tabs. A new key is a new read. */
  const readKey = `${propsKey}#${visible.map(({ contribution, tab }) => `${contribution.module}:${tab.id}`).join(',')}`;
  const [counts, setCounts] = useState<{ readonly key: string; readonly values: ReadonlyMap<string, number> }>(
    () => ({ key: '', values: new Map() }),
  );

  useEffect(() => {
    const controller = new AbortController();
    for (const { contribution, tab } of visible) {
      const load = contribution.count;
      if (load === undefined) continue;
      load()
        .then((loaded) => (loaded.default as Counter)(propsRecord, controller.signal))
        .then((value) => {
          if (controller.signal.aborted) return;
          if (!Number.isInteger(value) || value < 0) return;
          setCounts((previous) => {
            const values = new Map(previous.key === readKey ? previous.values : []);
            values.set(tab.id, value);
            return { key: readKey, values };
          });
        })
        .catch((failure: unknown) => {
          if (controller.signal.aborted) return;
          // The tab stays without a count; the page reports nothing (User Story 1, scenario 4).
          warnOnce(
            `count:${zone}:${contribution.module}`,
            `[admin-zone] '${contribution.module}' could not count its tab in '${zone}'; it is shown without a count.`,
            { always: true, cause: failure },
          );
        });
    }
    return (): void => controller.abort();
    // `visible` and the props are what `readKey` is derived from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readKey]);

  const tabs = useMemo(
    () =>
      visible.map(({ contribution, tab }): RecordTabZoneItem => {
        const { module } = contribution;
        const label = t(module, tab.labelKey);
        const count = counts.key === readKey ? (counts.values.get(tab.id) ?? null) : null;
        return {
          id: tab.id,
          label,
          count,
          module,
          ...(tab.countLabelKey !== undefined && count !== null
            ? { countLabel: t(module, tab.countLabelKey, { label, count }) }
            : {}),
        };
      }),
    [visible, counts, readKey, t],
  );

  const fallback = options.fallback ?? null;
  const renderPanel = (id: string): ReactNode => {
    const entry = visible.find((candidate) => candidate.tab.id === id);
    if (entry === undefined) return null;
    const { contribution } = entry;
    const Component = lazyComponentFor(contribution.component);
    const info: ZoneContributionInfo = {
      module: contribution.module,
      zone,
      weight: contribution.weight,
      ...(contribution.requiredPermission === undefined
        ? {}
        : { requiredPermission: contribution.requiredPermission }),
    };
    return (
      <EditorSectionChromeProvider chrome="section">
        <ZoneErrorBoundary key={`${contribution.module}:${id}`} module={contribution.module} zone={zone}>
          <ZoneContributionContext.Provider value={info}>
            <Suspense fallback={fallback}>
              <Component {...(propsRecord as Record<string, unknown>)} />
            </Suspense>
          </ZoneContributionContext.Provider>
        </ZoneErrorBoundary>
      </EditorSectionChromeProvider>
    );
  };

  return { tabs, renderPanel };
}
