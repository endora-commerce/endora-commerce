import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Download, Play } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/ResponsiveTable';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { useTranslation } from '@/i18n/useTranslation';
import {
  productFeedsClient,
  type FeedRunDetail,
  type IssuedFeedToken,
  type ProductFeedDto,
} from './api';
import { FeedLinkCard } from './components/FeedLinkCard';
import { FeedSettingsForm } from './components/FeedSettingsForm';
import { FeedStatusBadge } from './components/FeedStatusBadge';

type Tab = 'overview' | 'runs' | 'settings';

const POLL_INTERVAL_MS = 5_000;

/**
 * Feed detail — ux-design §2.3.
 *
 * The success state after the first run ("Your feed is ready" plus the link)
 * lives in `FeedLinkCard`; this page owns the tabs, the manual-generate action
 * and the run history.
 *
 * The plaintext link is passed through `location.state` from the create page
 * and from a rotation, and is deliberately never fetched: the platform stores
 * only the token's sha256, so after a reload the card falls back to the prefix.
 */
export function ProductFeedDetailPage(): ReactNode {
  const t = useTranslation('product_feeds');
  const { feedId } = useParams<{ feedId: string }>();
  const location = useLocation();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('product_feeds:write');
  const writeTitle = canWrite ? undefined : t('permission.needWrite');

  const [tab, setTab] = useState<Tab>('overview');
  const [feed, setFeed] = useState<ProductFeedDto | null>(null);
  const [runs, setRuns] = useState<FeedRunDetail[]>([]);
  const [issuedToken, setIssuedToken] = useState<IssuedFeedToken | null>(
    (location.state as { issuedToken?: IssuedFeedToken } | null)?.issuedToken ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!feedId) return;
    try {
      const [detail, runList] = await Promise.all([
        productFeedsClient.get(feedId),
        productFeedsClient.listRuns(feedId),
      ]);
      setFeed(detail.data);
      setRuns(runList.data);
      setError(null);
    } catch {
      setError(t('feeds.loadFailed'));
    }
  }, [feedId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!feed?.isRunning) return undefined;
    const handle = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [feed?.isRunning, load]);

  const generate = async (): Promise<void> => {
    if (!feedId) return;
    setBusy(true);
    try {
      await productFeedsClient.generate(feedId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!feed) {
    return (
      <div>
        <PageHeader title={t('page.title')} back={{ label: t('page.title'), to: '/product-feeds' }} />
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  /**
   * A skipped tick is history, not news: the schedule fired while the previous
   * run was still going, or while the feed was disabled (FR-033). Those rows are
   * rendered muted with their reason spelled out, so the Runs tab reads as "here
   * is what happened" rather than a wall of identical-looking entries.
   *
   * The greying is per cell rather than per row because `ResponsiveTable` is a
   * shared primitive with no row-styling hook, and growing one for a single
   * caller is not worth the blast radius.
   */
  const muted = (row: FeedRunDetail, node: ReactNode): ReactNode =>
    row.status === 'skipped' ? <span className="text-muted-foreground">{node}</span> : node;

  const runColumns: ResponsiveColumn<FeedRunDetail>[] = [
    {
      id: 'status',
      header: t('feeds.table.status'),
      primary: true,
      // The whole cell is the link into the run detail: the operator's next
      // question after "it completed with warnings" is always "which ones".
      render: (row) => (
        <Link to={`/product-feeds/${feed.id}/runs/${row.id}`} className="flex flex-col gap-0.5">
          <FeedStatusBadge status={row.status} />
          {row.status === 'skipped' && row.skipReason && (
            <span className="text-xs text-muted-foreground">
              {t(`runs.skipReason.${row.skipReason}`)}
            </span>
          )}
        </Link>
      ),
      meta: (row) => formatDateTime(row.startedAt ?? row.createdAt),
    },
    {
      id: 'startedAt',
      header: t('runs.table.startedAt'),
      hideOnMobile: true,
      render: (row) => muted(row, formatDateTime(row.startedAt ?? row.createdAt)),
    },
    {
      id: 'trigger',
      header: t('runs.table.trigger'),
      hideOnMobile: true,
      render: (row) => muted(row, t(`runs.trigger.${row.trigger}`)),
    },
    {
      id: 'emitted',
      header: t('runs.table.emitted'),
      render: (row) => muted(row, String(row.emittedCount)),
    },
    {
      id: 'skipped',
      header: t('runs.table.skipped'),
      hideOnMobile: true,
      render: (row) => muted(row, String(row.skippedCount)),
    },
    {
      id: 'warnings',
      header: t('runs.table.warnings'),
      hideOnMobile: true,
      render: (row) => muted(row, String(row.warningCount)),
    },
    {
      id: 'duration',
      header: t('runs.table.duration'),
      hideOnMobile: true,
      render: (row) =>
        muted(row, row.durationMs === null ? '—' : `${Math.round(row.durationMs / 100) / 10}s`),
    },
    {
      id: 'download',
      header: '',
      // Present-but-disabled for a read-only administrator (US6 AS-7): the file
      // exists and they may not have it, which is a fact worth stating rather
      // than an affordance worth hiding.
      render: (row) =>
        row.artefact ? (
          <a
            href={productFeedsClient.runArtefactUrl(feed.id, row.id)}
            aria-label={t('runs.detail.download')}
            title={writeTitle ?? t('runs.detail.download')}
            aria-disabled={!canWrite}
            className={`inline-flex justify-end ${canWrite ? '' : 'pointer-events-none opacity-50'}`}
          >
            <Download size={14} aria-hidden="true" />
          </a>
        ) : null,
    },
  ];

  const lastFailed = feed.lastRun?.status === 'failed';

  return (
    <div>
      <PageHeader
        title={feed.name}
        description={`${feed.salesChannelCode} · ${feed.languageCode} · ${feed.currencyCode}`}
        back={{ label: t('page.title'), to: '/product-feeds' }}
        actions={
          <Button
            onClick={() => void generate()}
            disabled={!canWrite || feed.isRunning || !feed.enabled || busy}
            title={writeTitle}
          >
            <Play size={16} aria-hidden="true" />
            {t('feeds.action.generate')}
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {lastFailed && (
        // The degraded-configuration alert: state the failure AND that the
        // previously published file keeps serving, so the operator knows
        // whether this is an emergency.
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            {feed.lastRun?.failureCode ? t(`runs.failure.${feed.lastRun.failureCode}`) : ''}{' '}
            {feed.publishedArtefactId ? t('runs.failed.previousServed') : ''}
          </AlertDescription>
        </Alert>
      )}

      <div className="b2b-tabs-scroll mb-4">
        <div className="b2b-tabs" role="tablist">
          {(['overview', 'runs', 'settings'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`b2b-tab ${tab === id ? 'b2b-tab--active' : ''}`}
              onClick={() => setTab(id)}
            >
              {t(`feeds.tab.${id}`)}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <FeedLinkCard
          feed={feed}
          issuedToken={issuedToken}
          onChanged={(issued) => {
            setIssuedToken(issued);
            void load();
          }}
        />
      )}

      {tab === 'runs' && (
        <ResponsiveTable
          columns={runColumns}
          data={runs}
          keyExtractor={(row) => row.id}
          emptyState={
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="font-medium">{t('feeds.runs.empty.title')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('feeds.runs.empty.subtitle')}</p>
            </div>
          }
        />
      )}

      {tab === 'settings' && <FeedSettingsForm feed={feed} onSaved={setFeed} />}
    </div>
  );
}
