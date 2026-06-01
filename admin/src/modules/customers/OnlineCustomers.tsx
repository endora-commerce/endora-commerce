import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ResponsiveTable } from '@/components/ResponsiveTable';
import { useTranslation } from '@/i18n/useTranslation';

interface OnlineCustomer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  lastSeenAt: string;
}

export function OnlineCustomers(): ReactNode {
  const t = useTranslation('customers');
  const [rows, setRows] = useState<OnlineCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: OnlineCustomer[] }>('/api/v1/admin/customers/online');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('online.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <PageHeader title={t('online.title')} description={t('online.description')} />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('online.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('online.empty')}</p>
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
                  meta: (c) => <span className="font-mono text-xs text-muted-foreground">{c.email}</span>,
                },
                {
                  id: 'lastSeen',
                  header: t('online.column.lastSeen'),
                  render: (c) => formatDateTime(c.lastSeenAt),
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
