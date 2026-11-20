import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { ApiError, apiClient, useSurfaceVisibility } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
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

  return (
    <div className="b2b-page b2b-page--wide">
      <PageHeader title={t('inventory.lowStock.title')} description={t('inventory.lowStock.description')} />

      {/* Issue #1492 (CAT-17): a failure is a kit Alert (role="alert"), not a card painted red. */}
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card flush>
        <CardContent>
          {loading ? (
            <p role="status" className="p-8 text-sm text-muted-foreground">
              {t('inventory.loading')}
            </p>
          ) : rows.length === 0 ? (
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
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('inventory.column.product')}</TableHead>
                  <TableHead>{t('inventory.column.sku')}</TableHead>
                  <TableHead className="text-right">{t('inventory.column.cumulativeOnHand')}</TableHead>
                  <TableHead className="text-right">{t('inventory.column.threshold')}</TableHead>
                  <TableHead className="w-[1%]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.productId}>
                    <TableCell>{r.productName}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.productSku}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {r.cumulativeOnHand.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.lowStockThreshold.toLocaleString()}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {/* Edit *stock*: the Inventory tab, as the inventory list's rows do. */}
                      <Button asChild variant="ghost" size="sm">
                        <Link to={productInventoryHref(r.productId)}>{t('inventory.action.editStock')}</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default LowStockPage;
