import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Upload } from 'lucide-react';
import type { Warehouse } from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';
import { warehousesClient } from '../warehouses/api/warehouses-client';

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
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [csv, setCsv] = useState<string>('');
  const [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [committed, setCommitted] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await warehousesClient.list({ activeOnly: true, withTotals: false, pageSize: 200 });
      setWarehouses(res.items);
      if (res.items.length > 0 && !warehouseId) setWarehouseId(res.items[0]!.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('inventory.import.error.loadWarehouses'));
    }
  }, [warehouseId, t]);

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

  return (
    <div className="b2b-page">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <Link to="/inventory" className="b2b-btn b2b-btn--ghost b2b-btn--sm" style={{ marginBottom: 8, display: 'inline-flex' }}>
            <ArrowLeft size={13} /> {t('inventory.import.back')}
          </Link>
          <div className="b2b-page-head__title">{t('inventory.import.title')}</div>
          <div className="b2b-page-head__sub">
            {t('inventory.import.subPrefix')} <code className="b2b-mono">sku,onHand</code>{t('inventory.import.subSuffix')}
          </div>
        </div>
      </div>

      {error ? (
        <div
          className="b2b-card"
          style={{
            background: 'var(--danger-soft)',
            color: 'var(--danger-soft-fg)',
            padding: 12,
            marginBottom: 16,
            border: '1px solid hsl(8 80% 85%)',
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="b2b-card" style={{ marginBottom: 16 }}>
        <div className="b2b-card__head"><h2>{t('inventory.import.step1')}</h2></div>
        <div className="b2b-card__body">
          <select
            className="b2b-field"
            value={warehouseId}
            onChange={(e): void => setWarehouseId(e.target.value)}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
            ))}
          </select>
        </div>
      </div>

      <div className="b2b-card" style={{ marginBottom: 16 }}>
        <div className="b2b-card__head"><h2>{t('inventory.import.step2')}</h2></div>
        <div className="b2b-card__body">
          <input type="file" accept=".csv,text/csv" onChange={handleFile} />
          {filename ? (
            <div className="b2b-help" style={{ marginTop: 8 }}>
              {t('inventory.import.loadedPrefix')} <code className="b2b-mono">{filename}</code> {t('inventory.import.loadedSuffix', { count: csv.split(/\r?\n/).length })}
            </div>
          ) : (
            <div className="b2b-help" style={{ marginTop: 8 }}>
              {t('inventory.import.pasteDirectly')}
              <textarea
                className="b2b-field"
                rows={6}
                style={{ marginTop: 8, fontFamily: 'monospace' }}
                placeholder={exampleCsv}
                value={csv}
                onChange={(e): void => setCsv(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      <div className="b2b-card" style={{ marginBottom: 16 }}>
        <div className="b2b-card__head"><h2>{t('inventory.import.step3')}</h2></div>
        <div className="b2b-card__body">
          <div className="b2b-row" style={{ gap: 8 }}>
            <button
              type="button"
              className="b2b-btn b2b-btn--default"
              onClick={(): void => { void send(true); }}
              disabled={busy || !csv || !warehouseId}
            >
              <Upload size={13} /> {t('inventory.import.previewDryRun')}
            </button>
            <button
              type="button"
              className="b2b-btn b2b-btn--primary"
              onClick={(): void => { void send(false); }}
              disabled={busy || !csv || !warehouseId || !preview}
            >
              {busy ? t('inventory.import.working') : t('inventory.import.commit')}
            </button>
          </div>

          {preview ? (
            <ResultBlock title={t('inventory.import.dryRunSummary')} result={preview} tone="warn" />
          ) : null}
          {committed ? (
            <ResultBlock title={t('inventory.import.committed')} result={committed} tone="success" />
          ) : null}
        </div>
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
      className="b2b-card"
      style={{
        marginTop: 12,
        padding: 12,
        background: tone === 'success' ? 'var(--success-soft)' : 'var(--surface-muted)',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
      <div className="b2b-row" style={{ gap: 16, marginTop: 8 }}>
        <div>
          <div className="b2b-muted" style={{ fontSize: 11 }}>{t('inventory.import.rowsRead')}</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{result.rowsRead}</div>
        </div>
        <div>
          <div className="b2b-muted" style={{ fontSize: 11 }}>{t('inventory.import.applied')}</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{result.rowsApplied}</div>
        </div>
        <div>
          <div className="b2b-muted" style={{ fontSize: 11 }}>{t('inventory.import.skipped')}</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{result.rowsSkipped}</div>
        </div>
      </div>
      {result.errors.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div className="b2b-muted" style={{ fontSize: 11 }}>
            {t('inventory.import.errorsCount', { count: result.errors.length })}
          </div>
          <table className="b2b-tbl" style={{ marginTop: 4, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 60 }}>{t('inventory.import.errors.row')}</th>
                <th>{t('inventory.import.errors.sku')}</th>
                <th>{t('inventory.import.errors.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {result.errors.slice(0, 50).map((err, i) => (
                <tr key={`${err.row}-${i}`}>
                  <td>{err.row}</td>
                  <td>
                    <span className="b2b-mono">{err.sku || '—'}</span>
                  </td>
                  <td>{err.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.errors.length > 50 ? (
            <div className="b2b-help">
              {t('inventory.import.errorsTruncated', { total: result.errors.length })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
