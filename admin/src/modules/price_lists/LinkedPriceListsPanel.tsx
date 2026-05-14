import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CircleDollarSign, Star } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';
import { DisplayModeOverrideRow } from './DisplayModeOverrideRow';

type PriceListType = 'base' | 'sale';
type PriceListStatus = 'draft' | 'active' | 'scheduled' | 'expired';

export interface LinkedPriceListRow {
  list: {
    id: string;
    name: string;
    type: PriceListType;
    status: PriceListStatus;
    modifiedAt: string;
  };
  summary: Array<{ currencyCode: string; summary: string }>;
  deepLinkPath: string;
}

const STATUS_BADGE: Record<PriceListStatus, string> = {
  draft: 'b2b-badge b2b-badge--outline',
  active: 'b2b-badge b2b-badge--success',
  scheduled: 'b2b-badge b2b-badge--info',
  expired: 'b2b-badge b2b-badge--muted',
};


/**
 * LinkedPriceListsPanel (US8 / T096) — Pricing tab on the admin
 * product editor.
 *
 * Read-only: lists every price list the product is part of with the
 * per-currency bracket summary and a deep link into the corresponding
 * editor (`/price-lists/:id?focus=:productId`). Brackets and rules are
 * edited on the price-list editor — this panel is just the index.
 *
 * The deep-link path returned by the backend points at
 * `/admin/price-lists/...`; the admin SPA routes the same view at
 * `/price-lists/...`, so we strip the `/admin` prefix when navigating
 * within the React Router tree.
 */
export function LinkedPriceListsPanel({ productId }: { productId: string }): ReactNode {
  const t = useTranslation('core');
  const [rows, setRows] = useState<LinkedPriceListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .get<{ data: { items: LinkedPriceListRow[] } }>(
        `/api/v1/admin/products/${encodeURIComponent(productId)}/price-lists`,
      )
      .then((res) => {
        if (!cancelled) setRows(res.data.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.linked.error.load'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [productId, t]);

  if (loading) {
    return <div style={{ padding: 16, color: 'var(--fg-muted)', fontSize: 13 }}>{t('priceLists.linked.loading')}</div>;
  }

  if (error) {
    return (
      <div
        className="b2b-card"
        style={{
          padding: 12,
          background: 'var(--danger-soft)',
          color: 'var(--danger-soft-fg)',
          border: '1px solid hsl(8 80% 85%)',
          fontSize: 12,
        }}
      >
        {error}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        className="b2b-card"
        style={{
          padding: 16,
          background: 'var(--info-soft)',
          border: '1px solid hsl(217 70% 88%)',
        }}
      >
        <div className="b2b-row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <CircleDollarSign size={18} style={{ color: 'var(--info-soft-fg)', marginTop: 2 }} />
          <div className="b2b-grow">
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--info-soft-fg)' }}>
              {t('priceLists.linked.emptyTitle')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--info-soft-fg)', marginTop: 4 }}>
              {t('priceLists.linked.emptyDescription')}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="b2b-col" style={{ gap: 16 }}>
      <div className="b2b-card" style={{ padding: 12 }}>
        <DisplayModeOverrideRow
          scope="product"
          targetId={productId}
          label={t('priceLists.linked.displayModeLabel')}
          inheritHint={t('priceLists.linked.displayModeHint')}
        />
      </div>
      <LinkedPriceListsList rows={rows} />
    </div>
  );
}

/**
 * Pure render of the linked-list table — split out so it can be unit
 * tested via renderToString without booting the data-fetch effect.
 */
export function LinkedPriceListsList({ rows }: { rows: LinkedPriceListRow[] }): ReactNode {
  const t = useTranslation('core');
  const STATUS_LABEL: Record<PriceListStatus, string> = {
    draft: t('priceLists.status.draft'),
    active: t('priceLists.status.active'),
    scheduled: t('priceLists.status.scheduled'),
    expired: t('priceLists.status.expired'),
  };
  return (
    <>
      <div className="b2b-help">
        {t('priceLists.linked.helpText')}
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {rows.map((r) => {
          const looksDefault = r.list.name === 'Default';
          const internalPath = toInternalPath(r.deepLinkPath);
          return (
            <li
              key={r.list.id}
              className="b2b-card"
              data-testid="linked-price-list-row"
              data-list-id={r.list.id}
              style={{
                padding: 12,
                marginBottom: 8,
                display: 'grid',
                gridTemplateColumns: '32px 1fr auto',
                gap: 12,
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  background: looksDefault ? 'var(--primary-soft)' : 'var(--surface-sunken)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                {looksDefault ? (
                  <Star size={14} style={{ color: 'var(--primary-color)' }} />
                ) : (
                  <CircleDollarSign size={14} style={{ color: 'var(--fg-muted)' }} />
                )}
              </div>
              <div>
                <div className="b2b-row" style={{ gap: 6, alignItems: 'center' }}>
                  <Link
                    to={internalPath}
                    style={{ fontSize: 13, fontWeight: 500, color: 'inherit', textDecoration: 'none' }}
                  >
                    {r.list.name}
                  </Link>
                  <span className="b2b-badge b2b-badge--outline">
                    {r.list.type === 'base' ? t('priceLists.type.base') : t('priceLists.type.sale')}
                  </span>
                  <span className={STATUS_BADGE[r.list.status]}>{STATUS_LABEL[r.list.status]}</span>
                  {looksDefault ? (
                    <span
                      className="b2b-badge b2b-badge--success"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      {t('priceLists.linked.system')}
                    </span>
                  ) : null}
                </div>
                {r.summary.length > 0 ? (
                  <div className="b2b-help" style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {r.summary.map((s) => (
                      <span
                        key={s.currencyCode}
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          color: 'var(--fg-muted)',
                        }}
                      >
                        <strong style={{ color: 'var(--fg-default)' }}>{s.currencyCode}</strong>{' '}
                        {s.summary}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="b2b-help" style={{ marginTop: 4 }}>
                    {t('priceLists.linked.noBracketsYet')}
                  </div>
                )}
              </div>
              <Link
                to={internalPath}
                className="b2b-btn b2b-btn--default b2b-btn--sm"
                title={t('priceLists.linked.openEditor')}
              >
                {t('priceLists.linked.open')} <ArrowUpRight size={12} />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * Backend returns `/admin/price-lists/<id>/products?focus=<pid>`; the admin
 * SPA routes the same view at `/price-lists/<id>?focus=<pid>` — strip the
 * `/admin` prefix and the `/products` suffix to keep the route table simple.
 */
export function toInternalPath(deepLink: string): string {
  let path = deepLink;
  if (path.startsWith('/admin/')) path = path.slice('/admin'.length);
  path = path.replace('/products?', '?');
  return path;
}
