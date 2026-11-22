import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { CheckCircle2, Inbox, RotateCcw, Webhook } from 'lucide-react';
import {
  COMMAND_OUTBOX_LISTED_STATUSES,
  COMMAND_OUTBOX_PAGE_MAX,
  ERROR_CODES,
  type CommandHookPlanAction,
  type CommandHookPlanItem,
  type CommandHookPlanResponse,
  type CommandOutboxListItem,
} from '@endora-commerce/contracts';
import { ApiError, cn, formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  EditorSection,
  EmptyState,
  Label,
  PageHeader,
  RouteTabs,
  Select,
} from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  ResponsiveTable,
  useCursorPagination,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
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

  // A strip of one tab is not a choice, so it is only drawn for two.
  const tabStrip = tabs.length > 1 ? <RouteTabs tabs={tabs} className="mb-4" /> : null;

  // The outbox is a list of records, so it is the kit list page (issue #1749);
  // the plan tab and the refusals keep the plain header.
  if (tab === 'outbox' && canReadOutbox) {
    return <Outbox t={t} canManage={hasPermission(COMMAND_OUTBOX_MANAGE)} names={names} tabs={tabStrip} />;
  }

  return (
    <>
      <PageHeader title={t('platform.commandHooks.title')} />
      {tabStrip}
      {tab === 'plan' ? (
        canReadPlan ? (
          <ExecutionPlan t={t} names={names} />
        ) : (
          <Alert variant="warning">
            <AlertDescription>{t('platform.commandHooks.plan.forbidden')}</AlertDescription>
          </Alert>
        )
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

const PHASES = ['beforeCommit', 'afterCommit'] as const;

const PHASE_COPY: Record<(typeof PHASES)[number], { title: string; hint: string }> = {
  beforeCommit: {
    title: 'platform.commandHooks.plan.beforeCommit.title',
    hint: 'platform.commandHooks.plan.beforeCommit.hint',
  },
  afterCommit: {
    title: 'platform.commandHooks.plan.afterCommit.title',
    hint: 'platform.commandHooks.plan.afterCommit.hint',
  },
};

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
      // Issue #1448 (DS-15): the tab's whole body, so the kit block.
      <Card>
        <EmptyState icon={<Webhook size={20} />} title={t('platform.commandHooks.plan.empty')} />
      </Card>
    );
  }
  // A phase is explained once, above every action that offers it — not once per
  // action (#1554, Signal-to-Noise). A phase no action offers is not explained.
  const offered = PHASES.filter((phase) => plan.actions.some((action) => action.phases.includes(phase)));
  return (
    <Card>
      <CardContent className="space-y-(--section-gap)">
        <dl data-plan-legend className="grid gap-x-6 gap-y-2 border-b pb-4 text-sm md:grid-cols-2">
          {offered.map((phase) => (
            <div key={phase} className="min-w-0">
              <dt className="font-medium">{t(PHASE_COPY[phase].title)}</dt>
              <dd className="text-(length:--fs-hint) text-muted-foreground">{t(PHASE_COPY[phase].hint)}</dd>
            </div>
          ))}
        </dl>
        {plan.actions.map((action) => (
          <ActionPlan
            key={action.action}
            action={action}
            items={plan.items.filter((item) => item.action === action.action)}
            names={names}
            t={t}
          />
        ))}
      </CardContent>
    </Card>
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
  // The order the hooks run in is the server's position, not the order the
  // response happened to list them in.
  const before = items
    .filter((item) => item.phase === 'beforeCommit')
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
  const after = items.filter((item) => item.phase === 'afterCommit');

  return (
    <EditorSection
      title={<span className={cn('font-mono', WRAP)}>{action.action}</span>}
      description={
        <span className={WRAP}>
          {t('platform.commandHooks.plan.owner', { module: names.get(action.owner) ?? action.owner })}
        </span>
      }
      contentClassName="grid gap-6 md:grid-cols-2"
    >
      {action.phases.includes('beforeCommit') && (
        <PhaseHooks
          ordered
          items={before}
          names={names}
          title={t(PHASE_COPY.beforeCommit.title)}
          t={t}
        />
      )}
      {action.phases.includes('afterCommit') && (
        <PhaseHooks
          ordered={false}
          items={after}
          names={names}
          title={t(PHASE_COPY.afterCommit.title)}
          t={t}
        />
      )}
    </EditorSection>
  );
}

function PhaseHooks({
  ordered,
  items,
  names,
  title,
  t,
}: {
  ordered: boolean;
  items: readonly CommandHookPlanItem[];
  names: ReadonlyMap<string, string>;
  title: string;
  t: Translate;
}): ReactNode {
  const titleId = useId();
  const List = ordered ? 'ol' : 'ul';

  return (
    <div className="min-w-0">
      <h3 id={titleId} className="mb-2 text-sm font-medium">
        {title}
      </h3>
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

/**
 * Where focus goes once the list has re-rendered (designer review 2): the
 * neighbour's Retry, the empty state, or — when a retry emptied a page that is
 * asked again — the results region (issue #1749).
 */
type FocusTarget = { kind: 'retry'; id: string } | { kind: 'empty' } | { kind: 'results' };

/**
 * The outbox tab, on the kit `ListPage` with the kit cursor pager (issue #1749).
 * The cursor is the last row's `sequence`, so retrying rows away does not shift
 * the next page, and the page on screen stays bounded — where *Load more* grew
 * one list without end. Review rule 7 governed how a *Load more* had to behave;
 * the kit pager replaces that control.
 */
function Outbox({
  t,
  canManage,
  names,
  tabs,
}: {
  t: Translate;
  canManage: boolean;
  names: ReadonlyMap<string, string>;
  tabs: ReactNode;
}): ReactNode {
  const { language } = useTranslationContext();
  const tLifecycle = useTranslation('_lifecycle');
  const { bundle, fallbackBundle } = useTranslationContext();
  const statusId = useId();
  const pager = useCursorPagination({ scope: 'command-outbox', maxPageSize: COMMAND_OUTBOX_PAGE_MAX });
  const { cursor, limit } = pager.query;
  const { page: pageIndex, syncPage, resetPage } = pager;
  const [status, setStatus] = useState<ListedStatus>('dead');
  const [attempt, setAttempt] = useState(0);
  const [items, setItems] = useState<CommandOutboxListItem[]>([]);
  /** The selected status has answered once: later reads are a refresh over its rows. */
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const retryButtons = useRef(new Map<string, HTMLButtonElement>());
  const emptyRef = useRef<HTMLDivElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    listCommandOutbox({ status, cursor, limit })
      .then((page) => {
        if (cancelled) return;
        syncPage({ cursor: page.nextCursor, hasMore: page.nextCursor !== null }, page.items.length);
        // A later page that came back empty steps back one page, which is asked
        // next: the screen keeps loading rather than draw an empty page.
        if (page.items.length === 0 && pageIndex > 0) return;
        setItems(page.items);
        setLoaded(true);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(errorText(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, cursor, limit, attempt, pageIndex, syncPage]);

  // Apply a deliberate focus move once the rows it names are on screen.
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null || loading) return;
    pendingFocus.current = null;
    const element =
      target.kind === 'retry'
        ? retryButtons.current.get(target.id)
        : target.kind === 'empty'
          ? emptyRef.current
          : resultsRef.current;
    element?.focus();
  }, [items, loading]);

  const footer = pager.footer(items.length);

  /** A status is a view of its own: page 1, a fresh skeleton, and no message from the last one. */
  const changeStatus = (next: ListedStatus): void => {
    setStatus(next);
    resetPage();
    setLoaded(false);
    setNotice(null);
    setRetryError(null);
  };

  /**
   * Take `id` off the page and send focus to its neighbour's Retry. The last
   * row of a page that is not the whole list asks for the same page again —
   * the next rows move up, or the pager steps back — with focus on the results;
   * the last row of the whole list leaves the empty state, which takes focus.
   */
  const dropRow = useCallback(
    (id: string): void => {
      const index = items.findIndex((item) => item.id === id);
      const neighbour = items[index + 1] ?? items[index - 1];
      if (neighbour) {
        pendingFocus.current = { kind: 'retry', id: neighbour.id };
        setItems((current) => current.filter((item) => item.id !== id));
      } else if (pageIndex > 0 || footer.hasNext) {
        pendingFocus.current = { kind: 'results' };
        setAttempt((n) => n + 1);
      } else {
        pendingFocus.current = { kind: 'empty' };
        setItems((current) => current.filter((item) => item.id !== id));
      }
    },
    [footer.hasNext, items, pageIndex],
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

  const columns: ResponsiveColumn<CommandOutboxListItem>[] = [
    {
      id: 'action',
      header: t('platform.commandHooks.outbox.column.action'),
      primary: true,
      className: cn('font-mono text-xs', WRAP),
      render: (item) => item.action,
    },
    {
      id: 'object',
      header: t('platform.commandHooks.outbox.column.object'),
      className: 'text-xs',
      render: (item) => (
        <>
          <div>{item.objectType}</div>
          <div className={cn('font-mono text-muted-foreground', WRAP)}>{item.objectId}</div>
        </>
      ),
    },
    {
      id: 'handler',
      header: t('platform.commandHooks.outbox.column.handler'),
      className: 'text-xs',
      render: (item) => (
        <>
          <ModuleName id={item.hookModule} names={names} />
          <div className={cn('font-mono text-muted-foreground', WRAP)}>{item.hookId}</div>
        </>
      ),
    },
    {
      id: 'attempts',
      header: t('platform.commandHooks.outbox.column.attempts'),
      className: 'text-right tabular-nums',
      render: (item) => item.attempts,
    },
    {
      id: 'failure',
      header: t('platform.commandHooks.outbox.column.failure'),
      className: cn('max-w-xs text-xs', WRAP),
      render: (item) => {
        if (item.lastErrorCode === null) {
          return <span className="text-muted-foreground">{t('platform.commandHooks.outbox.noFailure')}</span>;
        }
        const label = failureOf(item);
        return (
          <>
            {label !== null && <div>{label}</div>}
            <code className="font-mono">{item.lastErrorCode}</code>
            {item.lastErrorClass !== null && <div className="font-mono text-muted-foreground">{item.lastErrorClass}</div>}
          </>
        );
      },
    },
    {
      id: 'created',
      header: t('platform.commandHooks.outbox.column.created'),
      className: 'whitespace-nowrap text-xs',
      render: (item) => formatDateTime(item.createdAt, language),
    },
    ...(secondDate === null
      ? []
      : [
          {
            id: secondDate,
            header:
              secondDate === 'deadAt'
                ? t('platform.commandHooks.outbox.column.deadAt')
                : t('platform.commandHooks.outbox.column.availableAt'),
            className: 'whitespace-nowrap text-xs',
            render: (item: CommandOutboxListItem) =>
              formatDateTime(secondDate === 'deadAt' ? item.deadAt : item.availableAt, language),
          },
        ]),
  ];

  // Retry is a visible button, not a `RowActionMenu` item: it is the row's one
  // task and nothing destructive, so a menu would put the screen's only job one
  // click deep — and review rule 2's focus contract is written against it.
  const retryButton = (item: CommandOutboxListItem): ReactNode => (
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
      aria-label={t('platform.commandHooks.outbox.retryLabel', {
        action: item.action,
        handler: `${item.hookModule}#${item.hookId}`,
      })}
      onClick={() => void retry(item.id)}
    >
      <RotateCcw className="size-3.5" aria-hidden="true" />
      {retrying === item.id ? t('platform.commandHooks.outbox.retrying') : t('platform.commandHooks.outbox.retry')}
    </Button>
  );

  const load: ListPageLoad =
    loadError !== null
      ? {
          kind: 'error',
          message: loadError,
          // Review rule: a load error offers *Try again*, which asks for the same page.
          action: (
            <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              {t('platform.commandHooks.tryAgain')}
            </Button>
          ),
        }
      : loaded
        ? { kind: 'ready' }
        : { kind: 'loading' };

  return (
    <ListPage
      title={t('platform.commandHooks.title')}
      tabs={tabs}
      toolbar={
        <div className="flex max-w-xs flex-col gap-1">
          <Label htmlFor={statusId}>{t('platform.commandHooks.outbox.status.label')}</Label>
          <Select id={statusId} value={status} onChange={(event) => changeStatus(event.target.value as ListedStatus)}>
            {COMMAND_OUTBOX_LISTED_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(STATUS_LABEL_KEY[value])}
              </option>
            ))}
          </Select>
        </div>
      }
      // One live region (review rule): the count, or a retry's outcome in its place.
      count={notice ?? t('platform.commandHooks.outbox.count', { count: items.length })}
      notice={
        <>
          <p className="text-sm text-muted-foreground">{t('platform.commandHooks.outbox.hint')}</p>
          {!canManage && status === 'dead' && items.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {t('platform.commandHooks.outbox.manageHint', {
                permission: tLifecycle('adminRoles.permission.platform.command_outbox.manage'),
              })}
            </p>
          )}
          {retryError !== null && (
            <Alert variant="destructive">
              <AlertDescription>{retryError}</AlertDescription>
            </Alert>
          )}
        </>
      }
      load={load}
      busy={loading && loaded}
      resultsRef={resultsRef}
      pagination={footer}
    >
      <ResponsiveTable
        label={t('platform.commandHooks.outbox.caption', { status: statusLabel })}
        columns={columns}
        data={items}
        keyExtractor={(item) => item.id}
        {...(showRetry ? { renderActions: retryButton } : {})}
        emptyState={
          // Each status is a view of its own, not a filter, so there is nothing
          // to clear. The wrapper takes focus when the last row is retried away
          // (WCAG 2.4.3).
          <div ref={emptyRef} tabIndex={-1} className="outline-none">
            <EmptyState
              icon={status === 'dead' ? <CheckCircle2 size={20} /> : <Inbox size={20} />}
              title={t(EMPTY_KEY[status])}
            />
          </div>
        }
      />
    </ListPage>
  );
}
