import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SalesChannelPicker } from '@/components/sales-channel-picker/SalesChannelPicker';
import { PageHeader } from '@/components/ui/page-header';
import { useTranslation } from '@/i18n/useTranslation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface TemplateRow {
  id: string;
  code: string;
  name: string;
  salesChannelId: string | null;
  active: boolean;
  isSystem: boolean;
  version: number;
}

/** Admin invoice templates list + create (feature 047, US6). */
export function InvoiceTemplatesPage(): ReactNode {
  const t = useTranslation('core');
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [channelId, setChannelId] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: TemplateRow[] }>('/api/v1/admin/invoice-templates');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      await apiClient.post('/api/v1/admin/invoice-templates', {
        code,
        name,
        salesChannelId: channelId.trim() ? channelId.trim() : null,
      });
      setCode('');
      setName('');
      setChannelId('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to create.');
    }
  }, [code, name, channelId, refresh]);

  return (
    <>
      <PageHeader title={t('invoiceTemplates.title')} description={t('invoiceTemplates.description')} />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="grid gap-3 pt-6 md:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="tcode">{t('invoiceTemplates.fields.code')}</Label>
            <Input id="tcode" value={code} onChange={(e): void => setCode(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tname">{t('invoiceTemplates.fields.name')}</Label>
            <Input id="tname" value={name} onChange={(e): void => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tchan">{t('invoiceTemplates.fields.channel')}</Label>
            <SalesChannelPicker
              id="tchan"
              value={channelId.trim() ? channelId : null}
              onChange={(id): void => setChannelId(id ?? '')}
              placeholder={t('invoiceTemplates.fields.channelHint')}
              clearable
            />
          </div>
          <div className="flex items-end">
            <Button onClick={(): void => void create()} disabled={!code || !name}>
              {t('invoiceTemplates.create')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('invoiceTemplates.columns.name')}</TableHead>
                  <TableHead>{t('invoiceTemplates.columns.scope')}</TableHead>
                  <TableHead>{t('invoiceTemplates.columns.active')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.name}
                      {r.isSystem ? <Badge className="ml-2" variant="secondary">system</Badge> : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.salesChannelId ? r.salesChannelId.slice(0, 8) : t('invoiceTemplates.global')}
                    </TableCell>
                    <TableCell>
                      {r.active ? <Badge variant="success">{t('invoiceTemplates.active')}</Badge> : null}
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/invoices/templates/${r.id}`}>{t('common.action.edit')}</Link>
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
