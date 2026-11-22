import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiClient, formatDateTime, formatMoney } from '@endora-commerce/admin-kit/lib';
import { EditorSection } from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { cartStatusLabels, orderStatusName, quoteRequestStatusLabels } from '../lib/labels.js';

/** Generic read-only fetch-on-mount section for the customer detail's Activity tab. */
function usePanelData<T>(path: string, enabled: boolean): { rows: T[]; loading: boolean; error: string | null } {
  const t = useTranslation('customers');
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: T[] }>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('detail.panel.error'));
    } finally {
      setLoading(false);
    }
  }, [path, enabled, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, loading, error };
}

interface OrderRow {
  id: string;
  businessId: string;
  status: string;
  /** The status's name per language, as the orders list row carries it. */
  statusName?: Record<string, string>;
  total: number;
  currency: string;
  placedAt: string;
}

export function OrdersPanel({ customerId }: { customerId: string }): ReactNode {
  const t = useTranslation('customers');
  const { language } = useTranslationContext();
  const { rows, loading, error } = usePanelData<OrderRow>(
    `/api/v1/admin/customers/${customerId}/orders`,
    true,
  );
  return (
    <EditorSection title={t('detail.orders.title')}>
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('detail.panel.loading')}</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.orders.empty')}</p>
        ) : (
          <ul className="divide-y text-sm">
            {rows.map((o) => (
              <li key={o.id} className="flex justify-between py-2">
                <Link
                  to={`/orders/${o.id}`}
                  className="font-mono underline underline-offset-2"
                >
                  {o.businessId}
                </Link>
                <span>{orderStatusName(o, language)}</span>
                <span>
                  {o.total} {o.currency}
                </span>
                <span className="text-muted-foreground">{formatDateTime(o.placedAt, language)}</span>
              </li>
            ))}
          </ul>
        )}
    </EditorSection>
  );
}

interface RfqRow {
  id: string;
  businessId?: string;
  status: string;
  createdAt?: string;
  submittedAt?: string | null;
}

export function QuoteRequestsPanel({ customerId }: { customerId: string }): ReactNode {
  const t = useTranslation('customers');
  const { rows, loading, error } = usePanelData<RfqRow>(
    `/api/v1/admin/customers/${customerId}/quote-requests`,
    true,
  );
  return (
    <EditorSection title={t('detail.rfqs.title')}>
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('detail.panel.loading')}</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.rfqs.empty')}</p>
        ) : (
          <ul className="divide-y text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex justify-between py-2">
                <Link
                  to={`/quote-requests/${r.id}`}
                  className="font-mono text-xs underline underline-offset-2"
                >
                  {r.businessId ?? r.id.slice(0, 8)}
                </Link>
                <span>{quoteRequestStatusLabels.label(t, r.status)}</span>
              </li>
            ))}
          </ul>
        )}
    </EditorSection>
  );
}

interface CartLine {
  productId: string;
  quantity: number;
  unitPrice: string;
  currency: string;
}
interface CartView {
  id: string;
  status: string;
  items: CartLine[];
}
interface CartsData {
  current: CartView | null;
  abandoned: CartView[];
}

export function CartsPanel({ customerId }: { customerId: string }): ReactNode {
  const t = useTranslation('customers');
  const [data, setData] = useState<CartsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const res = await apiClient.get<{ data: CartsData }>(`/api/v1/admin/customers/${customerId}/carts`);
      setData(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('detail.panel.error'));
    }
  }, [customerId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Issue #1517 — rows divided by a rule inside the section, not a bordered box per cart
  // (Common Region: a frame inside a card reads as a separate object).
  const renderCart = (c: CartView): ReactNode => (
    <li key={c.id} className="py-3 first:pt-0 last:pb-0">
      <p className="mb-2 text-xs text-muted-foreground">
        {cartStatusLabels.label(t, c.status)} · {c.items.length} {t('detail.carts.items')}
      </p>
      <ul className="text-sm">
        {c.items.map((it, i) => (
          <li key={`${c.id}-${i}`} className="flex justify-between py-1">
            <span className="font-mono text-xs">{it.productId.slice(0, 8)}</span>
            <span>× {it.quantity}</span>
            {/* A unit price: its significant places, up to four (owner ruling of 2026-10-25). */}
            <span>{formatMoney(Number(it.unitPrice), it.currency, undefined, { unitPrice: true })}</span>
          </li>
        ))}
      </ul>
    </li>
  );

  return (
    <EditorSection title={t('detail.carts.title')}>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">{t('detail.panel.loading')}</p>
        ) : (
          <>
            {data.current ? null : <p className="text-sm text-muted-foreground">{t('detail.carts.noCurrent')}</p>}
            {data.current !== null || data.abandoned.length > 0 ? (
              <ul className="divide-y divide-border">
                {data.current ? renderCart(data.current) : null}
                {data.abandoned.map(renderCart)}
              </ul>
            ) : null}
          </>
        )}
    </EditorSection>
  );
}
