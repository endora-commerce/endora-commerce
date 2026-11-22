import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { ApiError, apiClient, useSurfaceVisibility } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ListPage, ResponsiveTable, type ListPageLoad } from '@endora-commerce/admin-kit/components';
import { Button, EmptyState } from '@endora-commerce/admin-kit/ui';
import { productInventoryHref } from '../lib/labels.js';
interface LowStockRow {
  productId: string;
  productSku: string;
  productName: string;
  cumulativeOnHand: number;
  lowStockThreshold: number;
}

interface LowStockResponse {
  items: LowStockRow[];
}

/**
 * LowStockPage — feature 010 / US4 (T054).
 *
 * Lists every product whose cumulative on-hand has reached or fallen
 * below its `lowStockThreshold`. Mirrors what the Home page Stock
 * Alerts panel surfaces but with no row cap.
 */
export function LowStockPage(): ReactNode {
  const t = useTranslation('core');
  // The screen's own gate (2026-08-29) — see `InventoryPage` for the reasoning
  // in full.
  const isVisible = useSurfaceVisibility();
  const canRead = isVisible({ module: 'inventory', requiredPermission: 'inventory:read' });
  const [rows, setRows] = useState<LowStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<LowStockResponse>('/api/v1/admin/inventory/low-stock');
      setRows(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('inventory.lowStock.error.load'));
    } finally {
      setLoading(false);
    }
  }, [canRead, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!canRead) {
    return <div className="b2b-page">{t('inventory.noPermission')}</div>;
  }

  const listLoad: ListPageLoad = error ? { kind: 'error', message: error } : loading ? { kind: 'loading' } : { kind: 'ready' };

  return (
    <div className="b2b-page b2b-page--wide">
      <ListPage
        title={t('inventory.lowStock.title')}
        description={t('inventory.lowStock.description')}
        count={t('inventory.lowStock.count', { count: rows.length })}
        load={listLoad}
        onRetry={(): void => void refresh()}
      >
        <ResponsiveTable
          data={rows}
          keyExtractor={(r) => r.productId}
          emptyState={
            <EmptyState
              icon={<AlertTriangle size={20} />}
              title={t('inventory.lowStock.empty')}
              description={
                <>
                  {t('inventory.lowStock.emptyHintPrefix')} <code className="font-mono">lowStockThreshold</code>{' '}
                  {t('inventory.lowStock.emptyHintSuffix')}
                </>
              }
            />
          }
          columns={[
            { id: 'product', header: t('inventory.column.product'), primary: true, render: (r) => r.productName, meta: (r) => r.productSku },
            {
              id: 'sku',
              header: t('inventory.column.sku'),
              hideOnMobile: true,
              className: 'font-mono text-xs text-muted-foreground',
              render: (r) => r.productSku,
            },
            {
              id: 'onHand',
              header: t('inventory.column.cumulativeOnHand'),
              className: 'text-right font-semibold tabular-nums',
              render: (r) => r.cumulativeOnHand.toLocaleString(),
            },
            {
              id: 'threshold',
              header: t('inventory.column.threshold'),
              className: 'text-right tabular-nums',
              render: (r) => r.lowStockThreshold.toLocaleString(),
            },
          ]}
          renderActions={(r) => (
            // Edit *stock*: the Inventory tab, as the inventory list's rows do.
            <Button asChild variant="ghost" size="sm">
              <Link to={productInventoryHref(r.productId)}>{t('inventory.action.editStock')}</Link>
            </Button>
          )}
        />
      </ListPage>
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default LowStockPage;
