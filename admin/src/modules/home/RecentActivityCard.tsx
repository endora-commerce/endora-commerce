import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '@/i18n/useTranslation';
import {
  useRecentActivity,
  type RecentActivityItem,
} from './useRecentActivity';
import { formatRelative, renderActivity } from './activity-render';

/**
 * Feature 024 — Recent Activity card on the admin home dashboard.
 *
 * Reads the curated `/api/v1/admin/audit-log/recent-activity` feed via
 * `useRecentActivity()` and renders one row per audit entry with:
 *   - the action's icon + a localized verb (action-catalog lookup)
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
  const { status, items, refetch } = useRecentActivity();

  // FR-031 — admins without `audit_log:read` see no card at all.
  if (status === 'forbidden') return null;

  return (
    <div className="b2b-card" data-testid="recent-activity-card">
      <div className="b2b-card__head">
        <div>
          <div className="b2b-card__title">{t('home.recentActivity.title')}</div>
          <div className="b2b-card__sub">{t('home.recentActivity.subtitle')}</div>
        </div>
        <Link to="/audit-logs" className="b2b-btn b2b-btn--ghost b2b-btn--sm">
          {t('home.activity.viewAll')}
        </Link>
      </div>
      <div className="b2b-card__body b2b-card__body--flush">
        {status === 'loading' && <LoadingSkeleton />}
        {status === 'error' && (
          <div
            className="b2b-help"
            style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
            role="alert"
          >
            <span>{t('home.activity.error')}</span>
            <button
              type="button"
              className="b2b-btn b2b-btn--default b2b-btn--sm"
              onClick={refetch}
            >
              {t('home.activity.retry')}
            </button>
          </div>
        )}
        {status === 'ready' && items.length === 0 && (
          <div className="b2b-help" style={{ padding: 16 }}>
            {t('home.activity.empty')}
          </div>
        )}
        {status === 'ready' && items.length > 0 && (
          <div className="b2b-minilist" style={{ padding: 4 }}>
            {items.map((row) => (
              <ActivityRow key={row.id} row={row} t={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityRow({
  row,
  t,
}: {
  row: RecentActivityItem;
  t: (key: string, params?: Record<string, string | number>) => string;
}): ReactNode {
  const rendering = renderActivity(row.action);
  const Icon = rendering.icon;
  const verb = t(rendering.verbKey);
  const time = formatRelative(row.actedAt);
  const timeLabel = t(time.key, time.params);

  // Compose the visible row text in two pieces so the actor stays
  // visually distinct from the verb + target without forcing the i18n
  // bundle to carry HTML.
  const inner = (
    <>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: 'var(--surface-sunken)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--fg-muted)',
          flexShrink: 0,
        }}
      >
        <Icon size={13} />
      </div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
        <b>{row.actorDisplayName}</b> {verb}{' '}
        <span className="b2b-mono">{row.targetDisplayName}</span>
      </div>
      <span className="b2b-muted" style={{ fontSize: 11, flexShrink: 0 }}>
        {timeLabel}
      </span>
    </>
  );

  if (row.targetUrl) {
    return (
      <Link
        to={row.targetUrl}
        className="b2b-minirow"
        style={{ textDecoration: 'none', color: 'inherit' }}
        data-testid="recent-activity-row"
      >
        {inner}
      </Link>
    );
  }

  return (
    <div
      className="b2b-minirow"
      style={{ opacity: 0.7, cursor: 'default' }}
      data-testid="recent-activity-row"
      data-disabled="true"
    >
      {inner}
    </div>
  );
}

function LoadingSkeleton(): ReactNode {
  return (
    <div className="b2b-minilist" style={{ padding: 4 }} data-testid="recent-activity-loading">
      {Array.from({ length: ROW_PLACEHOLDER_COUNT }).map((_, idx) => (
        <div key={idx} className="b2b-minirow" style={{ opacity: 0.6 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'var(--surface-sunken)',
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1 }}>
            <div
              style={{
                height: 10,
                width: '70%',
                background: 'var(--surface-sunken)',
                borderRadius: 4,
              }}
            />
            <div
              style={{
                height: 8,
                width: '40%',
                background: 'var(--surface-sunken)',
                borderRadius: 4,
                marginTop: 6,
              }}
            />
          </div>
          <span
            style={{
              width: 36,
              height: 10,
              background: 'var(--surface-sunken)',
              borderRadius: 4,
              flexShrink: 0,
            }}
          />
        </div>
      ))}
    </div>
  );
}
