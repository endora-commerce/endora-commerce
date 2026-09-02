import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiClient, formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Card, CardContent, CardHeader, CardTitle } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/** Generic read-only fetch-on-mount panel for the customer-detail history views. */
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
  total: number;
  currency: string;
  placedAt: string;
}

export function OrdersPanel({ customerId }: { customerId: string }): ReactNode {
  const t = useTranslation('customers');
  const { rows, loading, error } = usePanelData<OrderRow>(
    `/api/v1/admin/customers/${customerId}/orders`,
    true,
  );
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('detail.orders.title')}</CardTitle>
      </CardHeader>
      <CardContent>
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
                <span>{o.status}</span>
                <span>
                  {o.total} {o.currency}
                </span>
                <span className="text-muted-foreground">{formatDateTime(o.placedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
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
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('detail.rfqs.title')}</CardTitle>
      </CardHeader>
      <CardContent>
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
                <span>{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
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

  const renderCart = (c: CartView): ReactNode => (
    <div key={c.id} className="rounded border p-3">
      <p className="mb-2 text-xs text-muted-foreground">
        {c.status} · {c.items.length} {t('detail.carts.items')}
      </p>
      <ul className="text-sm">
        {c.items.map((it, i) => (
          <li key={`${c.id}-${i}`} className="flex justify-between py-1">
            <span className="font-mono text-xs">{it.productId.slice(0, 8)}</span>
            <span>× {it.quantity}</span>
            <span>
              {it.unitPrice} {it.currency}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('detail.carts.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">{t('detail.panel.loading')}</p>
        ) : (
          <>
            {data.current ? renderCart(data.current) : (
              <p className="text-sm text-muted-foreground">{t('detail.carts.noCurrent')}</p>
            )}
            {data.abandoned.map(renderCart)}
          </>
        )}
      </CardContent>
    </Card>
  );
}
