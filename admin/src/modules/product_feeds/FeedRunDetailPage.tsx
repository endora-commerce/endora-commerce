import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Download } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useTranslation } from '@/i18n/useTranslation';
import {
  productFeedsClient,
  RUN_ISSUE_PAGE_LIMIT,
  type FeedRunDetail,
  type FeedRunIssueDto,
  type ProductFeedDto,
} from './api';
import { FeedStatusBadge } from './components/FeedStatusBadge';
import { RunIssueGroups } from './components/RunIssueGroups';

/**
 * Run detail — ux-design §2.4, FR-053, FR-054.
 *
 * The screen answers one question: *what happened, and what do I do about it?*
 * So it is a counts strip, then the skips grouped by reason, then the warnings
 * grouped by reason — in that order, because a skipped product is missing from
 * a provider's catalogue and a warning is not.
 *
 * The two sentences that carry the most weight are on the failure paths:
 * *"Your previous file is still being served"* on a failed run, and the
 * equivalent on an empty one. Without them a failed run reads like an outage;
 * with them it reads like a task.
 *
 * The template-state line in the header exists because an operator who edits a
 * template mid-morning has to be able to tell which field set produced the file
 * they are looking at (FR-076).
 */

/** The per-run issue cap's manifest default, for the overflow sentence. */
const ISSUE_CAP_HINT = 1000;

export function FeedRunDetailPage(): ReactNode {
  const t = useTranslation('product_feeds');
  const { feedId, runId } = useParams<{ feedId: string; runId: string }>();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('product_feeds:write');
  const writeTitle = canWrite ? undefined : t('permission.needWrite');

  const [feed, setFeed] = useState<ProductFeedDto | null>(null);
  const [run, setRun] = useState<FeedRunDetail | null>(null);
  const [issues, setIssues] = useState<FeedRunIssueDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!feedId || !runId) return;
    try {
      const [feedRes, runRes, issueRes] = await Promise.all([
        productFeedsClient.get(feedId),
        productFeedsClient.getRun(feedId, runId),
        productFeedsClient.listRunIssues(feedId, runId),
      ]);
      setFeed(feedRes.data);
      setRun(runRes.data);
      setIssues(issueRes.data);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('runs.detail.loadFailed'));
    }
  }, [feedId, runId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!run || !feed) {
    return (
      <div>
        <PageHeader
          title={t('runs.detail.title', { date: '' })}
          back={{ label: t('page.title'), to: `/product-feeds/${feedId ?? ''}` }}
        />
        {error !== null ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <p className="b2b-help">{t('feeds.criteria.counting')}</p>
        )}
      </div>
    );
  }

  const started = run.startedAt ?? run.createdAt;
  const hasSkips = issues.some((issue) => issue.severity === 'skip');
  const hasWarnings = issues.some((issue) => issue.severity === 'warning');
  // A full page back means rows exist that were never fetched. Saying so beats
  // a list that silently stops short of the count in the run summary.
  const issuesTruncated = issues.length >= RUN_ISSUE_PAGE_LIMIT;
  const failed = run.status === 'failed';

  const counts: Array<{ id: string; label: string; value: number }> = [
    { id: 'considered', label: t('runs.counts.considered'), value: run.consideredCount },
    { id: 'emitted', label: t('runs.counts.emitted'), value: run.emittedCount },
    { id: 'skipped', label: t('runs.counts.skipped'), value: run.skippedCount },
    { id: 'warnings', label: t('runs.counts.warnings'), value: run.warningCount },
  ];

  return (
    <div>
      <PageHeader
        title={t('runs.detail.title', { date: formatDateTime(started) })}
        description={`${t(`runs.trigger.${run.trigger}`)} · ${
          run.durationMs === null ? '—' : `${Math.round(run.durationMs / 100) / 10}s`
        } · ${t('runs.detail.templateState', {
          name: feed.feedTemplateName,
          date: formatDateTime(run.createdAt),
        })}`}
        back={{ label: feed.name, to: `/product-feeds/${feed.id}` }}
        actions={
          <a
            href={productFeedsClient.runArtefactUrl(feed.id, run.id)}
            // Present-but-disabled rather than hidden: a read-only operator has
            // to learn that the file exists and that they may not have it.
            className={`b2b-btn b2b-btn--outline inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
              canWrite && run.artefact ? '' : 'pointer-events-none opacity-50'
            }`}
            title={writeTitle}
            aria-disabled={!canWrite || !run.artefact}
          >
            <Download size={14} aria-hidden="true" />
            {t('runs.detail.download')}
          </a>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <FeedStatusBadge status={run.status} />
        {run.status === 'skipped' && run.skipReason ? (
          <span className="text-sm text-muted-foreground">
            {t(`runs.skipReason.${run.skipReason}`)}
          </span>
        ) : null}
      </div>

      {error !== null ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {failed ? (
        // The counts strip is replaced, not decorated: on a failed run the
        // numbers are noise and the reason is everything.
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex flex-col gap-1">
            <span>{run.failureCode ? t(`runs.failure.${run.failureCode}`) : ''}</span>
            {run.failureDetail ? (
              <span className="text-xs">{run.failureDetail}</span>
            ) : null}
            {feed.publishedArtefactId ? <span>{t('runs.failed.previousServed')}</span> : null}
          </AlertDescription>
        </Alert>
      ) : (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {counts.map((count) => (
            <div key={count.id} className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">{count.label}</p>
              <p className="text-2xl font-semibold tabular-nums">{count.value}</p>
            </div>
          ))}
        </div>
      )}

      {run.status === 'empty' ? (
        <Alert className="mb-4">
          <AlertDescription>{t('runs.empty.notice')}</AlertDescription>
        </Alert>
      ) : null}

      {!failed && !hasSkips && !hasWarnings ? (
        <div className="b2b-empty">
          <p className="b2b-empty__title flex items-center justify-center gap-2">
            <CheckCircle2 size={16} aria-hidden="true" />
            {t('runs.issues.none.title')}
          </p>
          <p className="b2b-empty__sub">{t('runs.issues.none.body')}</p>
        </div>
      ) : null}

      {hasSkips ? (
        <section className="mb-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">{t('runs.section.skips')}</h2>
            <a
              href={productFeedsClient.runIssueExportUrl(feed.id, run.id)}
              className={`text-sm underline underline-offset-2 ${
                canWrite ? '' : 'pointer-events-none opacity-50'
              }`}
              title={writeTitle}
              aria-disabled={!canWrite}
            >
              {t('runs.issues.export')}
            </a>
          </div>
          <RunIssueGroups
            issues={issues}
            severity="skip"
            overflow={run.issueOverflow}
            issueCapHint={ISSUE_CAP_HINT}
            truncated={issuesTruncated}
            pageLimit={RUN_ISSUE_PAGE_LIMIT}
          />
        </section>
      ) : null}

      {hasWarnings ? (
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">{t('runs.section.warnings')}</h2>
            {!hasSkips ? (
              <a
                href={productFeedsClient.runIssueExportUrl(feed.id, run.id)}
                className={`text-sm underline underline-offset-2 ${
                  canWrite ? '' : 'pointer-events-none opacity-50'
                }`}
                title={writeTitle}
                aria-disabled={!canWrite}
              >
                {t('runs.issues.export')}
              </a>
            ) : null}
          </div>
          <RunIssueGroups
            issues={issues}
            severity="warning"
            overflow={run.issueOverflow}
            issueCapHint={ISSUE_CAP_HINT}
            truncated={issuesTruncated}
            pageLimit={RUN_ISSUE_PAGE_LIMIT}
          />
        </section>
      ) : null}
    </div>
  );
}
