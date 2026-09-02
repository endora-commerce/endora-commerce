import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { Download, Upload } from 'lucide-react';
import { ApiError, apiBaseUrl, apiClient } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * The import/export centre — the first admin screen that lives in the module
 * that owns it (feature 091, Phase 2).
 *
 * Two things about it are the point of this file existing here rather than in
 * `admin/src/modules/import_export/`:
 *
 *   * every specifier above is a **bare** one. `@/…` is a tsconfig and Vite
 *     alias of the admin application; a package resolves it to nothing, which
 *     is why `check:admin-surface` reports one as an `aliased-reach`
 *     (`contracts/admin-contribution.md` R4).
 *   * the strings resolve in **this module's** i18n namespace, out of
 *     `packages/modules/import_export/i18n/`, which the platform's own boot
 *     reconciler installs. They were in the shared `_i18n` `core` bundle, one
 *     of the four shared files §1.1 measures 11 of the last 12 modules editing.
 */

/**
 * One entity the server offers, as `GET /admin/import-export/entities` answers.
 *
 * Feature 075 / D-74 — this list used to be a literal array of five slugs here,
 * which meant an operator who switched `inventory` off was still shown a Stock
 * import (Principle XVII rule 5: a module that is off contributes no surface).
 * The server derives it from the effective state of the modules that own the
 * rows, and the screen renders whatever comes back.
 */
interface EntityConfig {
  name: string;
  exportHeader: string[];
  /** `null` when the entity is export-only. */
  importHeader: string[] | null;
}

export default function ImportExportPage(): ReactNode {
  const t = useTranslation('import_export');
  const [entities, setEntities] = useState<EntityConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.get<{ data: { entities: EntityConfig[] } }>(
        '/api/v1/admin/import-export/entities',
      );
      setEntities(res.data.entities);
    } catch (err) {
      setLoadError(
        err instanceof ApiError ? err.envelope.error.message : t('error.load'),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        title={t('page.title')}
        description={t('page.description')}
      />
      {loadError ? (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}
      {loading ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : null}
      {!loading && !loadError && entities.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : null}
      <div className="space-y-4">
        {entities.map((entity) => (
          <EntityCard key={entity.name} entity={entity} />
        ))}
      </div>
    </>
  );
}

function EntityCard({ entity }: { entity: EntityConfig }): ReactNode {
  const t = useTranslation('import_export');
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
        }>(`/api/v1/admin/import/${entity.name}`, csv, {
          headers: { 'Content-Type': 'text/csv' },
        });
        if (res.data.errors.length === 0) {
          setImportMessage(t('imported', { count: res.data.imported }));
        } else {
          setImportMessage(t('rolledBack', { count: res.data.errors.length }));
          setImportErrors(res.data.errors);
        }
      } catch (err) {
        setImportError(err instanceof ApiError ? err.envelope.error.message : t('error.import'));
      } finally {
        setImporting(false);
      }
    },
    [entity.name, t],
  );

  const exportHref = `${apiBaseUrl}/api/v1/admin/export/${entity.name}.csv`;

  return (
    <Card>
      <CardHeader>
        {/* The label is a translation of the slug the server named; an entity
            with no key of its own renders the raw key rather than disappearing. */}
        <CardTitle>{t(`entity.${entity.name}`)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={exportHref} download>
              <Download />
              {t('exportCsv')}
            </a>
          </Button>
          {entity.importHeader ? (
            <Button
              asChild
              size="sm"
              disabled={importing}
              className={importing ? 'cursor-wait opacity-70' : 'cursor-pointer'}
            >
              <label className="relative">
                <Upload />
                {importing ? t('uploading') : t('importCsv')}
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
              {t('importNotSupported')}
            </span>
          )}
        </div>

        {entity.importHeader ? (
          <p className="text-xs text-muted-foreground">
            {t('requiredHeader')}{' '}
            {/* The columns the server requires, not a copy of them kept here. */}
            <code className="rounded bg-muted px-1 font-mono">
              {entity.importHeader.join(', ')}
            </code>
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
                <TableHead>{t('column.rowNumber')}</TableHead>
                <TableHead>{t('column.reason')}</TableHead>
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
