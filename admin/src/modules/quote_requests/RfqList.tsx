import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { ResponsiveTable } from '@/components/ResponsiveTable';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Admin Quote Requests list (feature 008 / T042). Surfaces every RFQ
 * the caller is authorized to see (assignment-scoped server-side) and
 * deep-links to the detail view for approve / cancel / modify actions.
 */

type RfqStatus =
  | 'Created from admin'
  | 'Pending'
  | 'Canceled'
  | 'Approved'
  | 'Completed'
  | 'Expired';

const RFQ_STATUSES: readonly RfqStatus[] = [
  'Created from admin',
  'Pending',
  'Canceled',
  'Approved',
  'Completed',
  'Expired',
];

type AssignmentScope = 'mine' | 'unassigned' | 'all';

interface AdminRfqRow {
  id: string;
  organizationId: string;
  organizationName?: string;
  customerAccountId: string;
  customerDisplayName?: string | null;
  status: RfqStatus;
  awaitingCustomerRevisionAcceptance: boolean;
  lineCount: number;
  totalAtCustomerPrice: number | null;
  totalAtAgreedPrice: number | null;
  currency: string;
  submittedAt: string | null;
  expiresAt: string | null;
  updatedAt: string;
  version: number;
}

interface AdminRfqListResponse {
  data: AdminRfqRow[];
}

const STATUS_VARIANT: Record<
  RfqStatus,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive'
> = {
  'Created from admin': 'warning',
  Pending: 'warning',
  Approved: 'success',
  Completed: 'default',
  Canceled: 'destructive',
  Expired: 'secondary',
};

export function RfqList(): ReactNode {
  const t = useTranslation('core');
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<AdminRfqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | RfqStatus>(() => {
    const fromUrl = searchParams.get('status');
    return fromUrl !== null && RFQ_STATUSES.includes(fromUrl as RfqStatus)
      ? (fromUrl as RfqStatus)
      : 'all';
  });
  const [scope, setScope] = useState<AssignmentScope>(() => {
    const fromUrl = searchParams.get('scope');
    return fromUrl === 'all' || fromUrl === 'unassigned' || fromUrl === 'mine' ? fromUrl : 'mine';
  });
  const [organizationId, setOrganizationId] = useState<string>('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (scope) params.set('assignmentScope', scope);
      if (organizationId) params.set('organizationId', organizationId);
      const path =
        '/api/v1/admin/quote-requests' + (params.toString() ? `?${params.toString()}` : '');
      const res = await apiClient.get<AdminRfqListResponse>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('rfq.list.error.load'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, scope, organizationId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="b2b-page b2b-page--wide">
      <PageHeader title={t('rfq.list.title')} description={t('rfq.list.description')} />

      <Card>
        <CardContent className="b2b-stack" style={{ gap: 16 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '180px 180px 1fr auto',
              gap: 12,
              alignItems: 'end',
            }}
          >
            <div>
              <Label htmlFor="rfq-scope">{t('rfq.list.field.visibility')}</Label>
              <Select
                id="rfq-scope"
                value={scope}
                onChange={(e): void => setScope(e.target.value as AssignmentScope)}
              >
                <option value="mine">{t('rfq.list.scope.mine')}</option>
                <option value="unassigned">{t('rfq.list.scope.unassigned')}</option>
                <option value="all">{t('rfq.list.scope.all')}</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="rfq-status">{t('rfq.list.field.status')}</Label>
              <Select
                id="rfq-status"
                value={statusFilter}
                onChange={(e): void => setStatusFilter(e.target.value as 'all' | RfqStatus)}
              >
                <option value="all">{t('rfq.list.statusFilter.all')}</option>
                <option value="Pending">{t('rfq.list.statusFilter.pending')}</option>
                <option value="Created from admin">{t('rfq.list.statusFilter.createdFromAdmin')}</option>
                <option value="Approved">{t('rfq.list.statusFilter.approved')}</option>
                <option value="Completed">{t('rfq.list.statusFilter.completed')}</option>
                <option value="Canceled">{t('rfq.list.statusFilter.canceled')}</option>
                <option value="Expired">{t('rfq.list.statusFilter.expired')}</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="rfq-org">{t('rfq.list.field.organizationId')}</Label>
              <Input
                id="rfq-org"
                value={organizationId}
                onChange={(e): void => setOrganizationId(e.target.value)}
                placeholder={t('rfq.list.field.uuid')}
              />
            </div>
            <Button variant="default" onClick={(): void => void refresh()} disabled={loading}>
              {t('rfq.list.refresh')}
            </Button>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {rows.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t('rfq.list.empty')}</p>
          ) : (
            <ResponsiveTable
              data={rows}
              keyExtractor={(r) => r.id}
              columns={[
                {
                  id: 'rfq',
                  header: t('rfq.list.column.rfq'),
                  primary: true,
                  render: (r) => <code>{r.id.slice(0, 8)}</code>,
                  meta: (r) => formatDateTime(r.updatedAt),
                },
                {
                  id: 'org',
                  header: t('rfq.list.column.organization'),
                  render: (r) => r.organizationName ?? r.organizationId.slice(0, 8),
                },
                {
                  id: 'customer',
                  header: t('rfq.list.column.customer'),
                  render: (r) => r.customerDisplayName ?? '—',
                },
                {
                  id: 'status',
                  header: t('rfq.list.column.status'),
                  render: (r) => (
                    <>
                      <Badge variant={STATUS_VARIANT[r.status] ?? 'default'}>{r.status}</Badge>
                      {r.awaitingCustomerRevisionAcceptance ? (
                        <Badge variant="warning" className="ml-1">
                          {t('rfq.list.badge.awaitingCustomer')}
                        </Badge>
                      ) : null}
                    </>
                  ),
                },
                {
                  id: 'lines',
                  header: t('rfq.list.column.lines'),
                  hideOnMobile: true,
                  render: (r) => r.lineCount,
                },
                {
                  id: 'total',
                  header: t('rfq.list.column.total'),
                  render: (r) => formatTotal(r),
                },
              ]}
              renderActions={(r) => (
                <Button asChild variant="outline" size="sm" className="min-h-11">
                  <Link to={`/quote-requests/${r.id}`}>
                    {t('rfq.list.open')} <ArrowRight size={14} />
                  </Link>
                </Button>
              )}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatTotal(r: AdminRfqRow): string {
  const total = r.totalAtAgreedPrice ?? r.totalAtCustomerPrice;
  if (total === null) return '—';
  return `${total.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} ${r.currency}`;
}
