import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Pencil, Plus, Trash2 } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';
import { useAuth } from '@/lib/auth';

interface PromotionActionView {
  type: string;
  percent?: number;
  amount?: number;
  currency?: string;
  [k: string]: unknown;
}

/** Promotion attribute criterion summary used in the list view. */
interface AttributeCriterion {
  type: 'attribute';
  attributeKey: string;
  op: 'equals' | 'in' | 'range';
  values: unknown[];
}

interface AdminPromotion {
  id: string;
  code: string | null;
  name: string;
  // Feature 045 — null on action-based promotions.
  kind: 'percentage_off' | 'amount_off' | 'free_delivery' | null;
  value: number | null;
  currency: string | null;
  minCartSubtotal: number | null;
  validFrom: string | null;
  validUntil: string | null;
  criteria?: AttributeCriterion[];
  isActive: boolean;
  createdAt: string;
  // Feature 045 — engine fields.
  description?: string | null;
  priority?: number;
  stopFurther?: boolean;
  action?: PromotionActionView | null;
}

/** Human-readable summary of a promotion's effect (legacy kind or action). */
function describeEffect(p: AdminPromotion): string {
  if (p.action) {
    const a = p.action;
    if (a.type === 'percentage_off_cart') return `${a.percent}% off cart`;
    if (a.type === 'amount_off_cart') return `${a.amount} ${a.currency} off cart`;
    if (a.type === 'free_delivery') return 'Free delivery';
    return a.type;
  }
  if (p.kind === 'percentage_off') return `${p.value}%`;
  if (p.kind === 'amount_off') return `${p.value} ${p.currency ?? ''}`.trim();
  if (p.kind === 'free_delivery') return 'Free delivery';
  return '—';
}

export const PromotionsPage = (): ReactNode => {
  const t = useTranslation('core');
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('promotions:write');
  const canDelete = hasPermission('promotions:delete');
  const [rows, setRows] = useState<AdminPromotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminPromotion[] }>('/api/v1/admin/promotions');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('promotions.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm(t('promotions.deleteConfirm'))) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/promotions/${id}`);
        setInfo(null);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('promotions.error.delete'));
      }
    },
    [refresh, t],
  );

  return (
    <>
      <PageHeader
        title={t('promotions.page.title')}
        description={t('promotions.page.description')}
      />

      {canWrite ? (
        <div className="mb-4">
          <Button type="button" onClick={() => navigate('/promotions/new')}>
            <Plus /> {t('promotions.edit.titleNew')}
          </Button>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('promotions.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('promotions.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('promotions.column.code')}</TableHead>
                  <TableHead>{t('promotions.column.name')}</TableHead>
                  <TableHead>{t('promotions.column.kind')}</TableHead>
                  <TableHead>{t('promotions.column.value')}</TableHead>
                  <TableHead>{t('promotions.column.minCart')}</TableHead>
                  <TableHead>{t('promotions.column.valid')}</TableHead>
                  <TableHead>{t('promotions.column.criteria')}</TableHead>
                  <TableHead>{t('promotions.column.active')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <code className="font-mono text-xs">{p.code ?? '—'}</code>
                    </TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.action ? p.action.type : (p.kind ?? '—')}</TableCell>
                    <TableCell className="tabular-nums">{describeEffect(p)}</TableCell>
                    <TableCell className="tabular-nums">
                      {p.minCartSubtotal != null ? p.minCartSubtotal.toFixed(2) : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.validFrom ? formatDateTime(p.validFrom) : '—'}
                      {' → '}
                      {p.validUntil ? formatDateTime(p.validUntil) : '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.criteria && p.criteria.length > 0
                        ? p.criteria
                            .map(
                              (c) =>
                                `${c.attributeKey} ${c.op} [${c.values.map((v) => String(v)).join(', ')}]`,
                            )
                            .join('; ')
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.isActive ? 'success' : 'secondary'}>
                        {p.isActive ? t('promotions.active.yes') : t('promotions.active.no')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {canWrite ? (
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          className="mr-2"
                          onClick={() => navigate(`/promotions/${p.id}`)}
                        >
                          <Pencil />
                          {t('promotions.edit.titleEdit')}
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        className="mr-2"
                        onClick={() => navigate(`/promotions/${p.id}/stats`)}
                      >
                        <BarChart3 />
                        {t('promotionStats.title')}
                      </Button>
                      {canDelete ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          type="button"
                          onClick={(): void => void handleDelete(p.id)}
                        >
                          <Trash2 />
                          {t('promotions.action.delete')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
};
