import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Info, Loader2 } from 'lucide-react';
import type { FeedTaxonomyCheck, FeedTaxonomyRevision, TaxonomyProviderCode } from '@endora-commerce/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { useAuth } from '@/lib/auth';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppLanguage } from '@/i18n/app-language-context';
import { feedTaxonomiesClient } from './taxonomy-api';
import { RevisionImpactDrawer } from './components/RevisionImpactDrawer';

/**
 * Taxonomy updates — ux-design §2.10, FR-078, FR-087, FR-094, FR-099.
 *
 * Four things in the operator's question order, not the data model's: **what is
 * waiting**, **what the mechanism is doing**, **every revision**, **what the
 * checks did** (Serial Position — the answer to "is there something for me to
 * decide?" comes first, and the audit history last).
 *
 * The rule that shapes the whole screen: **there is no `Promote` button outside
 * the impact drawer.** Every row action reads *Review…*. Making promotion
 * physically unreachable without passing through the preview is how the UI
 * enforces FR-094 rather than merely satisfying it.
 *
 * The off state — the one most installations are in — renders as a plain
 * informational panel, never as an error or a warning. Styling a supported
 * configuration as broken would train the operator to discount the real
 * warnings on the same screen, and FR-087 makes "off must not read as broken" a
 * functional requirement rather than a matter of taste. `Check now` is
 * **absent** there rather than disabled: the reason is already the largest text
 * on the screen, and a greyed button under it reads as *"this is broken"*.
 */

const PROVIDERS: readonly TaxonomyProviderCode[] = ['google_merchant', 'meta'];

/** The `ProductFeedDetailPage.tsx` precedent, for the same reason. */
const POLL_INTERVAL_MS = 5_000;

export function TaxonomyRevisionsPage(): ReactNode {
  const t = useTranslation('product_feeds');
  const navigate = useNavigate();
  const { language } = useAppLanguage();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('product_feeds:write');

  const [providerCode, setProviderCode] = useState<TaxonomyProviderCode>('google_merchant');
  const [revisions, setRevisions] = useState<FeedTaxonomyRevision[] | null>(null);
  const [checks, setChecks] = useState<FeedTaxonomyCheck[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<FeedTaxonomyRevision | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [checksOpen, setChecksOpen] = useState(false);
  const lastAnnouncedCheck = useRef<string | null>(null);

  const providerLabel = t(`revisions.provider.${providerCode}`);

  const load = useCallback(async (): Promise<void> => {
    setLoadFailed(false);
    try {
      const [revisionsRes, checksRes] = await Promise.all([
        feedTaxonomiesClient.listRevisions(providerCode),
        feedTaxonomiesClient.listChecks(providerCode),
      ]);
      setRevisions(revisionsRes.data);
      setChecks(checksRes.data);
    } catch {
      setLoadFailed(true);
    }
  }, [providerCode]);

  useEffect(() => {
    setRevisions(null);
    setRefused(null);
    void load();
  }, [load]);

  const inFlight = checks.some((check) => check.finishedAt === null);

  // Only while something is actually running: a screen that polls forever is a
  // screen nobody can leave open.
  useEffect(() => {
    if (!inFlight) return undefined;
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [inFlight, load]);

  // The outcome arrives from a poll, so it is invisible to a screen-reader user
  // unless it is spoken (ux-design §5.2).
  useEffect(() => {
    const newest = checks.find((check) => check.finishedAt !== null);
    if (!newest || newest.id === lastAnnouncedCheck.current) return;
    lastAnnouncedCheck.current = newest.id;
    if (newest.outcome === 'installed') {
      setAnnouncement(
        t('revisions.a11y.installed')
          .replace('{provider}', providerLabel)
          .replace('{revision}', revisionLabelOf(newest, revisions)),
      );
    } else if (newest.outcome === 'unchanged') {
      setAnnouncement(t('revisions.a11y.unchanged').replace('{provider}', providerLabel));
    } else if (newest.outcome) {
      setAnnouncement(
        t('revisions.a11y.failed')
          .replace('{provider}', providerLabel)
          .replace('{reason}', newest.detail ?? ''),
      );
    }
  }, [checks, revisions, providerLabel, t]);

  const current = useMemo(
    () => revisions?.find((revision) => revision.isCurrent) ?? null,
    [revisions],
  );
  const waiting = useMemo(
    () => revisions?.find((revision) => !revision.isCurrent && revision.promotedAt === null) ?? null,
    [revisions],
  );
  const lastFinishedCheck = checks.find((check) => check.finishedAt !== null) ?? null;

  // "Off" is inferred from the API's own refusal rather than from a settings
  // read this screen has no permission for: `product_feeds:*` does not imply
  // `settings:read`, and a screen that guesses is a screen that lies.
  const mechanismOff = refused !== null;

  async function startCheck(): Promise<void> {
    setStarting(true);
    setRefused(null);
    setAnnouncement(t('revisions.a11y.checkStarted').replace('{provider}', providerLabel));
    try {
      await feedTaxonomiesClient.startCheck(providerCode);
      await load();
    } catch (error) {
      const reason = (error as { details?: { reason?: string } } | null)?.details?.reason;
      if (reason === 'taxonomy_fetch_disabled') {
        setRefused(t('revisions.off.checkRefused').replace('{provider}', providerLabel));
      } else {
        setRefused((error as { message?: string } | null)?.message ?? t('revisions.loadFailed'));
      }
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="b2b-page space-y-4">
      <PageHeader
        title={t('revisions.title')}
        description={t('revisions.subtitle')}
        back={{ to: '/product-feeds/category-mapping', label: t('revisions.back') }}
      />

      {/* Always mounted: a live region created at the moment of its first
          message is never announced. */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>

      <div role="tablist" aria-label={t('revisions.title')} className="flex gap-2">
        {PROVIDERS.map((code) => (
          <button
            key={code}
            type="button"
            role="tab"
            aria-selected={providerCode === code}
            className={`rounded-md border px-3 py-1 text-sm ${
              providerCode === code ? 'border-primary bg-muted font-medium' : 'border-border'
            }`}
            onClick={(): void => setProviderCode(code)}
          >
            {t(`revisions.provider.${code}`)}
          </button>
        ))}
      </div>

      {loadFailed ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t('revisions.loadFailed')}{' '}
            <Button type="button" variant="outline" size="sm" onClick={(): void => void load()}>
              {t('revisions.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {mechanismOff ? (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="flex items-start gap-2">
              <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <h2 className="text-sm font-medium">{t('revisions.off.title')}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t('revisions.off.body')}</p>
              </div>
            </div>
            {/* The consent moment: what will be contacted is shown BEFORE the
                switch is reachable, not after (research §R24). */}
            <p className="text-sm">{t('revisions.off.urls.intro')}</p>
            <p className="text-sm">{t('revisions.off.urls.promise')}</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/settings?group=product_feeds_taxonomy">{t('revisions.off.cta')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-4">
            <p className="text-sm text-muted-foreground" aria-busy={inFlight}>
              {lastFinishedCheck
                ? t('revisions.status.lastCheck')
                    .replace('{ago}', formatDate(lastFinishedCheck.startedAt, language))
                    .replace('{outcome}', outcomeLabel(t, lastFinishedCheck, providerLabel))
                : t('revisions.status.neverChecked')}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canWrite || starting || inFlight}
                aria-busy={starting || inFlight}
                title={canWrite ? undefined : t('permission.needWrite')}
                onClick={(): void => void startCheck()}
              >
                {starting || inFlight ? (
                  <>
                    <Loader2 aria-hidden="true" className="mr-1 h-3 w-3 animate-spin" />
                    {t('revisions.checking')}
                  </>
                ) : (
                  t('revisions.checkNow')
                )}
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link to="/settings?group=product_feeds_taxonomy">{t('revisions.settings')}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {refused && !mechanismOff ? (
        <Alert variant="warning">
          <AlertDescription>{refused}</AlertDescription>
        </Alert>
      ) : null}

      {waiting ? (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <h2 className="text-sm font-medium">
              {t('revisions.available.title').replace('{provider}', providerLabel)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('revisions.available.body')
                .replace('{revision}', waiting.revision)
                .replace('{ago}', formatDate(waiting.installedAt, language))
                .replace('{count}', String(waiting.nodeCount))}
            </p>
            {/* The page's only filled button (Von Restorff): there is exactly
                one decision to make here. */}
            <Button type="button" onClick={(): void => setReviewing(waiting)}>
              {t('revisions.available.cta')}
            </Button>
          </CardContent>
        </Card>
      ) : current && !mechanismOff && lastFinishedCheck ? (
        <Alert>
          <AlertDescription>
            {t('revisions.upToDate.title').replace('{provider}', providerLabel)}{' '}
            {t('revisions.upToDate.body').replace(
              '{ago}',
              formatDate(lastFinishedCheck.startedAt, language),
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">{t('revisions.list.title')}</h2>
        {revisions === null ? (
          <div aria-hidden="true" className="space-y-2">
            <div className="h-8 animate-pulse rounded bg-muted" />
            <div className="h-8 animate-pulse rounded bg-muted" />
            <div className="h-8 animate-pulse rounded bg-muted" />
          </div>
        ) : revisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('revisions.empty').replace('{provider}', providerLabel)}
          </p>
        ) : (
          <ul role="list" className="divide-y divide-border rounded-md border border-border">
            {revisions.map((revision) => (
              <li
                key={revision.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <div>
                  <span className="font-medium">{revision.revision}</span>
                  <span className="ml-2 text-muted-foreground">
                    {revision.source === 'bundled'
                      ? t('revisions.source.bundled').replace(
                          '{date}',
                          formatDate(revision.installedAt, language),
                        )
                      : t('revisions.source.fetched').replace(
                          '{ago}',
                          formatDate(revision.fetchedAt ?? revision.installedAt, language),
                        )}
                    {' · '}
                    {t('revisions.nodeCount').replace('{count}', String(revision.nodeCount))}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Icon + word, never a coloured dot alone (WCAG 1.4.1). */}
                  <Badge variant={revision.isCurrent ? 'success' : 'outline'}>
                    {revision.isCurrent
                      ? t('revisions.badge.inUse')
                      : revision.supersededAt
                        ? t('revisions.badge.superseded')
                        : t('revisions.badge.notInUse')}
                  </Badge>
                  {revision.flags.includes('shrink') ? (
                    <Badge variant="warning">{t('revisions.badge.shrink')}</Badge>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(): void => setReviewing(revision)}
                  >
                    {t('revisions.review')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <button
          type="button"
          aria-expanded={checksOpen}
          className="text-sm font-medium underline-offset-2 hover:underline"
          onClick={(): void => setChecksOpen((value) => !value)}
        >
          {t('revisions.checks.title').replace('{count}', String(checks.length))}
        </button>
        {checksOpen ? (
          checks.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">{t('revisions.checks.empty')}</p>
          ) : (
            <ul role="list" className="mt-1 space-y-1 text-sm text-muted-foreground">
              {checks.map((check) => (
                <li key={check.id}>
                  <span className="text-foreground">
                    {formatDate(check.startedAt, language)}
                  </span>{' '}
                  · {t(`revisions.checks.trigger.${check.trigger}`)} ·{' '}
                  {check.finishedAt === null
                    ? t('revisions.checks.running').replace(
                        '{ago}',
                        formatDate(check.startedAt, language),
                      )
                    : outcomeLabel(t, check, providerLabel)}
                  {check.detail ? <span className="block">{check.detail}</span> : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>

      {reviewing ? (
        <RevisionImpactDrawer
          revision={reviewing}
          providerLabel={providerLabel}
          canWrite={canWrite}
          announce={setAnnouncement}
          onClose={(): void => setReviewing(null)}
          onPromoted={({ revision, staleCount }): void => {
            // The ending is the repair list, not a toast (Peak-End): the
            // operator lands where they can act on what they just did.
            navigate('/product-feeds/category-mapping', {
              state: { providerCode, review: 'stale', promoted: { revision, staleCount } },
            });
          }}
        />
      ) : null}
    </div>
  );
}

type Translate = (key: string) => string;

function outcomeLabel(t: Translate, check: FeedTaxonomyCheck, provider: string): string {
  if (!check.outcome) return '';
  const head = t(`checks.outcome.${check.outcome}`).replace('{provider}', provider);
  return check.reason ? `${head} (${check.reason})` : head;
}

function revisionLabelOf(
  check: FeedTaxonomyCheck,
  revisions: FeedTaxonomyRevision[] | null,
): string {
  const match = revisions?.find((revision) => revision.id === check.installedTaxonomyId);
  return match?.revision ?? '';
}

function formatDate(value: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(value));
  } catch {
    return value.slice(0, 10);
  }
}
