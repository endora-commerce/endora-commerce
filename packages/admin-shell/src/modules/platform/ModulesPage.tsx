import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Boxes, ChevronDown, ChevronRight, Lock } from 'lucide-react';
import type {
  ModuleListItem,
  ModulePresence,
  RecentActivityModuleVisibility,
} from '@endora-commerce/contracts';
import { ApiError, useModulePresence } from '@endora-commerce/admin-kit/lib';
import { FilterChip, ListPage, ListToolbar, ListToolbarSearch } from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  EmptyState,
  HelpTip,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { NAV_SECTION_HEADINGS } from '../../components/AppShell.js';
import { useAdminRegistry } from '../../lib/module-registry/index.js';
import { ModuleActivationControl } from './ModuleActivationControl.js';
import { RecentActivityVisibilityControl } from './RecentActivityVisibilityControl.js';
import { listModules, listRecentActivityVisibility } from './api.js';
import {
  activationKindOf,
  filterModuleRows,
  groupModuleRows,
  isPlatformAvailable,
  MODULE_STATUS_FILTERS,
  moduleSectionsOf,
  statusFilterCounts,
  type ActivationKind,
  type ModuleRow,
  type ModuleStatusFilter,
} from './module-list.js';

/**
 * `/platform/modules` — the platform's own view of its modules (feature 073,
 * US5).
 *
 * It composes the two presence axes, which are deliberately never combined
 * anywhere else in this app:
 *
 *  - the **platform axis** from `GET /api/v1/admin/modules` — is this module
 *    installed on this deployment, at which version, with which dependency and
 *    orphan flags. Changing it is deployment work and stays CLI-only;
 *  - the **operator axis** from the effective presence projection — did the
 *    business switch this capability on.
 *
 * Keeping them side by side is the point of the screen: "not installed here",
 * "we turned it off" and "cannot be turned off" have to read differently
 * (Constitution XVII), and each has a different person who can change it.
 *
 * The screen belongs to no module (D-36). Its backing routes are kernel
 * resident, and its sidebar entry carries no `module` attribution — a surface
 * that reports on module presence cannot be gated on module presence without
 * becoming circular.
 *
 * Since feature 080's T042j it carries a **second** per-module operator choice
 * beside activation: whether an eligible module's entries reach the home
 * dashboard's Recent Activity card (D-163.1). It is a different question with a
 * different answer — a client can want stock management and not want stock
 * movements on their home screen — and it is here for the same reason the
 * activation control is: it is the operator's, and this is the surface they
 * already use for per-module choices. It renders only for modules whose
 * manifest declares eligibility, which this app learns from the server and
 * could not hold a list of.
 *
 * Issue #1520 (UX audit 2026-11-17, SHELL-12) reshaped the list without
 * touching either axis: a search box and the On · Off · Not offered · Locked
 * chips (Hick, Choice Overload), the rows grouped under the sidebar section the
 * module's menu entries sit in, a `Switch` per row instead of a filled "Switch
 * on" button on every module that is off (Von Restorff: the screen has no
 * primary at all, because no one action is what it is for), the description
 * and the locked reason behind a row's disclosure instead of printed on every
 * row (signal-to-noise), and the dashboard choice as a second switch column.
 */

/**
 * Re-exported for the tests and callers that read them from the page; the
 * functions live in `module-list.ts`, beside the filters and the grouping.
 */
export { activationKindOf, isPlatformAvailable } from './module-list.js';

const STATE_LABEL_KEY: Record<ModuleListItem['state'], string> = {
  installing: 'platform.modules.state.installing',
  installed: 'platform.modules.state.installed',
  disabled: 'platform.modules.state.disabled',
  uninstalled: 'platform.modules.state.uninstalled',
  'not-installed': 'platform.modules.state.notInstalled',
};

const FLAG_LABEL_KEY: Record<string, string> = {
  orphan: 'platform.modules.flag.orphan',
  'pending-upgrade': 'platform.modules.flag.pendingUpgrade',
  'dep-missing': 'platform.modules.flag.depMissing',
  'dep-disabled': 'platform.modules.flag.depDisabled',
};

const FILTER_LABEL_KEY: Record<ModuleStatusFilter, string> = {
  on: 'platform.modules.filter.on',
  off: 'platform.modules.filter.off',
  'not-offered': 'platform.modules.filter.notOffered',
  locked: 'platform.modules.filter.locked',
};

const OTHER_GROUP_LABEL_KEY = 'platform.modules.group.other';

export function ModulesPage(): ReactNode {
  const t = useTranslation('core');
  const { presenceOf, degraded } = useModulePresence();
  const registry = useAdminRegistry();
  const [items, setItems] = useState<ModuleListItem[]>([]);
  const [activityVisibility, setActivityVisibility] = useState<
    RecentActivityModuleVisibility[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statuses, setStatuses] = useState<ReadonlySet<ModuleStatusFilter>>(() => new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await listModules();
      setItems(res.modules);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * The eligible set, fetched separately and **tolerantly**: a deployment whose
   * `audit_logs` route is unreachable, or an admin without
   * `platform.modules.activate`, gets the module table without the dashboard
   * column rather than an error banner over the screen they came here for.
   */
  const loadActivityVisibility = useCallback(async (): Promise<void> => {
    try {
      const res = await listRecentActivityVisibility();
      setActivityVisibility(res.modules);
    } catch {
      setActivityVisibility([]);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadActivityVisibility();
  }, [load, loadActivityVisibility]);

  const onActivityVisibilityChanged = useCallback(
    (moduleId: string, visible: boolean): void => {
      setActivityVisibility((current) =>
        current.map((entry) => (entry.moduleId === moduleId ? { ...entry, visible } : entry)),
      );
    },
    [],
  );

  const rows = useMemo<ModuleRow[]>(
    () =>
      items.map((item) => ({
        item,
        presence: presenceOf(item.id),
        activityVisible: activityVisibility.find((entry) => entry.moduleId === item.id)?.visible,
      })),
    [activityVisibility, items, presenceOf],
  );

  const sections = useMemo(() => moduleSectionsOf(registry, NAV_SECTION_HEADINGS), [registry]);
  const counts = useMemo(() => statusFilterCounts(rows), [rows]);
  const shown = useMemo(() => filterModuleRows(rows, query, statuses), [query, rows, statuses]);
  const groups = useMemo(
    () => groupModuleRows(shown, sections, NAV_SECTION_HEADINGS, OTHER_GROUP_LABEL_KEY),
    [sections, shown],
  );
  // The column exists only when some module declares eligibility and the admin
  // may read the choice (the list is fetched tolerantly, so it is empty
  // otherwise): an empty column of dashes says nothing.
  const showDashboard = rows.some((row) => row.activityVisible !== undefined);
  const columnCount = showDashboard ? 6 : 5;
  const filtersActive = query.trim() !== '' || statuses.size > 0;

  const clearFilters = useCallback((): void => {
    setQuery('');
    setStatuses(new Set());
  }, []);

  const toggleStatus = useCallback((filter: ModuleStatusFilter, pressed: boolean): void => {
    setStatuses((current) => {
      const next = new Set(current);
      if (pressed) next.add(filter);
      else next.delete(filter);
      return next;
    });
  }, []);

  const toggleExpanded = useCallback((moduleId: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }, []);

  const toolbar = (
    <ListToolbar
      label={t('platform.modules.toolbar')}
      search={
        <ListToolbarSearch
          ref={searchRef}
          label={t('platform.modules.search')}
          value={query}
          onValueChange={setQuery}
        />
      }
      filters={MODULE_STATUS_FILTERS.map((filter) => (
        <FilterChip
          key={filter}
          pressed={statuses.has(filter)}
          onPressedChange={(next) => toggleStatus(filter, next)}
        >
          {t(FILTER_LABEL_KEY[filter], { count: counts[filter] })}
        </FilterChip>
      ))}
      filtersActive={filtersActive}
      onClearFilters={clearFilters}
    />
  );

  const notice =
    degraded || actionError ? (
      <>
        {degraded && (
          <Alert variant="warning">
            <AlertTriangle className="size-4" />
            <AlertDescription>{t('platform.modules.degraded')}</AlertDescription>
          </Alert>
        )}
        {actionError && (
          <Alert variant="destructive">
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        )}
      </>
    ) : null;

  return (
    <ListPage
      title={t('platform.modules.title')}
      help={t('platform.modules.help')}
      toolbar={toolbar}
      count={
        filtersActive
          ? t('platform.modules.countFiltered', { shown: shown.length, total: rows.length })
          : t('platform.modules.count', { count: rows.length })
      }
      notice={notice}
      load={
        loading && items.length === 0
          ? { kind: 'loading' }
          : loadError !== null
            ? { kind: 'error', message: loadError }
            : { kind: 'ready' }
      }
      onRetry={() => void load()}
    >
      {rows.length === 0 ? (
        <EmptyState icon={<Boxes size={20} />} title={t('platform.modules.empty')} />
      ) : shown.length === 0 ? (
        <EmptyState variant="no-results" onClearFilters={clearFilters} focusAfterClear={searchRef} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('platform.modules.column.module')}</TableHead>
              <TableHead>{t('platform.modules.column.platform')}</TableHead>
              <TableHead>{t('platform.modules.column.activation')}</TableHead>
              {showDashboard && (
                <TableHead>
                  <span className="inline-flex items-center gap-1">
                    {t('platform.modules.column.dashboard')}
                    <HelpTip>{t('platform.modules.recentActivity.columnHelp')}</HelpTip>
                  </span>
                </TableHead>
              )}
              <TableHead>{t('platform.modules.column.version')}</TableHead>
              <TableHead>{t('platform.modules.column.flags')}</TableHead>
            </TableRow>
          </TableHeader>
          {groups.map((group) => (
            <TableBody key={group.key} data-module-group={group.key}>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead
                  colSpan={columnCount}
                  scope="colgroup"
                  className="h-8 text-xs font-semibold uppercase tracking-wide"
                >
                  {t(group.labelKey)}
                  <span className="ml-2 font-normal normal-case text-muted-foreground">
                    {group.rows.length}
                  </span>
                </TableHead>
              </TableRow>
              {group.rows.map((row) => (
                <ModuleTableRows
                  key={row.item.id}
                  row={row}
                  t={t}
                  showDashboard={showDashboard}
                  columnCount={columnCount}
                  expanded={expanded.has(row.item.id)}
                  onToggleExpanded={toggleExpanded}
                  onError={setActionError}
                  onActivityVisibilityChanged={onActivityVisibilityChanged}
                />
              ))}
            </TableBody>
          ))}
        </Table>
      )}
    </ListPage>
  );
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The sentence that says why a locked row cannot be switched, or `null` for a switchable one. */
function lockedReasonOf(
  kind: ActivationKind,
  item: ModuleListItem,
  presence: ModulePresence | undefined,
  t: Translate,
): string | null {
  // For a core module the wording is its own declared reason, carried from its
  // manifest — this app holds no list of module ids that may not be switched off
  // (SC-012). The module list carries it in the admin's language (issue #1809);
  // the presence projection's English is the fallback for an older server. For a
  // module that declares no control the wording is the platform's, because there
  // is no manifest sentence to carry (feature 074, FR-016).
  if (kind === 'locked') return item.nonDeactivatableReason ?? presence?.nonDeactivatableReason ?? null;
  if (kind === 'always-on') return t('platform.modules.activation.alwaysOnReason');
  return null;
}

function ModuleTableRows({
  row,
  t,
  showDashboard,
  columnCount,
  expanded,
  onToggleExpanded,
  onError,
  onActivityVisibilityChanged,
}: {
  row: ModuleRow;
  t: Translate;
  showDashboard: boolean;
  columnCount: number;
  expanded: boolean;
  onToggleExpanded: (moduleId: string) => void;
  onError: (message: string) => void;
  onActivityVisibilityChanged: (moduleId: string, visible: boolean) => void;
}): ReactNode {
  const { item, presence } = row;
  const state = presence?.platformState ?? item.state;
  const kind = activationKindOf(presence);
  const available = isPlatformAvailable(row);
  const lockedReason = available ? lockedReasonOf(kind, item, presence, t) : null;
  const detailsId = useId();
  const hasDetails = Boolean(item.description) || item.dependencies.length > 0 || lockedReason !== null;
  const drift =
    item.version.registered !== null &&
    item.version.onDisk !== null &&
    item.version.registered !== item.version.onDisk;

  return (
    <>
      <TableRow data-module-id={item.id}>
        <TableCell>
          <div className="flex items-start gap-1">
            {hasDetails ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="relative -ml-1 size-7 shrink-0 pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-['']"
                aria-expanded={expanded}
                aria-controls={detailsId}
                aria-label={t('platform.modules.details.toggle', { name: item.name })}
                onClick={() => onToggleExpanded(item.id)}
              >
                {expanded ? (
                  <ChevronDown className="size-4" aria-hidden="true" />
                ) : (
                  <ChevronRight className="size-4" aria-hidden="true" />
                )}
              </Button>
            ) : (
              <span className="size-7 shrink-0 -ml-1" aria-hidden="true" />
            )}
            <div className="pt-0.5">
              <div className="font-medium">{item.name}</div>
              <div className="font-mono text-xs text-muted-foreground">{item.id}</div>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <Badge variant={state === 'installed' ? 'success' : 'outline'}>
            {t(STATE_LABEL_KEY[state])}
          </Badge>
        </TableCell>
        <TableCell>
          <ActivationCell
            row={row}
            kind={kind}
            available={available}
            lockedReason={lockedReason}
            t={t}
            onError={onError}
          />
        </TableCell>
        {showDashboard && (
          <TableCell>
            {/* The dashboard-activity choice, for a module that declares
                eligibility. It is offered independently of activation because
                it is a different question — and independently of whether the
                module is currently switched *on*, because switching a module
                off is a pause (Constitution XVII) and the operator's dashboard
                preference has to survive it exactly as their activation choice
                does. It is hidden for a module the deployment does not offer,
                whose state is not the operator's doing at all. */}
            {available && row.activityVisible !== undefined && (
              <RecentActivityVisibilityControl
                moduleId={item.id}
                moduleName={item.name}
                visible={row.activityVisible}
                t={t}
                onChanged={onActivityVisibilityChanged}
                onError={onError}
              />
            )}
          </TableCell>
        )}
        <TableCell className="whitespace-nowrap text-xs">
          {drift ? (
            // The two numbers are data, not copy: they stay outside the
            // translated string so no bundle can drop or reorder them.
            <span className="text-amber-700">
              {item.version.registered} → {item.version.onDisk}
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {t('platform.modules.versionDrift')}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              {item.version.onDisk ?? item.version.registered ?? '—'}
            </span>
          )}
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {item.flags.map((flag) => (
              <Badge key={flag} variant="warning">
                {t(FLAG_LABEL_KEY[flag] ?? flag)}
              </Badge>
            ))}
          </div>
        </TableCell>
      </TableRow>
      {/* Always mounted while the row has details, so the disclosure's
          `aria-controls` names an element; `hidden`, and empty, while
          collapsed, so the locked reason is said once — by the switch. */}
      {hasDetails && (
        <TableRow id={detailsId} hidden={!expanded} data-module-details={item.id} className="hover:bg-transparent">
          <TableCell colSpan={columnCount} className="pb-3 pl-10">
            {expanded && (
            <div className="max-w-prose space-y-1 text-sm text-muted-foreground">
              {item.description && <p>{item.description}</p>}
              {lockedReason !== null && (
                <p className="flex items-start gap-1.5">
                  <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>{lockedReason}</span>
                </p>
              )}
              {item.dependencies.length > 0 && (
                // The ids are data: they stay outside the translated sentence.
                <p>
                  {t('platform.modules.details.dependencies')}{' '}
                  <span className="font-mono text-xs">{item.dependencies.join(', ')}</span>
                </p>
              )}
            </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * The operator axis and its control, in one cell.
 *
 * A module the deployment does not offer renders neither "on" nor "off": that
 * state is not the operator's doing and not theirs to undo, and showing it as
 * switched off would invite them to look for a switch that is not on this
 * screen. Platform availability is deployment work and stays with the CLI.
 */
function ActivationCell({
  row,
  kind,
  available,
  lockedReason,
  t,
  onError,
}: {
  row: ModuleRow;
  kind: ActivationKind;
  available: boolean;
  lockedReason: string | null;
  t: Translate;
  onError: (message: string) => void;
}): ReactNode {
  const { item, presence } = row;
  if (!available || kind === 'unknown' || !presence) {
    // Not offered here, or no projection row for this module: nothing to
    // report, and inventing "off" would be worse than a dash.
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (kind === 'locked' || kind === 'always-on') {
    // T063: the control is present and visibly locked rather than absent. It
    // is on — the effective state forces the operator axis true for a core
    // module, and a module with no declaration has no axis to resolve — so the
    // switch reads on, stays focusable, and carries the reason as its
    // description and tooltip; the lock and the word say it in text.
    return (
      <span className="inline-flex items-center gap-2">
        <Switch
          checked
          onCheckedChange={() => {}}
          disabledReason={lockedReason ?? t('platform.modules.activation.locked')}
          aria-label={t('platform.modules.activation.switchLabel', { name: item.name })}
        />
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          <Lock className="size-3.5" aria-hidden="true" />
          {kind === 'locked'
            ? t('platform.modules.activation.locked')
            : t('platform.modules.activation.alwaysOn')}
        </span>
      </span>
    );
  }
  return (
    <ModuleActivationControl
      moduleId={item.id}
      moduleName={item.name}
      presence={presence}
      t={t}
      onError={onError}
    />
  );
}
