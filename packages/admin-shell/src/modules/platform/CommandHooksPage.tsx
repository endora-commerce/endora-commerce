import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  COMMAND_OUTBOX_LISTED_STATUSES,
  type CommandHookPlanAction,
  type CommandHookPlanItem,
  type CommandHookPlanResponse,
  type CommandOutboxListItem,
} from '@endora-commerce/contracts';
import { ApiError, formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  PageHeader,
  RouteTabs,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import {
  COMMAND_OUTBOX_MANAGE,
  COMMAND_OUTBOX_READ,
  failureLabel,
  getCommandHookPlan,
  listCommandOutbox,
  retryCommandOutboxEntry,
} from './command-hooks-api.js';

/**
 * `/platform/command-hooks` — which modules run inside or after another
 * module's write, and the deliveries that need an operator
 * (`specs/176-command-hooks-outbox/` US4, FR-041).
 *
 * Kernel-served, like `/platform/modules`: a hook spans the module that
 * declares an action and every module that hooks it, so no one module's
 * presence may decide whether the screen is there. Two tabs, two codes — the
 * execution plan behind `platform.modules.read` (the screen's own, and the
 * palette's), the outbox behind `platform.command_outbox.read`, with the retry
 * control offered only to a holder of `platform.command_outbox.manage`.
 *
 * **The plan does not suggest a sequence it does not have.** `beforeCommit`
 * hooks run in order inside the write's transaction, so they are an ordered
 * list; `afterCommit` handlers are each an outbox row delivered on its own, so
 * they are an unordered list with no position.
 *
 * **The outbox shows names, ids and codes only** — the API serves nothing else
 * and stored nothing else. A failure is its code, translated when the hook
 * module or the platform has a sentence for it and shown raw otherwise.
 */

type Tab = 'plan' | 'outbox';
type ListedStatus = (typeof COMMAND_OUTBOX_LISTED_STATUSES)[number];
type Translate = (key: string, params?: Record<string, string | number>) => string;

const PLAN_PATH = '/platform/command-hooks';
const OUTBOX_PATH = '/platform/command-hooks/outbox';

const STATUS_LABEL_KEY: Record<ListedStatus, string> = {
  dead: 'platform.commandHooks.outbox.status.dead',
  pending: 'platform.commandHooks.outbox.status.pending',
  in_flight: 'platform.commandHooks.outbox.status.inFlight',
};

const EMPTY_KEY: Record<ListedStatus, string> = {
  dead: 'platform.commandHooks.outbox.empty.dead',
  pending: 'platform.commandHooks.outbox.empty.pending',
  in_flight: 'platform.commandHooks.outbox.empty.inFlight',
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : String(err);
}

export function CommandHooksPage({ tab }: { tab: Tab }): ReactNode {
  const t = useTranslation('core');
  const { hasPermission } = useAuth();
  const canReadOutbox = hasPermission(COMMAND_OUTBOX_READ);

  const tabs = useMemo(
    () => [
      { to: PLAN_PATH, label: t('platform.commandHooks.tab.plan') },
      ...(canReadOutbox ? [{ to: OUTBOX_PATH, label: t('platform.commandHooks.tab.outbox') }] : []),
    ],
    [canReadOutbox, t],
  );

  return (
    <>
      <PageHeader title={t('platform.commandHooks.title')} description={t('platform.commandHooks.description')} />
      <RouteTabs tabs={tabs} className="mb-4" />
      {tab === 'plan' ? (
        <ExecutionPlan t={t} />
      ) : canReadOutbox ? (
        <Outbox t={t} canManage={hasPermission(COMMAND_OUTBOX_MANAGE)} />
      ) : (
        <Alert variant="warning">
          <AlertDescription>{t('platform.commandHooks.outbox.forbidden')}</AlertDescription>
        </Alert>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Execution plan
// ---------------------------------------------------------------------------

function ExecutionPlan({ t }: { t: Translate }): ReactNode {
  const [plan, setPlan] = useState<CommandHookPlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCommandHookPlan()
      .then((response) => {
        if (!cancelled) setPlan(response);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!plan) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {t('platform.commandHooks.plan.loading')}
      </p>
    );
  }
  if (plan.actions.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">{t('platform.commandHooks.plan.empty')}</CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {plan.actions.map((action) => (
        <ActionPlan
          key={action.action}
          action={action}
          items={plan.items.filter((item) => item.action === action.action)}
          t={t}
        />
      ))}
    </div>
  );
}

function ActionPlan({
  action,
  items,
  t,
}: {
  action: CommandHookPlanAction;
  items: readonly CommandHookPlanItem[];
  t: Translate;
}): ReactNode {
  const headingId = useId();
  const before = items.filter((item) => item.phase === 'beforeCommit');
  const after = items.filter((item) => item.phase === 'afterCommit');

  return (
    <Card>
      <section aria-labelledby={headingId}>
        <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2 space-y-0">
          <CardTitle>
            <h2 id={headingId} className="font-mono text-base">
              {action.action}
            </h2>
          </CardTitle>
          <span className="text-sm text-muted-foreground">
            {t('platform.commandHooks.plan.owner', { module: action.owner })}
          </span>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          {action.phases.includes('beforeCommit') && (
            <PhaseHooks
              ordered
              items={before}
              title={t('platform.commandHooks.plan.beforeCommit.title')}
              hint={t('platform.commandHooks.plan.beforeCommit.hint')}
              t={t}
            />
          )}
          {action.phases.includes('afterCommit') && (
            <PhaseHooks
              ordered={false}
              items={after}
              title={t('platform.commandHooks.plan.afterCommit.title')}
              hint={t('platform.commandHooks.plan.afterCommit.hint')}
              t={t}
            />
          )}
        </CardContent>
      </section>
    </Card>
  );
}

function PhaseHooks({
  ordered,
  items,
  title,
  hint,
  t,
}: {
  ordered: boolean;
  items: readonly CommandHookPlanItem[];
  title: string;
  hint: string;
  t: Translate;
}): ReactNode {
  const titleId = useId();
  const List = ordered ? 'ol' : 'ul';

  return (
    <div>
      <h3 id={titleId} className="text-sm font-medium">
        {title}
      </h3>
      <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('platform.commandHooks.plan.noHooks')}</p>
      ) : (
        <List
          aria-labelledby={titleId}
          className={ordered ? 'list-decimal space-y-1 pl-6 text-sm' : 'list-disc space-y-1 pl-6 text-sm'}
        >
          {items.map((item) => (
            <li key={`${item.module}#${item.id}`} data-hook={`${item.module}#${item.id}`}>
              <span className="font-mono">{item.module}</span>
              <span className="text-muted-foreground"> · </span>
              <span className="font-mono">{item.id}</span>{' '}
              <Badge variant={item.moduleEnabled ? 'success' : 'secondary'}>
                {item.moduleEnabled ? t('platform.commandHooks.module.on') : t('platform.commandHooks.module.off')}
              </Badge>
            </li>
          ))}
        </List>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

function Outbox({ t, canManage }: { t: Translate; canManage: boolean }): ReactNode {
  const { bundle, fallbackBundle } = useTranslationContext();
  const statusId = useId();
  const [status, setStatus] = useState<ListedStatus>('dead');
  const [items, setItems] = useState<CommandOutboxListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setItems([]);
    setNextCursor(null);
    setError(null);
    listCommandOutbox({ status })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (nextCursor === null) return;
    setLoadingMore(true);
    try {
      const page = await listCommandOutbox({ status, cursor: nextCursor });
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, status]);

  const retry = useCallback(
    async (id: string): Promise<void> => {
      setRetrying(id);
      setNotice(null);
      setError(null);
      try {
        await retryCommandOutboxEntry(id);
        // The row is pending now: it leaves the list of the status it was in.
        setItems((current) => current.filter((item) => item.id !== id));
        setNotice(t('platform.commandHooks.outbox.retried'));
      } catch (err) {
        setError(errorText(err));
      } finally {
        setRetrying(null);
      }
    },
    [t],
  );

  const failureOf = (item: CommandOutboxListItem): string | null =>
    item.lastErrorCode === null ? null : failureLabel(item.lastErrorCode, item.hookModule, bundle, fallbackBundle);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('platform.commandHooks.outbox.hint')}</p>

      <div className="flex max-w-xs flex-col gap-1">
        <Label htmlFor={statusId}>{t('platform.commandHooks.outbox.status.label')}</Label>
        <Select id={statusId} value={status} onChange={(event) => setStatus(event.target.value as ListedStatus)}>
          {COMMAND_OUTBOX_LISTED_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(STATUS_LABEL_KEY[value])}
            </option>
          ))}
        </Select>
      </div>

      {/* One live region, mounted before it has text (WCAG 4.1.3): the loading
          message and a retry's outcome are both announced from here. */}
      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {loading ? t('platform.commandHooks.outbox.loading') : notice}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? null : items.length === 0 ? (
        error ? null : (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">{t(EMPTY_KEY[status])}</CardContent>
          </Card>
        )
      ) : (
        <Card>
          <CardContent className="overflow-x-auto pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('platform.commandHooks.outbox.column.action')}</TableHead>
                  <TableHead>{t('platform.commandHooks.outbox.column.object')}</TableHead>
                  <TableHead>{t('platform.commandHooks.outbox.column.handler')}</TableHead>
                  <TableHead className="text-right">{t('platform.commandHooks.outbox.column.attempts')}</TableHead>
                  <TableHead>{t('platform.commandHooks.outbox.column.failure')}</TableHead>
                  <TableHead>{t('platform.commandHooks.outbox.column.created')}</TableHead>
                  <TableHead>
                    {status === 'dead'
                      ? t('platform.commandHooks.outbox.column.deadAt')
                      : t('platform.commandHooks.outbox.column.availableAt')}
                  </TableHead>
                  {canManage && status === 'dead' && (
                    <TableHead className="text-right">{t('platform.commandHooks.outbox.column.actions')}</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const label = failureOf(item);
                  const handler = `${item.hookModule}#${item.hookId}`;
                  return (
                    <TableRow key={item.id} data-outbox-id={item.id}>
                      <TableCell className="font-mono text-xs">{item.action}</TableCell>
                      <TableCell className="text-xs">
                        <div>{item.objectType}</div>
                        <div className="font-mono text-muted-foreground">{item.objectId}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="font-mono">{item.hookModule}</div>
                        <div className="font-mono text-muted-foreground">{item.hookId}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{item.attempts}</TableCell>
                      <TableCell className="max-w-xs text-xs">
                        {item.lastErrorCode === null ? (
                          <span className="text-muted-foreground">{t('platform.commandHooks.outbox.noFailure')}</span>
                        ) : (
                          <>
                            {label !== null && <div>{label}</div>}
                            <code className="font-mono">{item.lastErrorCode}</code>
                            {item.lastErrorClass !== null && (
                              <div className="font-mono text-muted-foreground">{item.lastErrorClass}</div>
                            )}
                          </>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{formatDateTime(item.createdAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDateTime(status === 'dead' ? item.deadAt : item.availableAt)}
                      </TableCell>
                      {canManage && status === 'dead' && (
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={retrying !== null}
                            aria-busy={retrying === item.id}
                            aria-label={t('platform.commandHooks.outbox.retryLabel', { action: item.action, handler })}
                            onClick={() => void retry(item.id)}
                          >
                            <RotateCcw className="size-3.5" aria-hidden="true" />
                            {retrying === item.id
                              ? t('platform.commandHooks.outbox.retrying')
                              : t('platform.commandHooks.outbox.retry')}
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!loading && nextCursor !== null && (
        <Button type="button" variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
          {t('platform.commandHooks.outbox.loadMore')}
        </Button>
      )}
    </div>
  );
}
