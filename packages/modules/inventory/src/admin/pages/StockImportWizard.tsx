import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import type { Warehouse } from '@endora-commerce/contracts';
import { ApiError, apiClient, cn, useSurfaceVisibility } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  PageHeader,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@endora-commerce/admin-kit/ui';
import { warehousesClient } from '../api/warehouses-client.js';
import { importErrorReasonLabels } from '../lib/labels.js';

interface ImportError {
  row: number;
  sku: string;
  reason: 'product_not_found' | 'invalid_quantity' | 'malformed_row';
}

interface ImportResult {
  rowsRead: number;
  rowsApplied: number;
  rowsSkipped: number;
  errors: ImportError[];
}

interface ImportResponse {
  data: ImportResult;
}

/**
 * StockImportWizard — feature 010 / US7 (T081).
 *
 * CSV-only for now (XLSX support rides on the same endpoint once the
 * parser dep is wired). Operator picks a warehouse, drops a file, the
 * wizard previews the parsed CSV in dry-run mode, and the operator
 * commits with a second click.
 */
export function StockImportWizard(): ReactNode {
  const t = useTranslation('core');
  /**
   * The screen's own gate (2026-08-29) — see `InventoryPage` for the reasoning
   * in full. This one asks for the **write** code, not the read: the whole
   * screen is a write, and its sidebar entry has always carried a write code
   * (`catalog:write` until this change).
   */
  const isVisible = useSurfaceVisibility();
  const canWrite = isVisible({ module: 'inventory', requiredPermission: 'inventory:write' });
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [csv, setCsv] = useState<string>('');
  const [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [committed, setCommitted] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!canWrite) return;
    try {
      const res = await warehousesClient.list({ activeOnly: true, withTotals: false, pageSize: 200 });
      setWarehouses(res.items);
      if (res.items.length > 0 && !warehouseId) setWarehouseId(res.items[0]!.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('inventory.import.error.loadWarehouses'));
    }
  }, [canWrite, warehouseId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (): void => {
      setCsv(String(reader.result ?? ''));
      setFilename(file.name);
      setPreview(null);
      setCommitted(null);
    };
    reader.readAsText(file);
  };

  const send = async (dryRun: boolean): Promise<void> => {
    if (!csv || !warehouseId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<ImportResponse>(
        `/api/v1/admin/inventory/import?dryRun=${dryRun ? 'true' : 'false'}`,
        { csv, warehouseId },
      );
      if (dryRun) {
        setPreview(res.data);
      } else {
        setCommitted(res.data);
        setPreview(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('inventory.import.error.import'));
    } finally {
      setBusy(false);
    }
  };

  const exampleCsv = `sku,onHand\nDEMO-001,42\nDEMO-002,0\n`;

  if (!canWrite) {
    return <div className="b2b-page">{t('inventory.noPermission')}</div>;
  }

  return (
    <div className="b2b-page">
      <PageHeader
        back={{ label: t('inventory.import.back'), to: '/inventory' }}
        title={t('inventory.import.title')}
        description={
          <>
            {t('inventory.import.subPrefix')} <code className="font-mono">sku,onHand</code>{t('inventory.import.subSuffix')}
          </>
        }
      />

      {/* Issue #1492 (CAT-17): a failure is a kit Alert (role="alert"), not a card painted red. */}
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* The three steps stay three numbered cards in reading order (Zeigarnik): the
          operator sees where they are and what is left. */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('inventory.import.step1')}</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField label={t('inventory.import.field.warehouse')} className="max-w-md">
              <Select value={warehouseId} onChange={(e): void => setWarehouseId(e.target.value)}>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </Select>
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('inventory.import.step2')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              label={t('inventory.import.field.file')}
              hint={
                filename ? (
                  <>
                    {t('inventory.import.loadedPrefix')} <code className="font-mono">{filename}</code>{' '}
                    {t('inventory.import.loadedSuffix', { count: csv.split(/\r?\n/).length })}
                  </>
                ) : undefined
              }
            >
              <Input type="file" accept=".csv,text/csv" onChange={handleFile} className="max-w-md" />
            </FormField>
            {filename ? null : (
              <FormField label={t('inventory.import.field.paste')}>
                <Textarea
                  rows={6}
                  className="font-mono"
                  placeholder={exampleCsv}
                  value={csv}
                  onChange={(e): void => setCsv(e.target.value)}
                />
              </FormField>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('inventory.import.step3')}</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Preview first, then Commit: Commit is the one filled button and stays
                disabled until a dry run has been seen (Von Restorff). */}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={(): void => {
                  void send(true);
                }}
                disabled={busy || !csv || !warehouseId}
              >
                <Upload aria-hidden="true" /> {t('inventory.import.previewDryRun')}
              </Button>
              <Button
                type="button"
                onClick={(): void => {
                  void send(false);
                }}
                disabled={busy || !csv || !warehouseId || !preview}
                aria-busy={busy || undefined}
              >
                {busy ? t('inventory.import.working') : t('inventory.import.commit')}
              </Button>
            </div>

            {/* Mounted before it has a result, so each summary is announced (WCAG 4.1.3). */}
            <div role="status" className="empty:hidden">
              {preview ? <ResultBlock title={t('inventory.import.dryRunSummary')} result={preview} tone="warn" /> : null}
              {committed ? (
                <ResultBlock title={t('inventory.import.committed')} result={committed} tone="success" />
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ResultBlock({
  title,
  result,
  tone,
}: {
  title: string;
  result: ImportResult;
  tone: 'warn' | 'success';
}): ReactNode {
  const t = useTranslation('core');
  return (
    <div
      className={cn(
        'mt-3 rounded-md border p-3',
        tone === 'success' ? 'border-(--success)/40 bg-(--success-soft)' : 'bg-muted',
      )}
    >
      <p className="text-sm font-semibold">{title}</p>
      <dl className="mt-2 flex flex-wrap gap-4">
        <ResultCount label={t('inventory.import.rowsRead')} value={result.rowsRead} />
        <ResultCount label={t('inventory.import.applied')} value={result.rowsApplied} />
        <ResultCount label={t('inventory.import.skipped')} value={result.rowsSkipped} />
      </dl>
      {result.errors.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">
            {t('inventory.import.errorsCount', { count: result.errors.length })}
          </p>
          <Table className="mt-1 text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">{t('inventory.import.errors.row')}</TableHead>
                <TableHead>{t('inventory.import.errors.sku')}</TableHead>
                <TableHead>{t('inventory.import.errors.reason')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.errors.slice(0, 50).map((err, i) => (
                <TableRow key={`${err.row}-${i}`}>
                  <TableCell className="tabular-nums">{err.row}</TableCell>
                  <TableCell className="font-mono">{err.sku || '—'}</TableCell>
                  <TableCell>{importErrorReasonLabels.label(t, err.reason)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {result.errors.length > 50 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('inventory.import.errorsTruncated', { total: result.errors.length })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** One count of the import summary: a term and its value inside the summary's `<dl>`. */
function ResultCount({ label, value }: { label: string; value: number }): ReactNode {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default StockImportWizard;
