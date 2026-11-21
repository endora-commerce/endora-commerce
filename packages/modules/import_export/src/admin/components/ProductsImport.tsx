import { useEffect, useId, useState, type ChangeEvent, type ReactNode } from 'react';
import { Check, FileSearch } from 'lucide-react';
import type { ImportProfile } from '@endora-commerce/contracts';
import { apiClient, cn } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  EditorSection,
  InlineStatus,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { errorMessage } from './import-profiles-api.js';

/**
 * The products import step (feature 174, `contracts/import-profiles-and-csv.md` §2 and §4): a
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
  // Feature 172 (FR-041) — a cell under a Page Builder content attribute's column.
  'content_attribute',
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

/** Codes of catalog's refusals of a whole product (`<CODE>: <message>`) that carry their own label. */
const LABELLED_ROW_CODES = new Set(['PRODUCT_NOT_FOUND']);

function rowErrorLabel(reason: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  for (const { pattern, key, param } of ROW_ERRORS) {
    const match = pattern.exec(reason);
    if (match) return param ? t(key, { [param]: match[1] ?? '' }) : t(key);
  }
  // Any other refusal of the whole product: its label when there is one, else a translated lead
  // with the server's sentence as detail. The code itself is never shown.
  const coded = /^([A-Z][A-Z0-9_]*): (.*)$/s.exec(reason);
  if (coded) {
    const [, code = '', message = ''] = coded;
    return LABELLED_ROW_CODES.has(code) ? t(`rowError.${code}`) : t('rowError.refused', { message });
  }
  return reason;
}

/** The three steps of a products import, in order (issue #1528). */
export const PRODUCTS_IMPORT_STEPS = ['profile', 'check', 'apply'] as const;
export type ProductsImportStep = (typeof PRODUCTS_IMPORT_STEPS)[number];

/**
 * Which step the operator is on: choosing a profile until one is chosen, checking a file until a
 * dry run is pending, then applying it. A finished import stays on its last step, done.
 */
export function productsImportStep(state: {
  profileId: string;
  pending: boolean;
  applied: boolean;
}): { current: ProductsImportStep; done: boolean } {
  if (state.profileId === '') return { current: 'profile', done: false };
  if (state.pending) return { current: 'apply', done: false };
  if (state.applied) return { current: 'apply', done: true };
  return { current: 'check', done: false };
}

export interface ProductsImportProps {
  profiles: ImportProfile[];
  profilesLoading: boolean;
  /** The profile list could not be read: step 1 says so, with a retry, rather than "none yet". */
  profilesError?: boolean;
  onRetryProfiles?: () => void;
  /** Opens the page's profiles section beside its use (Proximity). Absent: no link. */
  onManageProfiles?: () => void;
  /** Opens the create-profile dialog, for an operator who has none yet (Tesler). */
  onCreateProfile?: () => void;
}

export function ProductsImport({
  profiles,
  profilesLoading,
  profilesError = false,
  onRetryProfiles,
  onManageProfiles,
  onCreateProfile,
}: ProductsImportProps): ReactNode {
  const t = useTranslation('import_export');
  const profileSelectId = useId();
  const [profileId, setProfileId] = useState('');
  const profileHintId = useId();
  // With exactly one profile there is nothing to choose: preselect it (final design review).
  useEffect(() => {
    if (profileId === '' && profiles.length === 1) setProfileId(profiles[0]!.id);
    if (profileId !== '' && !profiles.some((profile) => profile.id === profileId)) setProfileId('');
  }, [profiles, profileId]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ csv: string; report: ProductsImportReport } | null>(null);
  const [applied, setApplied] = useState<ProductsImportReport | null>(null);
  // An error belongs to the step that produced it: a failed check under the file control, a
  // failed apply beside Apply, where the checked file is still waiting.
  const [requestError, setRequestError] = useState<{ step: 'check' | 'apply'; message: string } | null>(null);
  const status = useInlineStatus();

  const post = (csv: string, dryRun: boolean): Promise<{ data: ProductsImportReport }> => {
    const qs = new URLSearchParams({ profileId });
    if (dryRun) qs.set('dryRun', 'true');
    return apiClient.post<{ data: ProductsImportReport }>(`/api/v1/admin/import/products?${qs.toString()}`, csv, {
      headers: { 'Content-Type': 'text/csv' },
    });
  };

  const partial = (report: ProductsImportReport): boolean =>
    report.errors.length > 0 || (report.fieldErrors?.length ?? 0) > 0;

  const onFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || profileId === '') return;
    setBusy(true);
    setPending(null);
    setApplied(null);
    setRequestError(null);
    status.clear();
    try {
      const csv = await file.text();
      const res = await post(csv, true);
      setPending({ csv, report: res.data });
      status.show(
        t('products.dryRunSummary', { count: res.data.imported, refused: res.data.errors.length }),
        partial(res.data) ? 'warning' : 'info',
      );
    } catch (err) {
      setRequestError({ step: 'check', message: errorMessage(err, t, 'error.import') });
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
      status.show(
        t('products.applied', { count: res.data.imported, refused: res.data.errors.length }),
        partial(res.data) ? 'warning' : 'success',
      );
    } catch (err) {
      setRequestError({ step: 'apply', message: errorMessage(err, t, 'error.import') });
    } finally {
      setBusy(false);
    }
  };

  const discard = (): void => {
    setPending(null);
    setRequestError(null);
    status.clear();
  };

  const noProfile = !profilesLoading && !profilesError && profiles.length === 0;
  const step = productsImportStep({ profileId, pending: pending !== null, applied: applied !== null });
  const currentIndex = PRODUCTS_IMPORT_STEPS.indexOf(step.current);

  return (
    <div className="space-y-3">
      {/* Zeigarnik / Goal-Gradient (issue #1528): the operator always sees where they are. */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          {t('products.step', { current: currentIndex + 1, total: PRODUCTS_IMPORT_STEPS.length })}
        </p>
        <ol aria-label={t('products.steps')} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {PRODUCTS_IMPORT_STEPS.map((key, index) => {
            const complete = index < currentIndex || (index === currentIndex && step.done);
            const current = index === currentIndex;
            return (
              <li
                key={key}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-1.5',
                  index > 0 && "before:mr-0.5 before:h-px before:w-4 before:bg-border before:content-['']",
                  current ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full border text-xs tabular-nums',
                    complete
                      ? 'border-primary bg-primary text-primary-foreground'
                      : current
                        ? 'border-primary text-foreground'
                        : 'border-border',
                  )}
                >
                  {complete ? <Check className="size-3" /> : index + 1}
                </span>
                <span>{t(`products.step.${key}`)}</span>
                {complete ? <span className="sr-only">{t('products.step.complete')}</span> : null}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor={profileSelectId}>{t('products.profile')}</Label>
            {/* Proximity (issue #1528): the prerequisite is managed next to where it is used. */}
            {onManageProfiles && !noProfile ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs max-lg:min-h-11"
                onClick={onManageProfiles}
              >
                {t('products.manageProfiles')}
              </Button>
            ) : null}
          </div>
          <Select
            id={profileSelectId}
            value={profileId}
            disabled={busy || noProfile || profilesError}
            required
            onChange={(event): void => {
              setProfileId(event.target.value);
              // A dry run belongs to the profile it was planned with.
              setPending(null);
              setApplied(null);
              setRequestError(null);
              status.clear();
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
          className={cn(
            'max-lg:min-h-11 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
            profileId === '' ? 'cursor-not-allowed opacity-50' : busy ? 'cursor-wait opacity-70' : 'cursor-pointer',
          )}
        >
          <label className="relative" aria-busy={busy && pending === null ? true : undefined}>
            <FileSearch />
            {busy && pending === null ? t('products.checking') : t('products.checkFile')}
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy || profileId === ''}
              aria-describedby={profileId === '' && !noProfile && !profilesError ? profileHintId : undefined}
              onChange={(event): void => {
                void onFile(event);
              }}
              className="absolute inset-0 cursor-[inherit] opacity-0"
            />
          </label>
        </Button>
      </div>
      {profilesError ? (
        <Alert variant="destructive" live="off">
          <AlertDescription>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex-1">{t('products.profilesError')}</span>
              {onRetryProfiles ? (
                <Button type="button" variant="outline" size="sm" className="max-lg:min-h-11" onClick={onRetryProfiles}>
                  {t('importProfiles.retry')}
                </Button>
              ) : null}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      {noProfile ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t('products.noProfile')}</span>
          {onCreateProfile ? (
            <Button type="button" variant="outline" size="sm" className="max-lg:min-h-11" onClick={onCreateProfile}>
              {t('products.createProfile')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {profileId === '' && !noProfile && !profilesLoading && !profilesError ? (
        <p id={profileHintId} className="text-xs text-muted-foreground">
          {t('products.chooseProfileFirst')}
        </p>
      ) : null}

      {requestError?.step === 'check' ? (
        <Alert variant="destructive">
          <AlertDescription>{requestError.message}</AlertDescription>
        </Alert>
      ) : null}

      {/* Mounted before it has text, so the dry run's and the apply's results are announced. */}
      <InlineStatus {...status.props} data-testid="products-import-status" />

      {pending !== null ? (
        <EditorSection as="h3" title={t('products.review.title')} className="border-t pt-3">
          <ReportDetails report={pending.report} />
          {requestError?.step === 'apply' ? (
            <Alert variant="destructive">
              <AlertDescription>{requestError.message}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={discard}>
              {t('products.cancel')}
            </Button>
            <Button
              type="button"
              disabled={busy}
              aria-busy={busy ? true : undefined}
              onClick={(): void => {
                void apply();
              }}
            >
              {busy ? t('products.applying') : t('products.apply')}
            </Button>
          </div>
        </EditorSection>
      ) : null}

      {applied !== null ? <ReportDetails report={applied} /> : null}
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
        <Alert variant="warning" live="polite">
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
