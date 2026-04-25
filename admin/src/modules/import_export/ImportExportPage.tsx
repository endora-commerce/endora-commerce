import { useCallback, useState, type ChangeEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '../../lib/api-client.js';

interface EntityConfig {
  slug: string;
  label: string;
  importable: boolean;
  importHeader?: string;
}

const ENTITIES: EntityConfig[] = [
  {
    slug: 'products',
    label: 'Products',
    importable: true,
    importHeader: 'sku, status, visibility, name_en, description_en',
  },
  {
    slug: 'categories',
    label: 'Categories',
    importable: true,
    importHeader: 'slug, parent_slug, sort_order, name_en',
  },
  {
    slug: 'stock',
    label: 'Stock levels',
    importable: true,
    importHeader: 'product_sku, variant_id, on_hand',
  },
  { slug: 'customers', label: 'Customers', importable: false },
  { slug: 'orders', label: 'Orders', importable: false },
];

const apiBaseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000';

export function ImportExportPage(): ReactNode {
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Import / Export</h1>
          <p>
            CSV-only round-trips for the bulk-edit cases. Per-row errors roll the entire
            upload back, so re-uploads are deterministic.
          </p>
        </div>
      </header>

      {ENTITIES.map((entity) => (
        <EntityCard key={entity.slug} entity={entity} />
      ))}
    </>
  );
}

function EntityCard(props: { entity: EntityConfig }): ReactNode {
  const { entity } = props;
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
          setImportMessage(`Imported ${res.data.imported} row(s).`);
        } else {
          setImportMessage(
            `Rolled back: ${res.data.errors.length} row(s) failed. No changes applied.`,
          );
          setImportErrors(res.data.errors);
        }
      } catch (err) {
        setImportError(err instanceof ApiError ? err.envelope.error.message : 'Import failed.');
      } finally {
        setImporting(false);
      }
    },
    [entity.slug],
  );

  const exportHref = `${apiBaseUrl}/api/v1/admin/export/${entity.slug}.csv`;

  return (
    <div className="card">
      <h2 style={{ marginTop: 0, fontSize: '1rem' }}>{entity.label}</h2>

      <div className="toolbar">
        <a className="btn" href={exportHref} download>
          Export CSV
        </a>

        {entity.importable ? (
          <label
            className="btn btn--primary"
            style={{
              position: 'relative',
              cursor: importing ? 'wait' : 'pointer',
              opacity: importing ? 0.7 : 1,
            }}
          >
            {importing ? 'Uploading…' : 'Import CSV'}
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e): void => {
                void onFileChange(e);
              }}
              disabled={importing}
              style={{
                position: 'absolute',
                inset: 0,
                opacity: 0,
                cursor: 'inherit',
              }}
            />
          </label>
        ) : (
          <span className="muted">Import not supported — see the docs site for the rationale.</span>
        )}
      </div>

      {entity.importable && entity.importHeader ? (
        <p className="muted" style={{ marginTop: 8 }}>
          Required header: <span className="code">{entity.importHeader}</span>
        </p>
      ) : null}

      {importError ? <div className="alert alert--error">{importError}</div> : null}
      {importMessage ? (
        <div className={`alert ${importErrors.length > 0 ? 'alert--warning' : 'alert--success'}`}>
          {importMessage}
        </div>
      ) : null}
      {importErrors.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Row #</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {importErrors.map((err) => (
              <tr key={`${err.rowNumber}-${err.reason}`}>
                <td>{err.rowNumber}</td>
                <td>{err.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
