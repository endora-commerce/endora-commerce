import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ApiError, apiClient, formatDateTime, formatMoney } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Label,
  PageHeader,
  Select,
} from '@endora-commerce/admin-kit/ui';
import { ResponsiveTable } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { cartApprovalStatusLabels, cartStatusLabels } from '../lib/labels.js';

/**
 * CartsList (feature 027 US6).
 *
 * Paginated platform-wide list of carts. Mirrors the OrdersList pattern.
 * Filters: status, approvalStatus. Sort: lastActivityAt desc by default.
 *
 * Browser-verification note: layout and filter interaction need eyes;
 * the data-flow is plain fetch + filter, RTL coverage would be limited.
 */

interface AdminCartRow {
  id: string;
  ownerCustomerAccountId: string | null;
  ownerDisplayName: string | null;
  organizationId: string | null;
  organizationDisplayName: string | null;
  salesChannelCode: string | null;
  status: 'active' | 'abandoned' | 'completed' | 'rejected';
  approvalStatus: 'not_required' | 'pending' | 'approved' | 'rejected_by_org_admin';
  itemCount: number;
  total: { amount: number; currency: string };
  appliedPromotionCode: string | null;
  lastActivityAt: string;
  createdAt: string;
}


const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  active: 'default',
  abandoned: 'warning',
  completed: 'success',
  rejected: 'destructive',
};

const APPROVAL_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  not_required: 'secondary',
  pending: 'warning',
  approved: 'success',
  rejected_by_org_admin: 'destructive',
};

export default function CartsList(): ReactNode {
  const t = useTranslation('carts');
  const [rows, setRows] = useState<AdminCartRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | (typeof cartStatusLabels.values)[number]>('');
  const [approvalFilter, setApprovalFilter] = useState<'' | (typeof cartApprovalStatusLabels.values)[number]>('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (approvalFilter) params.set('approvalStatus', approvalFilter);
      const qs = params.toString();
      const res = await apiClient.get<{ data: AdminCartRow[] }>(
        `/api/v1/admin/carts${qs ? `?${qs}` : ''}`,
      );
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load carts.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, approvalFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <PageHeader
        title={t('carts.page.title')}
        description={t('carts.page.description')}
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 md:max-w-xl">
            <div className="space-y-2">
              <Label htmlFor="cstatus">{t('carts.column.status')}</Label>
              <Select
                id="cstatus"
                value={statusFilter}
                onChange={(e): void => setStatusFilter(e.target.value as typeof statusFilter)}
              >
                <option value="">{t('carts.filter.all')}</option>
                {cartStatusLabels.options(t).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="capproval">{t('carts.column.approval')}</Label>
              <Select
                id="capproval"
                value={approvalFilter}
                onChange={(e): void => setApprovalFilter(e.target.value as typeof approvalFilter)}
              >
                <option value="">{t('carts.filter.all')}</option>
                {cartApprovalStatusLabels.options(t).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('carts.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('carts.empty')}</p>
          ) : (
            <ResponsiveTable
              data={rows}
              keyExtractor={(c) => c.id}
              columns={[
                {
                  // Issue #1477 — a cart has no business ID, and the UUID
                  // prefix this column used to lead with told the operator
                  // nothing. The owner is what they recognise.
                  id: 'owner',
                  header: t('carts.column.owner'),
                  primary: true,
                  render: (c) => (
                    <Link to={`/carts/${c.id}`} className="font-medium underline underline-offset-2">
                      {c.ownerDisplayName ?? t('carts.owner.anonymous')}
                    </Link>
                  ),
                  meta: (c) => formatDateTime(c.lastActivityAt),
                },
                {
                  id: 'org',
                  header: t('carts.column.org'),
                  hideOnMobile: true,
                  render: (c) => (
                    <span className="text-xs text-muted-foreground">
                      {c.organizationDisplayName ?? '—'}
                    </span>
                  ),
                },
                {
                  id: 'status',
                  header: t('carts.column.status'),
                  render: (c) => (
                    <Badge variant={STATUS_VARIANT[c.status] ?? 'secondary'}>{cartStatusLabels.label(t, c.status)}</Badge>
                  ),
                },
                {
                  id: 'approval',
                  header: t('carts.column.approval'),
                  render: (c) => (
                    <Badge variant={APPROVAL_VARIANT[c.approvalStatus] ?? 'secondary'}>
                      {cartApprovalStatusLabels.label(t, c.approvalStatus)}
                    </Badge>
                  ),
                },
                {
                  id: 'total',
                  header: t('carts.column.total'),
                  render: (c) => (
                    <span className="tabular-nums">
                      {formatMoney(c.total.amount, c.total.currency)}
                    </span>
                  ),
                  meta: (c) => t('carts.itemCount', { count: c.itemCount }),
                },
              ]}
              renderActions={(c) => (
                <Button asChild variant="outline" size="sm" className="min-h-11">
                  <Link to={`/carts/${c.id}`}>
                    {t('carts.open')}
                    <ArrowRight />
                  </Link>
                </Button>
              )}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
