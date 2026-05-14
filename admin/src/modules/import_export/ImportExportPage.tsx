import { useCallback, useState, type ChangeEvent, type ReactNode } from 'react';
import { Download, Upload } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

interface EntityConfig {
  slug: string;
  labelKey: string;
  importable: boolean;
  importHeader?: string;
}

const ENTITIES: EntityConfig[] = [
  {
    slug: 'products',
    labelKey: 'importExport.entity.products',
    importable: true,
    importHeader: 'sku, status, visibility, name_en, description_en',
  },
  {
    slug: 'categories',
    labelKey: 'importExport.entity.categories',
    importable: true,
    importHeader: 'slug, parent_slug, sort_order, name_en',
  },
  {
    slug: 'stock',
    labelKey: 'importExport.entity.stock',
    importable: true,
    importHeader: 'product_sku, variant_id, on_hand',
  },
  { slug: 'customers', labelKey: 'importExport.entity.customers', importable: false },
  { slug: 'orders', labelKey: 'importExport.entity.orders', importable: false },
];

const apiBaseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';

export function ImportExportPage(): ReactNode {
  const t = useTranslation('core');
  return (
    <>
      <PageHeader
        title={t('importExport.page.title')}
        description={t('importExport.page.description')}
      />
      <div className="space-y-4">
        {ENTITIES.map((entity) => (
          <EntityCard key={entity.slug} entity={entity} />
        ))}
      </div>
    </>
  );
}

function EntityCard({ entity }: { entity: EntityConfig }): ReactNode {
  const t = useTranslation('core');
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<Array<{ rowNumber: number; reason: string }>>(
    [],
  );
  const [importError, setImportError] = useState<string | null>(null);

  const onFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      setImporting(true);
      setImportMessage(null);
      setImportErrors([]);
      setImportError(null);
      try {
        const csv = await file.text();
        const res = await apiClient.post<{
          data: { imported: number; errors: Array<{ rowNumber: number; reason: string }> };
        }>(`/api/v1/admin/import/${entity.slug}`, csv, {
          headers: { 'Content-Type': 'text/csv' },
        });
        if (res.data.errors.length === 0) {
          setImportMessage(t('importExport.imported', { count: res.data.imported }));
        } else {
          setImportMessage(t('importExport.rolledBack', { count: res.data.errors.length }));
          setImportErrors(res.data.errors);
        }
      } catch (err) {
        setImportError(err instanceof ApiError ? err.envelope.error.message : t('importExport.error.import'));
      } finally {
        setImporting(false);
      }
    },
    [entity.slug, t],
  );

  const exportHref = `${apiBaseUrl}/api/v1/admin/export/${entity.slug}.csv`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(entity.labelKey)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={exportHref} download>
              <Download />
              {t('importExport.exportCsv')}
            </a>
          </Button>
          {entity.importable ? (
            <Button
              asChild
              size="sm"
              disabled={importing}
              className={importing ? 'cursor-wait opacity-70' : 'cursor-pointer'}
            >
              <label className="relative">
                <Upload />
                {importing ? t('importExport.uploading') : t('importExport.importCsv')}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e): void => {
                    void onFileChange(e);
                  }}
                  disabled={importing}
                  className="absolute inset-0 cursor-[inherit] opacity-0"
                />
              </label>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t('importExport.importNotSupported')}
            </span>
          )}
        </div>

        {entity.importable && entity.importHeader ? (
          <p className="text-xs text-muted-foreground">
            {t('importExport.requiredHeader')}{' '}
            <code className="rounded bg-muted px-1 font-mono">{entity.importHeader}</code>
          </p>
        ) : null}

        {importError ? (
          <Alert variant="destructive">
            <AlertDescription>{importError}</AlertDescription>
          </Alert>
        ) : null}
        {importMessage ? (
          <Alert variant={importErrors.length > 0 ? 'warning' : 'success'}>
            <AlertDescription>{importMessage}</AlertDescription>
          </Alert>
        ) : null}
        {importErrors.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('importExport.column.rowNumber')}</TableHead>
                <TableHead>{t('importExport.column.reason')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {importErrors.map((err) => (
                <TableRow key={`${err.rowNumber}-${err.reason}`}>
                  <TableCell>{err.rowNumber}</TableCell>
                  <TableCell>{err.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
