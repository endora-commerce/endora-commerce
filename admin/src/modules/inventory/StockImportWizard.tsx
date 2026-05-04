import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Upload } from 'lucide-react';
import type { Warehouse } from '@b2b/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
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
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load warehouses.');
    }
  }, [warehouseId]);

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
      setError(err instanceof ApiError ? err.envelope.error.message : 'Import failed.');
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
            <ArrowLeft size={13} /> Back to Inventory
          </Link>
          <div className="b2b-page-head__title">Import stock</div>
          <div className="b2b-page-head__sub">
            CSV with header <code className="b2b-mono">sku,onHand</code>. Preview first, then commit.
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
        <div className="b2b-card__head"><h2>1 · Pick a warehouse</h2></div>
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
        <div className="b2b-card__head"><h2>2 · Provide the file</h2></div>
        <div className="b2b-card__body">
          <input type="file" accept=".csv,text/csv" onChange={handleFile} />
          {filename ? (
            <div className="b2b-help" style={{ marginTop: 8 }}>
              Loaded <code className="b2b-mono">{filename}</code> ({csv.split(/\r?\n/).length} lines).
            </div>
          ) : (
            <div className="b2b-help" style={{ marginTop: 8 }}>
              Or paste CSV directly:
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
        <div className="b2b-card__head"><h2>3 · Preview + commit</h2></div>
        <div className="b2b-card__body">
          <div className="b2b-row" style={{ gap: 8 }}>
            <button
              type="button"
              className="b2b-btn b2b-btn--default"
              onClick={(): void => { void send(true); }}
              disabled={busy || !csv || !warehouseId}
            >
              <Upload size={13} /> Preview (dry run)
            </button>
            <button
              type="button"
              className="b2b-btn b2b-btn--primary"
              onClick={(): void => { void send(false); }}
              disabled={busy || !csv || !warehouseId || !preview}
            >
              {busy ? 'Working…' : 'Commit'}
            </button>
          </div>

          {preview ? (
            <ResultBlock title="Dry-run summary" result={preview} tone="warn" />
          ) : null}
          {committed ? (
            <ResultBlock title="Committed" result={committed} tone="success" />
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
          <div className="b2b-muted" style={{ fontSize: 11 }}>Rows read</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{result.rowsRead}</div>
        </div>
        <div>
          <div className="b2b-muted" style={{ fontSize: 11 }}>Applied</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{result.rowsApplied}</div>
        </div>
        <div>
          <div className="b2b-muted" style={{ fontSize: 11 }}>Skipped</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{result.rowsSkipped}</div>
        </div>
      </div>
      {result.errors.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div className="b2b-muted" style={{ fontSize: 11 }}>
            Errors ({result.errors.length}):
          </div>
          <table className="b2b-tbl" style={{ marginTop: 4, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 60 }}>Row</th>
                <th>SKU</th>
                <th>Reason</th>
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
              Showing first 50 errors of {result.errors.length}.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
