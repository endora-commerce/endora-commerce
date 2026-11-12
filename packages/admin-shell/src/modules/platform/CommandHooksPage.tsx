import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { CheckCircle2, Inbox, RotateCcw, Webhook } from 'lucide-react';
import {
  COMMAND_OUTBOX_LISTED_STATUSES,
  ERROR_CODES,
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
  TableCaption,
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
import { listModules } from './api.js';

/**
 * `/platform/command-hooks` — which modules run inside or after another
 * module's write, and the deliveries that need an operator
 * (`specs/176-command-hooks-outbox/` US4, FR-041).
 *
 * Kernel-served, like `/platform/modules`: a hook spans the module that
 * declares an action and every module that hooks it, so no one module's
 * presence may decide whether the screen is there. Two tabs, two codes — the
 * execution plan behind `platform.modules.read`, the outbox behind
 * `platform.command_outbox.read`, with the retry control offered only to a
 * holder of `platform.command_outbox.manage`. Either code opens the screen
 * (architect ruling 2 on #1080): a tab the operator may not read is not shown,
 * and an outbox-only operator asking for the plan lands on the outbox.
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

/** The sentence an error envelope carries, never its `CODE: message` form. */
function errorText(err: unknown): string {
  return err instanceof ApiError ? err.envelope.error.message : String(err);
}

/** Long ids and codes wrap inside their cell rather than widening the table. */
const WRAP = '[overflow-wrap:anywhere]';

const PLAN_READ = 'platform.modules.read';

/**
 * Module names by id, for a holder of `platform.modules.read` — the code
 * `GET /api/v1/admin/modules` is behind. Tolerant: without it, or when the
 * route is not served, the screen shows ids alone.
 */
function useModuleNames(enabled: boolean): ReadonlyMap<string, string> {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    listModules()
      .then((response) => {
        if (!cancelled) setNames(new Map(response.modules.map((module) => [module.id, module.name])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return names;
}

/** A module by name, with its id below in monospace; the id alone when no name is known. */
function ModuleName({ id, names }: { id: string; names: ReadonlyMap<string, string> }): ReactNode {
  const name = names.get(id);
  if (name === undefined) return <span className={`font-mono ${WRAP}`}>{id}</span>;
  return (
    <span className="inline-flex flex-col">
      <span>{name}</span>
      <span className={`font-mono text-xs text-muted-foreground ${WRAP}`}>{id}</span>
    </span>
  );
}

function LoadError({ message, onRetry, t }: { message: string; onRetry: () => void; t: Translate }): ReactNode {
  return (
    <Alert variant="destructive">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{message}</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t('platform.commandHooks.tryAgain')}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function CommandHooksPage({ tab }: { tab: Tab }): ReactNode {
  const t = useTranslation('core');
  const { hasPermission } = useAuth();
  const canReadPlan = hasPermission(PLAN_READ);
  const canReadOutbox = hasPermission(COMMAND_OUTBOX_READ);
  const names = useModuleNames(canReadPlan);

  const tabs = useMemo(
    () => [
      ...(canReadPlan ? [{ to: PLAN_PATH, label: t('platform.commandHooks.tab.plan') }] : []),
      ...(canReadOutbox ? [{ to: OUTBOX_PATH, label: t('platform.commandHooks.tab.outbox') }] : []),
    ],
    [canReadOutbox, canReadPlan, t],
  );

  if (tab === 'plan' && !canReadPlan && canReadOutbox) {
    return <Navigate to={OUTBOX_PATH} replace />;
  }

  return (
    <>
      <PageHeader title={t('platform.commandHooks.title')} description={t('platform.commandHooks.description')} />
      {/* A strip of one tab is not a choice, so it is only drawn for two. */}
      {tabs.length > 1 && <RouteTabs tabs={tabs} className="mb-4" />}
      {tab === 'plan' ? (
        canReadPlan ? (
          <ExecutionPlan t={t} names={names} />
        ) : (
          <Alert variant="warning">
            <AlertDescription>{t('platform.commandHooks.plan.forbidden')}</AlertDescription>
          </Alert>
        )
      ) : canReadOutbox ? (
        <Outbox t={t} canManage={hasPermission(COMMAND_OUTBOX_MANAGE)} names={names} />
      ) : (
        <Alert variant="warning">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>{t('platform.commandHooks.outbox.forbidden')}</span>
            {canReadPlan && (
              <Link to={PLAN_PATH} className="font-medium underline underline-offset-4">
                {t('platform.commandHooks.outbox.backToPlan')}
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Execution plan
// ---------------------------------------------------------------------------

function ExecutionPlan({ t, names }: { t: Translate; names: ReadonlyMap<string, string> }): ReactNode {
  const [plan, setPlan] = useState<CommandHookPlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPlan(null);
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
  }, [attempt]);

  if (error) {
    return <LoadError message={error} onRetry={() => setAttempt((n) => n + 1)} t={t} />;
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
        <CardContent className="flex items-center gap-3 pt-6 text-sm text-muted-foreground">
          <Webhook className="size-5 shrink-0" aria-hidden="true" />
          <p>{t('platform.commandHooks.plan.empty')}</p>
        </CardContent>
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
          names={names}
          t={t}
        />
      ))}
    </div>
  );
}

function ActionPlan({
  action,
  items,
  names,
  t,
}: {
  action: CommandHookPlanAction;
  items: readonly CommandHookPlanItem[];
  names: ReadonlyMap<string, string>;
  t: Translate;
}): ReactNode {
  const headingId = useId();
  // The order the hooks run in is the server's position, not the order the
  // response happened to list them in.
  const before = items
    .filter((item) => item.phase === 'beforeCommit')
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
  const after = items.filter((item) => item.phase === 'afterCommit');

  return (
    <Card>
      <section aria-labelledby={headingId}>
        <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2 space-y-0">
          <CardTitle className="min-w-0">
            <h2 id={headingId} className={`font-mono text-base ${WRAP}`}>
              {action.action}
            </h2>
          </CardTitle>
          <span className={`text-sm text-muted-foreground ${WRAP}`}>
            {t('platform.commandHooks.plan.owner', { module: names.get(action.owner) ?? action.owner })}
          </span>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          {action.phases.includes('beforeCommit') && (
            <PhaseHooks
              ordered
              items={before}
              names={names}
              title={t('platform.commandHooks.plan.beforeCommit.title')}
              hint={t('platform.commandHooks.plan.beforeCommit.hint')}
              t={t}
            />
          )}
          {action.phases.includes('afterCommit') && (
            <PhaseHooks
              ordered={false}
              items={after}
              names={names}
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
  names,
  title,
  hint,
  t,
}: {
  ordered: boolean;
  items: readonly CommandHookPlanItem[];
  names: ReadonlyMap<string, string>;
  title: string;
  hint: string;
  t: Translate;
}): ReactNode {
  const titleId = useId();
  const List = ordered ? 'ol' : 'ul';

  return (
    <div className="min-w-0">
      <h3 id={titleId} className="text-sm font-medium">
        {title}
      </h3>
      <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('platform.commandHooks.plan.noHooks')}</p>
      ) : (
        <List
          aria-labelledby={titleId}
          className={ordered ? 'list-decimal space-y-2 pl-6 text-sm' : 'list-disc space-y-2 pl-6 text-sm'}
        >
          {items.map((item) => (
            <li
              key={`${item.module}#${item.id}`}
              data-hook={`${item.module}#${item.id}`}
              {...(ordered && item.position !== null ? { value: item.position } : {})}
            >
              <span className="inline-flex flex-wrap items-start gap-x-2 gap-y-1">
                <ModuleName id={item.module} names={names} />
                <span className="text-muted-foreground" aria-hidden="true">
                  ·
                </span>
                <span className={`font-mono ${WRAP}`}>{item.id}</span>
                <Badge variant={item.moduleEnabled ? 'success' : 'secondary'} className="whitespace-nowrap">
                  {item.moduleEnabled ? t('platform.commandHooks.module.on') : t('platform.commandHooks.module.off')}
                </Badge>
              </span>
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

/** Where focus goes once the list has re-rendered (designer review 2, 7). */
type FocusTarget = { kind: 'retry'; id: string } | { kind: 'row'; id: string } | { kind: 'empty' } | { kind: 'end' };

function Outbox({
  t,
  canManage,
  names,
}: {
  t: Translate;
  canManage: boolean;
  names: ReadonlyMap<string, string>;
}): ReactNode {
  const tLifecycle = useTranslation('_lifecycle');
  const { bundle, fallbackBundle } = useTranslationContext();
  const statusId = useId();
  const [status, setStatus] = useState<ListedStatus>('dead');
  const [attempt, setAttempt] = useState(0);
  const [items, setItems] = useState<CommandOutboxListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadedMore, setLoadedMore] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const retryButtons = useRef(new Map<string, HTMLButtonElement>());
  const rows = useRef(new Map<string, HTMLTableRowElement>());
  const emptyRef = useRef<HTMLParagraphElement | null>(null);
  const endRef = useRef<HTMLParagraphElement | null>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setItems([]);
    setNextCursor(null);
    setLoadError(null);
    setMoreError(null);
    setLoadedMore(false);
    setRetryError(null);
    setNotice(null);
    listCommandOutbox({ status })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorText(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, attempt]);

  // Apply a deliberate focus move once the rows it names are on screen.
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null || loading) return;
    pendingFocus.current = null;
    const element =
      target.kind === 'retry'
        ? retryButtons.current.get(target.id)
        : target.kind === 'row'
          ? rows.current.get(target.id)
          : target.kind === 'empty'
            ? emptyRef.current
            : endRef.current;
    element?.focus();
  }, [items, loading, nextCursor]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await listCommandOutbox({ status, cursor: nextCursor });
      const first = page.items[0];
      pendingFocus.current = first ? { kind: 'row', id: first.id } : { kind: 'end' };
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      setLoadedMore(true);
    } catch (err) {
      setMoreError(errorText(err));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor, status]);

  /** Take `id` off the list and send focus to its neighbour, or to the empty state. */
  const dropRow = useCallback(
    (id: string): void => {
      const index = items.findIndex((item) => item.id === id);
      const neighbour = items[index + 1] ?? items[index - 1];
      pendingFocus.current = neighbour ? { kind: 'retry', id: neighbour.id } : { kind: 'empty' };
      setItems((current) => current.filter((item) => item.id !== id));
    },
    [items],
  );

  const retry = useCallback(
    async (id: string): Promise<void> => {
      // The buttons stay focusable while one runs (aria-disabled), so the
      // guard is here rather than in `disabled`.
      if (retrying !== null) return;
      setRetrying(id);
      setNotice(null);
      setRetryError(null);
      try {
        await retryCommandOutboxEntry(id);
        dropRow(id);
        setNotice(t('platform.commandHooks.outbox.retried'));
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && err.envelope.error.code === ERROR_CODES.COMMAND_OUTBOX_NOT_DEAD) {
          // Someone else already retried it, or it was delivered: an outcome,
          // not a failure. The row is no longer dead, so it leaves this list.
          dropRow(id);
          setNotice(err.envelope.error.message);
        } else {
          setRetryError(errorText(err));
        }
      } finally {
        setRetrying(null);
      }
    },
    [dropRow, retrying, t],
  );

  const failureOf = (item: CommandOutboxListItem): string | null =>
    item.lastErrorCode === null ? null : failureLabel(item.lastErrorCode, item.hookModule, bundle, fallbackBundle);

  const statusLabel = t(STATUS_LABEL_KEY[status]);
  const showRetry = canManage && status === 'dead';
  // In flight, the row's due time is in the past and its lease is not served:
  // no date beyond Created means anything there (architect ruling 4).
  const secondDate: 'deadAt' | 'availableAt' | null =
    status === 'dead' ? 'deadAt' : status === 'pending' ? 'availableAt' : null;

  let announcement: string;
  if (loading) announcement = t('platform.commandHooks.outbox.loading');
  else if (notice !== null) announcement = notice;
  else if (loadError !== null) announcement = '';
  else announcement = t('platform.commandHooks.outbox.count', { count: items.length });

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

      {/* One live region, mounted before it has text (WCAG 4.1.3): loading, the
          result count and a retry's outcome are all announced from here. */}
      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {announcement}
      </div>
      {loadError !== null && <LoadError message={loadError} onRetry={() => setAttempt((n) => n + 1)} t={t} />}
      {retryError !== null && (
        <Alert variant="destructive">
          <AlertDescription>{retryError}</AlertDescription>
        </Alert>
      )}

      {loading || loadError !== null ? null : items.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 pt-6 text-sm text-muted-foreground">
            {status === 'dead' ? (
              <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden="true" />
            ) : (
              <Inbox className="size-5 shrink-0" aria-hidden="true" />
            )}
            <p ref={emptyRef} tabIndex={-1} className="outline-none">
              {t(EMPTY_KEY[status])}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            {!canManage && status === 'dead' && (
              <p className="mb-3 text-sm text-muted-foreground">
                {t('platform.commandHooks.outbox.manageHint', {
                  permission: tLifecycle('adminRoles.permission.platform.command_outbox.manage'),
                })}
              </p>
            )}
            <Table>
              <TableCaption className="sr-only">
                {t('platform.commandHooks.outbox.caption', { status: statusLabel })}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('platform.commandHooks.outbox.column.action')}</TableHead>
                  <TableHead>{t('platform.commandHooks.outbox.column.object')}</TableHead>
                  <TableHead>{t('platform.commandHooks.outbox.column.handler')}</TableHead>
                  <TableHead className="text-right">{t('platform.commandHooks.outbox.column.attempts')}</TableHead>
                  <TableHead>{t('platform.commandHooks.outbox.column.failure')}</TableHead>
                  <TableHead>{t('platform.commandHooks.outbox.column.created')}</TableHead>
                  {secondDate !== null && (
                    <TableHead>
                      {secondDate === 'deadAt'
                        ? t('platform.commandHooks.outbox.column.deadAt')
                        : t('platform.commandHooks.outbox.column.availableAt')}
                    </TableHead>
                  )}
                  {showRetry && (
                    <TableHead className="text-right">{t('platform.commandHooks.outbox.column.actions')}</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const label = failureOf(item);
                  const handler = `${item.hookModule}#${item.hookId}`;
                  return (
                    <TableRow
                      key={item.id}
                      data-outbox-id={item.id}
                      tabIndex={-1}
                      className="outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      ref={(element) => {
                        if (element) rows.current.set(item.id, element);
                        else rows.current.delete(item.id);
                      }}
                    >
                      <TableCell className={`font-mono text-xs ${WRAP}`}>{item.action}</TableCell>
                      <TableCell className="text-xs">
                        <div>{item.objectType}</div>
                        <div className={`font-mono text-muted-foreground ${WRAP}`}>{item.objectId}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <ModuleName id={item.hookModule} names={names} />
                        <div className={`font-mono text-muted-foreground ${WRAP}`}>{item.hookId}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{item.attempts}</TableCell>
                      <TableCell className={`max-w-xs text-xs ${WRAP}`}>
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
                      {secondDate !== null && (
                        <TableCell className="whitespace-nowrap text-xs">
                          {formatDateTime(secondDate === 'deadAt' ? item.deadAt : item.availableAt)}
                        </TableCell>
                      )}
                      {showRetry && (
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            ref={(element: HTMLButtonElement | null) => {
                              if (element) retryButtons.current.set(item.id, element);
                              else retryButtons.current.delete(item.id);
                            }}
                            aria-disabled={retrying !== null}
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

      {!loading && loadError === null && (nextCursor !== null || moreError !== null || loadedMore) && (
        <div data-load-more className="flex flex-wrap items-center gap-3">
          {nextCursor !== null && (
            <Button
              type="button"
              variant="outline"
              aria-disabled={loadingMore}
              aria-busy={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? t('platform.commandHooks.outbox.loadingMore') : t('platform.commandHooks.outbox.loadMore')}
            </Button>
          )}
          {moreError !== null && <p className="text-sm text-destructive">{moreError}</p>}
          {nextCursor === null && loadedMore && (
            <p ref={endRef} tabIndex={-1} className="text-sm text-muted-foreground outline-none">
              {t('platform.commandHooks.outbox.end')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
