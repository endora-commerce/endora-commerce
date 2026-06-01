import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { ResponsiveTable } from '@/components/ResponsiveTable';
import { useTranslation } from '@/i18n/useTranslation';

interface AdminCustomerListItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationId: string | null;
  organizationName: string | null;
  customerGroupId: string | null;
  customerGroupName: string | null;
  blocked: boolean;
  deleted: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

const STATUSES = ['active', 'blocked', 'deleted'] as const;

export function CustomersList(): ReactNode {
  const t = useTranslation('customers');
  const [rows, setRows] = useState<AdminCustomerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'' | (typeof STATUSES)[number]>('');
  const [q, setQ] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (q) params.set('q', q);
      const path =
        '/api/v1/admin/customers' + (params.toString() ? `?${params.toString()}` : '');
      const res = await apiClient.get<{ data: AdminCustomerListItem[] }>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('list.error'));
    } finally {
      setLoading(false);
    }
  }, [status, q, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <PageHeader title={t('list.title')} description={t('list.description')} />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="cstatus">{t('list.field.status')}</Label>
            <Select
              id="cstatus"
              value={status}
              onChange={(e): void => setStatus(e.target.value as typeof status)}
            >
              <option value="">{t('list.filter.all')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cq">{t('list.field.search')}</Label>
            <Input id="cq" value={q} onChange={(e): void => setQ(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('list.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
          ) : (
            <ResponsiveTable
              data={rows}
              keyExtractor={(c) => c.id}
              columns={[
                {
                  id: 'name',
                  header: t('list.column.customer'),
                  primary: true,
                  render: (c) => (
                    <span className="font-medium">
                      {c.firstName} {c.lastName}
                    </span>
                  ),
                  meta: (c) => (
                    <span className="font-mono text-xs text-muted-foreground">{c.email}</span>
                  ),
                },
                {
                  id: 'status',
                  header: t('list.column.status'),
                  render: (c) =>
                    c.deleted ? (
                      <Badge variant="outline">{t('status.deleted')}</Badge>
                    ) : c.blocked ? (
                      <Badge variant="destructive">{t('status.blocked')}</Badge>
                    ) : (
                      <Badge>{t('status.active')}</Badge>
                    ),
                },
                {
                  id: 'organization',
                  header: t('list.column.organization'),
                  hideOnMobile: true,
                  render: (c) => c.organizationName ?? t('list.none'),
                },
                {
                  id: 'group',
                  header: t('list.column.group'),
                  hideOnMobile: true,
                  render: (c) => c.customerGroupName ?? t('list.none'),
                },
                {
                  id: 'created',
                  header: t('list.column.created'),
                  hideOnMobile: true,
                  render: (c) => formatDateTime(c.createdAt),
                },
              ]}
              renderActions={(c) => (
                <Button asChild variant="outline" size="sm" className="min-h-11">
                  <Link to={`/customers/${c.id}`}>
                    {t('list.action.open')}
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
