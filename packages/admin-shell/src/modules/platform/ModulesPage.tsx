import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import type {
  ModuleListItem,
  ModulePresence,
  RecentActivityModuleVisibility,
} from '@endora-commerce/contracts';
import { ApiError } from '../../lib/api-client.js';
import { Alert, AlertDescription } from '../../components/ui/alert.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { PageHeader } from '../../components/ui/page-header.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { useModulePresence } from '../../lib/module-presence/index.js';
import { ModuleActivationControl } from './ModuleActivationControl.js';
import { RecentActivityVisibilityControl } from './RecentActivityVisibilityControl.js';
import { listModules, listRecentActivityVisibility } from './api.js';

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
 */

/** One table row: the platform record plus whatever the projection knows. */
interface ModuleRow {
  item: ModuleListItem;
  presence: ModulePresence | undefined;
  /** Absent for a module that declares no recent-activity eligibility. */
  activityVisible: boolean | undefined;
}

type ActivationKind = 'on' | 'off' | 'locked' | 'always-on' | 'unknown';

/**
 * Five operator-axis renderings, and the difference between `locked` and
 * `always-on` is the whole reason this is a function rather than a boolean.
 *
 * `deactivatable: false` **with** a reason is a module that declared itself
 * non-deactivatable — the platform's functional base, and the sentence is its
 * own. The same flag **without** one is a module that declares no activation
 * block at all, which since feature 074 means one thing only: it owns no seam
 * either presence axis could close, so there is nothing for a control to do.
 * Both are "you cannot switch this", and both render the locked affordance;
 * the difference is carried by the sentence rather than by a third visual
 * state.
 *
 * The selection is on the **absent declaration**, never on a module id. That is
 * what keeps this from being the hard-coded exception list Constitution XVII
 * prohibits. **No module this repository ships is in that position any more** —
 * `health_checks` was the last and D-229 dissolved it into the platform, and
 * `test/unit/_lifecycle/non-deactivatable-set.test.ts` now pins the class as
 * empty. The branch stays regardless: this app renders whatever presence
 * projection a deployment serves it, and a module package from outside this
 * repository can still arrive with no activation block. A missing branch would
 * render that module as switchable and offer an operator a control that does
 * nothing.
 *
 * `unknown` is the remaining case and is not a decision: the presence
 * projection carried no row for this module, so this app knows nothing about
 * its operator axis and says so with a dash.
 */
export function activationKindOf(presence: ModulePresence | undefined): ActivationKind {
  if (!presence) return 'unknown';
  if (!presence.deactivatable) {
    return presence.nonDeactivatableReason ? 'locked' : 'always-on';
  }
  return presence.activated ? 'on' : 'off';
}

/** Whether the deployment offers this module at all. */
export function isPlatformAvailable(row: ModuleRow): boolean {
  const state = row.presence?.platformState ?? row.item.state;
  return state === 'installed';
}

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

export function ModulesPage(): ReactNode {
  const t = useTranslation('core');
  const { presenceOf, degraded } = useModulePresence();
  const [items, setItems] = useState<ModuleListItem[]>([]);
  const [activityVisibility, setActivityVisibility] = useState<
    RecentActivityModuleVisibility[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await listModules();
      setItems(res.modules);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * The eligible set, fetched separately and **tolerantly**: a deployment whose
   * `audit_logs` route is unreachable, or an admin without
   * `platform.modules.activate`, gets the module table without the dashboard
   * controls rather than an error banner over the screen they came here for.
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

  return (
    <>
      <PageHeader
        title={t('platform.modules.title')}
        description={t('platform.modules.description')}
      />

      {degraded && (
        <Alert variant="warning" className="mb-4">
          <AlertTriangle className="size-4" />
          <AlertDescription>{t('platform.modules.degraded')}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <p className="mb-4 text-sm text-muted-foreground">{t('platform.modules.cliHint')}</p>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('platform.modules.column.module')}</TableHead>
                <TableHead>{t('platform.modules.column.platform')}</TableHead>
                <TableHead>{t('platform.modules.column.activation')}</TableHead>
                <TableHead>{t('platform.modules.column.version')}</TableHead>
                <TableHead>{t('platform.modules.column.flags')}</TableHead>
                <TableHead className="text-right">
                  {t('platform.modules.column.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <ModuleTableRow
                  key={row.item.id}
                  row={row}
                  t={t}
                  onError={setError}
                  onActivityVisibilityChanged={onActivityVisibilityChanged}
                />
              ))}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">
                    {t('platform.modules.empty')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

function ModuleTableRow({
  row,
  t,
  onError,
  onActivityVisibilityChanged,
}: {
  row: ModuleRow;
  t: Translate;
  onError: (message: string) => void;
  onActivityVisibilityChanged: (moduleId: string, visible: boolean) => void;
}): ReactNode {
  const { item, presence } = row;
  const state = presence?.platformState ?? item.state;
  const kind = activationKindOf(presence);
  const available = isPlatformAvailable(row);
  const drift =
    item.version.registered !== null &&
    item.version.onDisk !== null &&
    item.version.registered !== item.version.onDisk;

  return (
    <TableRow data-module-id={item.id}>
      <TableCell>
        <div className="font-medium">{item.name}</div>
        <div className="text-xs text-muted-foreground">{item.id}</div>
        {item.description && (
          <div className="mt-1 max-w-prose text-xs text-muted-foreground">
            {item.description}
          </div>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={state === 'installed' ? 'success' : 'outline'}>
          {t(STATE_LABEL_KEY[state])}
        </Badge>
      </TableCell>
      <TableCell>
        <ActivationCell kind={kind} available={available} t={t} />
      </TableCell>
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
      <TableCell className="text-right">
        {/* The dashboard-activity choice, for a module that declares
            eligibility. It is offered independently of the activation control
            because it is a different question — and independently of whether
            the module is currently switched *on*, because switching a module
            off is a pause (Constitution XVII) and the operator's dashboard
            preference has to survive it exactly as their activation choice
            does. It is hidden for a module the deployment does not offer, whose
            state is not the operator's doing at all. */}
        {available && row.activityVisible !== undefined && (
          <div className="mb-1">
            <RecentActivityVisibilityControl
              moduleId={item.id}
              moduleName={item.name}
              visible={row.activityVisible}
              t={t}
              onChanged={onActivityVisibilityChanged}
              onError={onError}
            />
          </div>
        )}
        {/* Only the operator axis is actionable here. Platform availability is
            deployment work and stays with the CLI, and a module that declared
            no control has nothing to flip. */}
        {available && presence && (kind === 'on' || kind === 'off') && (
          <ModuleActivationControl
            moduleId={item.id}
            moduleName={item.name}
            presence={presence}
            t={t}
            onError={onError}
          />
        )}
        {available && (kind === 'locked' || kind === 'always-on') && (
          // T063: the control is present and visibly locked rather than absent,
          // so the answer to "why can I not switch this off" is on screen. For a
          // core module the wording is its own declared reason, carried by the
          // projection from its manifest — this app holds no list of module ids
          // that may not be switched off (SC-012). For a module that declares no
          // control the wording is the platform's, because there is no manifest
          // sentence to carry: what it says is that the module's only surface is
          // never gated, so neither axis has anything to close (feature 074,
          // FR-016).
          <div className="flex flex-col items-end gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled
              title={
                kind === 'locked'
                  ? (presence?.nonDeactivatableReason ?? undefined)
                  : t('platform.modules.activation.alwaysOnReason')
              }
            >
              <Lock className="mr-1 size-3.5" aria-hidden="true" />
              {kind === 'locked'
                ? t('platform.modules.activation.locked')
                : t('platform.modules.activation.alwaysOn')}
            </Button>
            <p className="max-w-prose text-right text-xs text-muted-foreground">
              {kind === 'locked'
                ? presence?.nonDeactivatableReason
                : t('platform.modules.activation.alwaysOnReason')}
            </p>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

/**
 * The operator axis. A module the deployment does not offer renders neither
 * "on" nor "off": that state is not the operator's doing and not theirs to
 * undo, and showing it as switched off would invite them to look for a switch
 * that is not on this screen.
 */
function ActivationCell({
  kind,
  available,
  t,
}: {
  kind: ActivationKind;
  available: boolean;
  t: Translate;
}): ReactNode {
  if (!available) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (kind === 'locked' || kind === 'always-on') {
    // Neither can be switched off, and both are on and stay on — the effective
    // state forces the operator axis true for a core module, and a module with
    // no declaration has no axis to resolve. So the state column says "on" like
    // any other, and the *control* is where the lock and its sentence live.
    return <Badge variant="success">{t('platform.modules.activation.on')}</Badge>;
  }
  if (kind === 'unknown') {
    // No projection row for this module: nothing to report, and inventing "off"
    // would be worse than a dash.
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <Badge variant={kind === 'on' ? 'success' : 'secondary'}>
      {kind === 'on'
        ? t('platform.modules.activation.on')
        : t('platform.modules.activation.off')}
    </Badge>
  );
}
