import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import type { ModuleListItem, ModulePresence } from '@b2b/contracts';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';
import { useModulePresence } from '@/lib/module-presence';
import { ModuleActivationControl } from './ModuleActivationControl';
import { listModules } from './api';

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
 */

/** One table row: the platform record plus whatever the projection knows. */
interface ModuleRow {
  item: ModuleListItem;
  presence: ModulePresence | undefined;
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
 * prohibits — `health_checks` is the only module in the position today, and
 * `test/unit/_lifecycle/non-deactivatable-set.test.ts` is where that is pinned,
 * not here.
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

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<ModuleRow[]>(
    () => items.map((item) => ({ item, presence: presenceOf(item.id) })),
    [items, presenceOf],
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
                <ModuleTableRow key={row.item.id} row={row} t={t} onError={setError} />
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
}: {
  row: ModuleRow;
  t: Translate;
  onError: (message: string) => void;
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
