import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, MoreVertical, Play, Plus, Rss, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/ResponsiveTable';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { useTranslation } from '@/i18n/useTranslation';
import { productFeedsClient, type ProductFeedDto } from './api';
import { FeedSectionTabs } from './components/FeedSectionTabs';
import { FeedStatusBadge } from './components/FeedStatusBadge';

/**
 * Feed list — ux-design §2.1, FR-055.
 *
 * Three deliberate behaviours:
 *  - **Status is icon + word**, never colour alone, and a failed run shows its
 *    reason inline so the operator does not have to open the run to learn that
 *    the channel is missing.
 *  - **Polling only while something is in flight.** A run takes minutes, so a
 *    5-second poll while `isRunning` is true is the difference between "did my
 *    click do anything" and a dead screen; when nothing is running the page
 *    makes no requests at all.
 *  - **A read-only administrator sees every write control `disabled` with a
 *    `title` explaining why** (US6 AS-7) rather than a screen that silently
 *    lacks buttons they were told about.
 */

const POLL_INTERVAL_MS = 5_000;

export function ProductFeedsListPage(): ReactNode {
  const t = useTranslation('product_feeds');
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('product_feeds:write');

  const [feeds, setFeeds] = useState<ProductFeedDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await productFeedsClient.list();
      setFeeds(response.data);
      setError(null);
    } catch {
      setError(t('feeds.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while a run holds a feed. `window.setInterval` is cleared on both
  // the dependency change and unmount, so a navigation never leaves it running.
  const anyRunning = (feeds ?? []).some((f) => f.isRunning);
  useEffect(() => {
    if (!anyRunning) return undefined;
    pollRef.current = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [anyRunning, load]);

  const generate = async (feed: ProductFeedDto): Promise<void> => {
    setBusyId(feed.id);
    try {
      await productFeedsClient.generate(feed.id);
      await load();
    } catch {
      setError(t('feeds.loadFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (feed: ProductFeedDto): Promise<void> => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(t('feeds.delete.confirm'))) return;
    setBusyId(feed.id);
    try {
      await productFeedsClient.remove(feed.id);
      await load();
    } finally {
      setBusyId(null);
      setOpenMenuId(null);
    }
  };

  const columns: ResponsiveColumn<ProductFeedDto>[] = [
    {
      id: 'name',
      header: t('feeds.table.name'),
      primary: true,
      render: (row) => (
        <div className="flex flex-col">
          <Link to={`/product-feeds/${row.id}`} className="font-medium hover:underline">
            {row.name}
          </Link>
          {!row.enabled && (
            <span className="text-xs text-muted-foreground">{t('feeds.state.disabled')}</span>
          )}
        </div>
      ),
      meta: (row) => `${row.salesChannelCode} · ${row.languageCode}`,
    },
    {
      id: 'channel',
      header: t('feeds.table.channel'),
      hideOnMobile: true,
      render: (row) => row.salesChannelCode,
    },
    {
      id: 'template',
      header: t('feeds.table.template'),
      hideOnMobile: true,
      render: (row) => row.feedTemplateName,
    },
    {
      id: 'lastRun',
      header: t('feeds.table.lastRun'),
      render: (row) =>
        row.lastRun ? (
          <div className="flex flex-col gap-0.5">
            <FeedStatusBadge status={row.isRunning ? 'running' : row.lastRun.status} />
            <span className="text-xs text-muted-foreground">
              {row.lastRun.finishedAt ? formatDateTime(row.lastRun.finishedAt) : ''}
            </span>
            {row.lastRun.failureCode && (
              // The reason inline — an operator should not have to open a run to
              // learn that the channel went missing.
              <span className="text-xs text-destructive">
                {t(`runs.failure.${row.lastRun.failureCode}`)}
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">{t('feeds.table.never')}</span>
        ),
    },
    {
      id: 'items',
      header: t('feeds.table.items'),
      hideOnMobile: true,
      render: (row) => (row.publishedItemCount === null ? '—' : String(row.publishedItemCount)),
    },
    {
      id: 'nextRun',
      header: t('feeds.table.nextRun'),
      hideOnMobile: true,
      // FR-033 — the "runs may overlap" hint sits next to the next run rather
      // than in a separate column: it is a fact about this schedule, and an
      // operator reading "every 15 minutes" needs to see it in the same glance.
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span>{row.nextRunAt ? formatDateTime(row.nextRunAt) : t('feeds.table.manualOnly')}</span>
          {row.scheduleTooTightWarning && (
            <span className="text-xs" style={{ color: 'var(--warn)' }}>
              {t('feeds.table.scheduleTooTight')}
            </span>
          )}
        </div>
      ),
    },
  ];

  const writeTitle = canWrite ? undefined : t('permission.needWrite');

  return (
    <div>
      <PageHeader
        title={t('page.title')}
        description={t('page.subtitle')}
        actions={
          // The Templates button is gone: it is a tab now, so the header keeps
          // only the action that creates something.
          <Button
            onClick={() => navigate('/product-feeds/new')}
            disabled={!canWrite}
            title={writeTitle}
          >
            <Plus size={16} aria-hidden="true" />
            {t('page.newFeed')}
          </Button>
        }
      />

      <FeedSectionTabs />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              {t('feeds.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {feeds === null && !error ? (
        <div
          className="b2b-card p-8 text-center text-sm text-muted-foreground"
          aria-busy="true"
          aria-live="polite"
        >
          {t('feeds.table.status')}…
        </div>
      ) : (
        // Card + CardContent is what every other admin list uses (Orders,
        // Customers, Returns…). Bare, the table read as a different product —
        // and a bounded region is what makes the rows one group in the first
        // place (Law of Common Region).
        <Card>
          <CardContent className="pt-6">
            <ResponsiveTable
              columns={columns}
              data={feeds ?? []}
              keyExtractor={(row) => row.id}
              emptyState={
                <div className="b2b-empty">
                  <div className="b2b-empty__icon">
                    <Rss size={20} aria-hidden="true" />
                  </div>
                  <div className="b2b-empty__title">{t('feeds.empty.title')}</div>
                  <div className="b2b-empty__sub">{t('feeds.empty.subtitle')}</div>
                  <Button
                    className="mt-2"
                    onClick={() => navigate('/product-feeds/new')}
                    disabled={!canWrite}
                    title={writeTitle}
                  >
                    <Plus size={16} aria-hidden="true" />
                    {t('page.newFeed')}
                  </Button>
                </div>
              }
              renderActions={(row) => (
                <div className="relative flex items-center justify-end gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void generate(row)}
                    disabled={!canWrite || row.isRunning || !row.enabled || busyId === row.id}
                    title={writeTitle}
                  >
                    <Play size={14} aria-hidden="true" />
                    {t('feeds.action.generate')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-haspopup="menu"
                    aria-expanded={openMenuId === row.id}
                    aria-label={t('feeds.action.open')}
                    onClick={() => setOpenMenuId(openMenuId === row.id ? null : row.id)}
                  >
                    <MoreVertical size={16} aria-hidden="true" />
                  </Button>
                  {openMenuId === row.id && (
                    <div
                      role="menu"
                      className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border bg-popover p-1 shadow-md"
                    >
                      <Link
                        role="menuitem"
                        to={`/product-feeds/${row.id}`}
                        className="block rounded px-2 py-1.5 text-sm hover:bg-accent"
                        onClick={() => setOpenMenuId(null)}
                      >
                        {t('feeds.action.open')}
                      </Link>
                      <a
                        role="menuitem"
                        href={productFeedsClient.artefactUrl(row.id)}
                        className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent ${
                          canWrite && row.publishedArtefactId ? '' : 'pointer-events-none opacity-50'
                        }`}
                        title={writeTitle}
                      >
                        <Download size={14} aria-hidden="true" />
                        {t('feeds.action.download')}
                      </a>
                      {/* Delete last, after a separator — it is the only irreversible
                          entry in this menu. */}
                      <div className="my-1 h-px bg-border" role="separator" />
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-accent disabled:opacity-50"
                        onClick={() => void remove(row)}
                        disabled={!canWrite || busyId === row.id}
                        title={writeTitle}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        {t('feeds.action.delete')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
