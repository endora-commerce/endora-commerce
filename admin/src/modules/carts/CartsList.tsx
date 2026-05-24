import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';

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

const STATUSES = ['active', 'abandoned', 'completed', 'rejected'] as const;
const APPROVAL_STATUSES = ['not_required', 'pending', 'approved', 'rejected_by_org_admin'] as const;

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

export function CartsList(): ReactNode {
  const t = useTranslation('carts');
  const [rows, setRows] = useState<AdminCartRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | (typeof STATUSES)[number]>('');
  const [approvalFilter, setApprovalFilter] = useState<'' | (typeof APPROVAL_STATUSES)[number]>('');

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
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-2 md:max-w-xl">
            <div className="space-y-2">
              <Label htmlFor="cstatus">{t('carts.column.status')}</Label>
              <Select
                id="cstatus"
                value={statusFilter}
                onChange={(e): void => setStatusFilter(e.target.value as typeof statusFilter)}
              >
                <option value="">{t('carts.filter.all')}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
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
                {APPROVAL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('carts.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('carts.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('carts.column.lastActivity')}</TableHead>
                  <TableHead>{t('carts.column.id')}</TableHead>
                  <TableHead>{t('carts.column.owner')}</TableHead>
                  <TableHead>{t('carts.column.org')}</TableHead>
                  <TableHead>{t('carts.column.status')}</TableHead>
                  <TableHead>{t('carts.column.approval')}</TableHead>
                  <TableHead>{t('carts.column.items')}</TableHead>
                  <TableHead>{t('carts.column.total')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{formatDateTime(c.lastActivityAt)}</TableCell>
                    <TableCell>
                      <Link to={`/carts/${c.id}`} className="font-mono text-xs underline underline-offset-2">
                        {c.id.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.ownerDisplayName ?? '(anonymous)'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.organizationDisplayName ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[c.status] ?? 'secondary'}>{c.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={APPROVAL_VARIANT[c.approvalStatus] ?? 'secondary'}>
                        {c.approvalStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{c.itemCount}</TableCell>
                    <TableCell className="tabular-nums">
                      {c.total.amount.toFixed(2)} {c.total.currency}
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/carts/${c.id}`}>
                          {t('carts.open')}
                          <ArrowRight />
                        </Link>
                      </Button>
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
}
