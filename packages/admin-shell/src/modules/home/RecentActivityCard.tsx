import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { cn } from '@endora-commerce/admin-kit/lib';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@endora-commerce/admin-kit/ui';
import {
  useRecentActivity,
  type RecentActivityItem,
} from './useRecentActivity.js';
import { formatRelative, renderActivity } from './activity-render.js';
import { MINI_ROW, MINI_ROW_LINK } from './mini-row.js';

/**
 * Feature 024 — Recent Activity card on the admin home dashboard.
 *
 * Reads the curated `/api/v1/admin/audit-log/recent-activity` feed via
 * `useRecentActivity()` and renders one row per audit entry with:
 *   - the action's icon + a localized verb, both declared by the module that
 *     owns the action and carried on the row (feature 080, T042j / D-163.1) —
 *     the verb is resolved in that module's own i18n namespace, which is what
 *     lets a packaged module's activity render in the operator's language
 *   - the resolved actor display name (with optional "(as customer)")
 *   - the resolved target display name + click-through link
 *   - a relative timestamp pill
 *
 * Handles four surface states: loading skeleton, empty, error+retry,
 * forbidden (renders nothing — FR-031).
 */

const ROW_PLACEHOLDER_COUNT = 4;

export function RecentActivityCard(): ReactNode {
  const t = useTranslation('core');
  // The verb key belongs to the declaring module's namespace, not to `core`, so
  // the row needs the scope-taking `t` as well as the card's own.
  const { t: translateIn } = useTranslationContext();
  const { status, items, refetch } = useRecentActivity();

  // FR-031 — admins without `audit_log:read` see no card at all.
  if (status === 'forbidden') return null;

  return (
    <Card flush data-testid="recent-activity-card">
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>{t('home.recentActivity.title')}</CardTitle>
          <CardDescription>{t('home.recentActivity.subtitle')}</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/audit-log">{t('home.activity.viewAll')}</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {status === 'loading' && <LoadingSkeleton />}
        {status === 'error' && (
          <div className="flex items-center justify-between gap-3 p-4 text-sm text-muted-foreground" role="alert">
            <span>{t('home.activity.error')}</span>
            <Button type="button" variant="outline" size="sm" onClick={refetch}>
              {t('home.activity.retry')}
            </Button>
          </div>
        )}
        {status === 'ready' && items.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">{t('home.activity.empty')}</p>
        )}
        {status === 'ready' && items.length > 0 && (
          <div className="flex flex-col p-1">
            {items.map((row) => (
              <ActivityRow key={row.id} row={row} t={t} translateIn={translateIn} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({
  row,
  t,
  translateIn,
}: {
  row: RecentActivityItem;
  t: (key: string, params?: Record<string, string | number>) => string;
  translateIn: (
    scope: string,
    key: string,
    params?: Record<string, string | number>,
  ) => string;
}): ReactNode {
  const rendering = renderActivity(row);
  const Icon = rendering.icon;
  const verb = translateIn(rendering.scope, rendering.verbKey);
  const time = formatRelative(row.actedAt);
  const timeLabel = t(time.key, time.params);

  // Feature 024 / US3 — a small native tooltip for bulk-summary rows so
  // the admin can see counts on hover without rendering raw JSON.
  // Composed as human-readable "key: value" pairs.
  const summaryTooltip = row.summary
    ? Object.entries(row.summary)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join(' · ')
    : undefined;

  // Compose the visible row text in two pieces so the actor stays
  // visually distinct from the verb + target without forcing the i18n
  // bundle to carry HTML.
  const inner = (
    <>
      <span
        aria-hidden="true"
        className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--surface-sunken)] text-muted-foreground"
      >
        <Icon size={13} />
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <b>
          {row.actorKind === 'customer'
            ? t('home.activity.actor.customer', { name: row.actorDisplayName })
            : row.actorDisplayName}
        </b>{' '}
        {verb} <span className="font-mono">{row.targetDisplayName}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{timeLabel}</span>
    </>
  );

  if (row.targetUrl) {
    return (
      <Link
        to={row.targetUrl}
        className={cn(MINI_ROW, MINI_ROW_LINK)}
        data-testid="recent-activity-row"
        {...(summaryTooltip ? { title: summaryTooltip } : {})}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div
      className={cn(MINI_ROW, 'cursor-default opacity-70')}
      data-testid="recent-activity-row"
      data-disabled="true"
      {...(summaryTooltip ? { title: summaryTooltip } : {})}
    >
      {inner}
    </div>
  );
}

function LoadingSkeleton(): ReactNode {
  const t = useTranslation('core');
  return (
    <div className="flex flex-col p-1" data-testid="recent-activity-loading" aria-busy="true">
      <span className="sr-only">{t('common.state.loading')}</span>
      {Array.from({ length: ROW_PLACEHOLDER_COUNT }).map((_, idx) => (
        <div key={idx} className={MINI_ROW} aria-hidden="true">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-2.5 w-[70%]" />
            <Skeleton className="h-2 w-[40%]" />
          </div>
          <Skeleton className="h-2.5 w-9 shrink-0" />
        </div>
      ))}
    </div>
  );
}
