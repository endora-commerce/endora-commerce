import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { OrganizationStatusBadge } from '@/components/organization-picker';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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

interface AdminOrganization {
  id: string;
  name: string;
  taxId: string;
  status: 'pending_verification' | 'active' | 'blocked' | 'rejected';
  vatStatus: 'vat_payer' | 'vat_exempt' | 'reverse_charge';
  createdAt: string;
}

const STATUSES = ['pending_verification', 'active', 'blocked', 'rejected'] as const;

export function OrganizationsList(): ReactNode {
  const t = useTranslation('core');
  const [rows, setRows] = useState<AdminOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'' | (typeof STATUSES)[number]>('');
  const [q, setQ] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('filter[status]', status);
      if (q) params.set('q', q);
      const path =
        '/api/v1/admin/organizations' + (params.toString() ? `?${params.toString()}` : '');
      const res = await apiClient.get<{ data: AdminOrganization[] }>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('organizations.error.load'));
    } finally {
      setLoading(false);
    }
  }, [status, q, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <PageHeader
        title={t('organizations.page.title')}
        description={t('organizations.page.description')}
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ostatus">{t('organizations.field.status')}</Label>
            <Select
              id="ostatus"
              value={status}
              onChange={(e): void => setStatus(e.target.value as typeof status)}
            >
              <option value="">{t('organizations.filter.all')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="oq">{t('organizations.field.search')}</Label>
            <Input id="oq" value={q} onChange={(e): void => setQ(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('organizations.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('organizations.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('organizations.column.name')}</TableHead>
                  <TableHead>{t('organizations.column.taxId')}</TableHead>
                  <TableHead>{t('organizations.column.status')}</TableHead>
                  <TableHead>{t('organizations.column.vat')}</TableHead>
                  <TableHead>{t('organizations.column.registered')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.name}</TableCell>
                    <TableCell className="font-mono text-xs">{o.taxId}</TableCell>
                    <TableCell>
                      <OrganizationStatusBadge status={o.status} />
                    </TableCell>
                    <TableCell>{o.vatStatus}</TableCell>
                    <TableCell>{formatDateTime(o.createdAt)}</TableCell>
                    <TableCell>
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/organizations/${o.id}`}>
                          {t('organizations.action.open')}
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
