import { useId, useState, type ChangeEvent, type ReactNode } from 'react';
import { FileSearch } from 'lucide-react';
import type { ImportProfile } from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { errorMessage } from './import-profiles-api.js';

/**
 * The products import step (feature 170, `contracts/import-profiles-and-csv.md` §2 and §4): a
 * required profile, then a **dry run** whose per-column `NULL` / `INHERIT` counts, warnings and
 * refusals the operator reads before "Apply" posts the same file for real. Products apply one
 * transaction per row, so a report can hold both imported rows and refused ones.
 */

interface ProductsImportReport {
  imported: number;
  errors: Array<{ rowNumber: number; reason: string }>;
  dryRun?: boolean;
  cellCounts?: Array<{ column: string; null: number; inherit: number }>;
  warnings?: Array<{ kind: 'unmapped_locale'; locale: string; sourceChannel: string | null; products: number }>;
  fieldErrors?: Array<{ rowNumber: number; column: string; code: string }>;
  /** Present when the lists were cut at their cap: how many there were in all. */
  truncated?: { errors: number; fieldErrors: number };
}

/**
 * Every field-error code a products import can return — this module's grammar refusals, the
 * locale mapping's skips and catalog's write refusals — each with an operator-facing label. A code
 * outside the list is shown as it came.
 */
const LABELLED_FIELD_ERRORS = new Set([
  'invalid',
  'inherit_at_global',
  'not_a_member',
  'not_emptyable',
  'required_empty',
  'too_long',
  'language_not_offered',
  'not_supported',
  'subject_not_found',
  'FIELD_NOT_AT_SCOPE',
  'SCOPE_INVALID',
  'URL_KEY_TAKEN',
]);

/**
 * The row errors a products import can return carry a sentence, not a code (`BulkImportRowError`),
 * so the known ones are recognised by their form and labelled with what they name; any other
 * reason is shown as it came.
 */
const ROW_ERRORS: ReadonlyArray<{ pattern: RegExp; key: string; param?: string }> = [
  { pattern: /^sku is required$/, key: 'rowError.skuRequired' },
  { pattern: /^unknown sku: (.+)$/, key: 'rowError.unknownSku', param: 'sku' },
  { pattern: /^IMPORT_CELL_CONFLICT: "([^"]+)"/, key: 'rowError.cellConflict', param: 'field' },
  { pattern: /^(.+): the same field and scope twice in one row$/, key: 'rowError.duplicateCell', param: 'column' },
];

function rowErrorLabel(reason: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  for (const { pattern, key, param } of ROW_ERRORS) {
    const match = pattern.exec(reason);
    if (match) return param ? t(key, { [param]: match[1] ?? '' }) : t(key);
  }
  return reason;
}

export interface ProductsImportProps {
  profiles: ImportProfile[];
  profilesLoading: boolean;
}

export function ProductsImport({ profiles, profilesLoading }: ProductsImportProps): ReactNode {
  const t = useTranslation('import_export');
  const profileSelectId = useId();
  const [profileId, setProfileId] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ csv: string; report: ProductsImportReport } | null>(null);
  const [applied, setApplied] = useState<ProductsImportReport | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const post = (csv: string, dryRun: boolean): Promise<{ data: ProductsImportReport }> => {
    const qs = new URLSearchParams({ profileId });
    if (dryRun) qs.set('dryRun', 'true');
    return apiClient.post<{ data: ProductsImportReport }>(`/api/v1/admin/import/products?${qs.toString()}`, csv, {
      headers: { 'Content-Type': 'text/csv' },
    });
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || profileId === '') return;
    setBusy(true);
    setPending(null);
    setApplied(null);
    setRequestError(null);
    try {
      const csv = await file.text();
      const res = await post(csv, true);
      setPending({ csv, report: res.data });
    } catch (err) {
      setRequestError(errorMessage(err, t, 'error.import'));
    } finally {
      setBusy(false);
    }
  };

  const apply = async (): Promise<void> => {
    if (pending === null) return;
    setBusy(true);
    setRequestError(null);
    try {
      const res = await post(pending.csv, false);
      setPending(null);
      setApplied(res.data);
    } catch (err) {
      setRequestError(errorMessage(err, t, 'error.import'));
    } finally {
      setBusy(false);
    }
  };

  const noProfile = !profilesLoading && profiles.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 space-y-1.5">
          <Label htmlFor={profileSelectId}>{t('products.profile')}</Label>
          <Select
            id={profileSelectId}
            value={profileId}
            disabled={busy || noProfile}
            required
            onChange={(event): void => {
              setProfileId(event.target.value);
              // A dry run belongs to the profile it was planned with.
              setPending(null);
            }}
          >
            <option value="">{t('products.profilePlaceholder')}</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </Select>
        </div>
        <Button
          asChild
          size="sm"
          variant={pending === null ? 'default' : 'outline'}
          disabled={busy || profileId === ''}
          className={profileId === '' ? 'cursor-not-allowed opacity-50' : busy ? 'cursor-wait opacity-70' : 'cursor-pointer'}
        >
          <label className="relative">
            <FileSearch />
            {busy && pending === null ? t('products.checking') : t('products.checkFile')}
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy || profileId === ''}
              onChange={(event): void => {
                void onFile(event);
              }}
              className="absolute inset-0 cursor-[inherit] opacity-0"
            />
          </label>
        </Button>
      </div>
      {noProfile ? <p className="text-xs text-muted-foreground">{t('products.noProfile')}</p> : null}

      {requestError ? (
        <Alert variant="destructive">
          <AlertDescription>{requestError}</AlertDescription>
        </Alert>
      ) : null}

      {pending !== null ? (
        <div className="space-y-3 rounded-md border p-4">
          <Alert variant="default">
            <AlertDescription>
              {t('products.dryRunSummary', {
                count: pending.report.imported,
                refused: pending.report.errors.length,
              })}
            </AlertDescription>
          </Alert>
          <ReportDetails report={pending.report} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={(): void => setPending(null)}>
              {t('products.cancel')}
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={(): void => {
                void apply();
              }}
            >
              {busy ? t('products.applying') : t('products.apply')}
            </Button>
          </div>
        </div>
      ) : null}

      {applied !== null ? (
        <div className="space-y-3">
          <Alert variant={applied.errors.length > 0 || (applied.fieldErrors?.length ?? 0) > 0 ? 'warning' : 'success'}>
            <AlertDescription>
              {t('products.applied', { count: applied.imported, refused: applied.errors.length })}
            </AlertDescription>
          </Alert>
          <ReportDetails report={applied} />
        </div>
      ) : null}
    </div>
  );
}

function ReportDetails({ report }: { report: ProductsImportReport }): ReactNode {
  const t = useTranslation('import_export');
  const cellCounts = report.cellCounts ?? [];
  const warnings = report.warnings ?? [];
  const fieldErrors = report.fieldErrors ?? [];
  return (
    <div className="space-y-3">
      {report.dryRun ? (
        cellCounts.length > 0 ? (
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">{t('products.tokens.title')}</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('products.tokens.column')}</TableHead>
                  <TableHead className="text-right">{t('products.tokens.null')}</TableHead>
                  <TableHead className="text-right">{t('products.tokens.inherit')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cellCounts.map((count) => (
                  <TableRow key={count.column}>
                    <TableCell className="font-mono text-xs">{count.column}</TableCell>
                    <TableCell className="text-right tabular-nums">{count.null}</TableCell>
                    <TableCell className="text-right tabular-nums">{count.inherit}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('products.tokens.none')}</p>
        )
      ) : null}

      {warnings.length > 0 ? (
        <Alert variant="warning">
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {warnings.map((warning) => (
                <li key={`${warning.locale}|${warning.sourceChannel ?? ''}`}>
                  {t('products.warning.unmappedLocale', {
                    locale: warning.locale,
                    sourceChannel: warning.sourceChannel ?? t('importProfiles.mapping.anySourceChannel'),
                    products: warning.products,
                  })}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {report.truncated ? (
        <Alert variant="warning">
          <AlertDescription>
            {t('products.truncated', {
              errors: report.truncated.errors,
              fieldErrors: report.truncated.fieldErrors,
              shown: report.errors.length + (report.fieldErrors?.length ?? 0),
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      {report.errors.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('column.rowNumber')}</TableHead>
              <TableHead>{t('column.reason')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.errors.map((err, position) => (
              // A row can repeat a reason; the list is never reordered, so its position is a stable key.
              <TableRow key={position}>
                <TableCell>{err.rowNumber}</TableCell>
                <TableCell>{rowErrorLabel(err.reason, t)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {fieldErrors.length > 0 ? (
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">{t('products.fieldErrors.title')}</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('column.rowNumber')}</TableHead>
                <TableHead>{t('products.fieldErrors.column')}</TableHead>
                <TableHead>{t('column.reason')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fieldErrors.map((err, position) => (
                <TableRow key={position}>
                  <TableCell>{err.rowNumber}</TableCell>
                  <TableCell className="font-mono text-xs">{err.column}</TableCell>
                  <TableCell>{LABELLED_FIELD_ERRORS.has(err.code) ? t(`fieldError.${err.code}`) : err.code}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
