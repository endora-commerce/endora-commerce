import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import type {
  OpportunityDetail as OpportunityDetailData,
  OpportunityTransitionResult,
  PropagationOutcome,
} from '@endora-commerce/contracts';
import { cn, statusBadgeStyle, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi, type OrderStatusOption } from '../api.js';
import { salesChannelLabel } from '../components/LookupPickers.js';
import { ModalDialog } from '../components/ModalDialog.js';
import { PropagationOutcomes } from '../components/PropagationOutcomes.js';
import { StageBar } from '../components/StageBar.js';
import { errorMessage } from '../lib/labels.js';
import { OpportunitySidebar } from './opportunity-detail/OpportunitySidebar.js';
import {
  DEFAULT_TAB_ID,
  OPPORTUNITY_TABS,
  searchForTab,
  tabFromSearch,
} from './opportunity-detail/tabs.js';

const LIST_PATH = '/crm/opportunities';

/** A quiet "·" between two parts of the header's meta line. */
function MetaSeparator(): ReactNode {
  return (
    <span aria-hidden="true" className="px-1.5">
      ·
    </span>
  );
}

/**
 * One Opportunity (`specs/143-crm-sales-opportunities/`, User Stories 1 and 20;
 * `contracts/admin-surfaces.md` §1).
 *
 * Top to bottom, the way the eye asks its questions:
 *
 * 1. **the header** — what it is called, its status, and one quiet line of who
 *    it is for and who holds it; *Edit* and *Delete* on the right;
 * 2. **the stage bar** — where it is in the workflow and where it may go, with
 *    what became of the linked Orders after a move directly underneath;
 * 3. **two columns** — the tabs on the left (declared as data in
 *    `opportunity-detail/tabs.ts`), the facts on the right. Below `lg` the
 *    facts follow the tabs, in the order a keyboard meets them.
 *
 * **The selected tab is in the address** (`?tab=<id>`), so it survives a
 * reload and can be linked to; the default tab is the bare address.
 *
 * The outcomes of the last move are kept **here**, between the bar that
 * produces them and the section that shows them: a move's answer carries every
 * Order's outcome, applied ones included, while the Opportunity itself only
 * remembers the ones still unresolved. Showing both is what tells a Sales Rep
 * "three Orders moved, one did not" rather than only the exception.
 *
 * **Deleting is the page's**, not a tab's: it removes the Opportunity with its
 * links and its history, is gated `crm:configure` like the endpoint, asks
 * first, and leaves for the list.
 */
export function OpportunityDetail(): ReactNode {
  const { id = '' } = useParams<{ id: string }>();
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const [opportunity, setOpportunity] = useState<OpportunityDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const sequence = useRef(0);
  const tablistRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('crm:write');
  const canDelete = hasPermission('crm:configure');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [orderStatuses, setOrderStatuses] = useState<OrderStatusOption[]>([]);
  const [salesChannelName, setSalesChannelName] = useState<string | null>(null);
  /** Outcomes of the moves and retries made during this visit, newest move first. */
  const [recent, setRecent] = useState<PropagationOutcome[]>([]);
  const [outcomesShown, setOutcomesShown] = useState(false);

  const activeTab = tabFromSearch(searchParams);

  const selectTab = useCallback(
    (tabId: string): void => {
      // The tab is a view of the same page: it replaces the entry instead of
      // adding one, and keeps the navigation state a create screen handed over.
      // The edit form lives on the default tab; leaving it closes the form.
      if (tabId !== DEFAULT_TAB_ID) setEditing(false);
      setSearchParams((previous) => searchForTab(previous, tabId), {
        replace: true,
        state: location.state as unknown,
      });
    },
    [setSearchParams, location.state],
  );

  const remove = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await crmApi.deleteOpportunity(id);
      void navigate(LIST_PATH);
    } catch (failure) {
      setDeleteError(errorMessage(failure, t('opportunity.delete.error')));
      setDeleting(false);
    }
  };

  const reload = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setError(null);
    try {
      const loaded = await crmApi.getOpportunity(id);
      if (current === sequence.current) setOpportunity(loaded);
    } catch (failure) {
      if (current === sequence.current) {
        setError(errorMessage(failure, t('opportunity.detail.error')));
      }
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    setOpportunity(null);
    setLoading(true);
    // What was said about one Opportunity is not said about the next.
    setRecent([]);
    setOutcomesShown(false);
    setEditing(false);
    void reload();
  }, [reload]);

  // Order status names are `orders`' and need `orders:read`. Without them the
  // codes are shown — less friendly, still true.
  useEffect(() => {
    let alive = true;
    crmApi
      .listOrderStatuses()
      .then((statuses) => {
        if (alive) setOrderStatuses(statuses);
      })
      .catch(() => {
        if (alive) setOrderStatuses([]);
      });
    return (): void => {
      alive = false;
    };
  }, []);

  const salesChannelId = opportunity?.salesChannelId ?? null;
  useEffect(() => {
    if (!salesChannelId) {
      setSalesChannelName(null);
      return undefined;
    }
    let alive = true;
    crmApi
      .lookupSalesChannels()
      .then((channels) => {
        if (!alive) return;
        const channel = channels.find((item) => item.id === salesChannelId);
        setSalesChannelName(channel ? salesChannelLabel(channel, language) : null);
      })
      .catch(() => {
        if (alive) setSalesChannelName(null);
      });
    return (): void => {
      alive = false;
    };
  }, [salesChannelId, language]);

  const unresolved = opportunity?.unresolvedPropagations;
  const unresolvedIds = useMemo(
    () => new Set((unresolved ?? []).map((outcome) => outcome.id)),
    [unresolved],
  );

  // This visit's outcomes first, then the refusals left open by earlier ones.
  const outcomes = useMemo(() => {
    const seen = new Set(recent.map((outcome) => outcome.id));
    return [...recent, ...(unresolved ?? []).filter((outcome) => !seen.has(outcome.id))];
  }, [recent, unresolved]);

  useEffect(() => {
    if (outcomes.length > 0) setOutcomesShown(true);
  }, [outcomes.length]);

  const back = { label: t('opportunity.detail.back'), to: LIST_PATH };

  if (opportunity === null) {
    return (
      <>
        <PageHeader title={t('opportunity.detail.title')} back={back} />
        {loading ? (
          <>
            <p role="status" className="text-sm text-muted-foreground">
              {t('opportunity.detail.loading')}
            </p>
            {/* The shape of what is coming: the bar, the tabs, the facts. */}
            <div aria-hidden="true" className="mt-4 space-y-6">
              <div className="h-24 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <div className="h-72 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
                <div className="h-72 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
              </div>
            </div>
          </>
        ) : (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{error ?? t('opportunity.detail.error')}</span>
              <span className="flex gap-2">
                <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void reload()}>
                  {tCore('common.action.retry')}
                </Button>
                <Button className="min-h-11 sm:min-h-8" asChild variant="ghost" size="sm">
                  <Link to={LIST_PATH}>{t('opportunity.detail.back')}</Link>
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        )}
      </>
    );
  }

  const onMoved = (result: OpportunityTransitionResult): void => {
    setRecent(result.propagation);
    setOpportunity(result.opportunity);
  };

  const onRetried = async (previousId: string, outcome: PropagationOutcome): Promise<void> => {
    await reload();
    setRecent((previous) =>
      previous.some((item) => item.id === previousId)
        ? previous.map((item) => (item.id === previousId ? outcome : item))
        : [outcome, ...previous],
    );
  };

  const onDismissed = async (outcomeId: string): Promise<void> => {
    await reload();
    setRecent((previous) => previous.filter((item) => item.id !== outcomeId));
  };

  const tab = OPPORTUNITY_TABS.find((candidate) => candidate.id === activeTab) ?? OPPORTUNITY_TABS[0];
  const TabComponent = tab?.component;

  /** Arrow keys walk the strip, as the tabs pattern has it; Tab leaves it for the panel. */
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = OPPORTUNITY_TABS.findIndex((candidate) => candidate.id === tab?.id);
    const last = OPPORTUNITY_TABS.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    const target = OPPORTUNITY_TABS[next];
    if (!target) return;
    event.preventDefault();
    selectTab(target.id);
    tablistRef.current
      ?.querySelector<HTMLButtonElement>(`#crm-opportunity-tab-${target.id}`)
      ?.focus();
  };

  return (
    <>
      <PageHeader
        // A title is the operator's and may be one long word: it wraps inside
        // the header instead of pushing the page sideways.
        className="[&>div:first-child]:min-w-0 [&_h1]:flex-wrap"
        title={
          <>
            <span className="min-w-0 [overflow-wrap:anywhere]">{opportunity.title}</span>
            <Badge className="shrink-0 font-medium" style={statusBadgeStyle(opportunity.status.color)}>
              {opportunity.status.name}
            </Badge>
          </>
        }
        description={
          <>
            <span>{opportunity.number}</span>
            <MetaSeparator />
            <span className="[overflow-wrap:anywhere]">{opportunity.organization.name}</span>
            <MetaSeparator />
            <span>{opportunity.assignee?.name ?? t('assignment.unassigned')}</span>
            {salesChannelName ? (
              <>
                <MetaSeparator />
                <span>{salesChannelName}</span>
              </>
            ) : null}
          </>
        }
        back={back}
        actions={
          canWrite || canDelete ? (
            <>
              {canWrite && !editing ? (
                <Button
                  variant="outline"
                  className="min-h-11 sm:min-h-9"
                  onClick={(): void => {
                    selectTab(DEFAULT_TAB_ID);
                    setEditing(true);
                  }}
                >
                  <Pencil aria-hidden="true" className="size-4" />
                  {t('opportunity.edit.open')}
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  variant="outline"
                  // Kept a step away from Edit: the one that cannot be undone
                  // is not the neighbour of the one pressed every day.
                  className="ml-2 min-h-11 text-destructive hover:text-destructive sm:min-h-9"
                  onClick={(): void => {
                    setDeleteError(null);
                    setConfirmingDelete(true);
                  }}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                  {t('opportunity.delete.open')}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />

      {confirmingDelete ? (
        <ModalDialog
          title={t('opportunity.delete.title')}
          busy={deleting}
          onClose={(): void => setConfirmingDelete(false)}
          footer={
            <>
              <Button
                variant="outline"
                className="min-h-11 sm:min-h-9"
                disabled={deleting}
                onClick={(): void => setConfirmingDelete(false)}
              >
                {tCore('common.action.cancel')}
              </Button>
              <Button
                variant="destructive"
                className="min-h-11 sm:min-h-9"
                disabled={deleting}
                aria-busy={deleting}
                onClick={(): void => void remove()}
              >
                {t('opportunity.delete.confirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            {t('opportunity.delete.body', { number: opportunity.number, title: opportunity.title })}
          </p>
          {deleteError ? (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          ) : null}
        </ModalDialog>
      ) : null}

      {/* A later read that failed leaves the last good one on screen. */}
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            <StageBar
              // The reason typed for one Opportunity is not the next one's.
              key={opportunity.id}
              opportunity={opportunity}
              canWrite={canWrite}
              onMoved={onMoved}
              reload={reload}
            />
          </CardContent>
        </Card>

        {outcomesShown || outcomes.length > 0 ? (
          <Card>
            <CardContent className="pt-6">
              <PropagationOutcomes
                opportunityId={opportunity.id}
                outcomes={outcomes}
                unresolvedIds={unresolvedIds}
                orderStatuses={orderStatuses}
                language={language}
                canWrite={canWrite}
                onRetried={onRetried}
                onDismissed={onDismissed}
              />
            </CardContent>
          </Card>
        ) : null}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card className="min-w-0 overflow-hidden">
            <div className="b2b-tabs-scroll px-1 pt-1">
              <div
                ref={tablistRef}
                className="b2b-tabs"
                role="tablist"
                aria-label={t('opportunity.tabs.label')}
                onKeyDown={onTabKeyDown}
              >
                {OPPORTUNITY_TABS.map((candidate) => {
                  const selected = candidate.id === tab?.id;
                  const count = candidate.count?.(opportunity) ?? 0;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      role="tab"
                      id={`crm-opportunity-tab-${candidate.id}`}
                      aria-selected={selected}
                      aria-controls="crm-opportunity-tabpanel"
                      // One stop for the strip; the arrows move inside it.
                      tabIndex={selected ? 0 : -1}
                      className={cn('b2b-tab', selected && 'is-active')}
                      onClick={(): void => selectTab(candidate.id)}
                    >
                      {t(candidate.labelKey)}
                      {/* Part of the tab's name on purpose: "Links 2" is what it holds. */}
                      {count > 0 ? (
                        <>
                          {/* A real space, so the name is "Links 2" and not "Links2". */}
                          {' '}
                          <span className="b2b-badge tabular-nums">{count}</span>
                        </>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <CardContent
              className="pt-6"
              id="crm-opportunity-tabpanel"
              role="tabpanel"
              aria-labelledby={`crm-opportunity-tab-${tab?.id ?? ''}`}
            >
              <Suspense
                fallback={
                  <p role="status" className="text-sm text-muted-foreground">
                    {tCore('common.state.loading')}
                  </p>
                }
              >
                {TabComponent ? (
                  <TabComponent
                    // A tab holds state about one Opportunity; another one starts clean.
                    key={opportunity.id}
                    opportunity={opportunity}
                    onChange={setOpportunity}
                    reload={reload}
                    orderStatuses={orderStatuses}
                    editing={editing}
                    onEditingChange={setEditing}
                  />
                ) : null}
              </Suspense>
            </CardContent>
          </Card>

          <OpportunitySidebar
            key={opportunity.id}
            opportunity={opportunity}
            canWrite={canWrite}
            salesChannelName={salesChannelName}
            onChange={setOpportunity}
            reload={reload}
          />
        </div>
      </div>
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default OpportunityDetail;
