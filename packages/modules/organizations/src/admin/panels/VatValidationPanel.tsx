import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { OrganizationTaxIdValidationRecord } from '@endora-commerce/contracts';
import { ApiError, apiClient, formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  attemptNotes,
  newestRegistrationRow,
  registryComparisonRows,
  vatStatusKey,
} from './vat-validation-view.js';

type Outcome = 'validated' | 'failed' | 'deferred' | 'unverified';
type Provider = OrganizationTaxIdValidationRecord['provider'];
type ValidationRecord = OrganizationTaxIdValidationRecord;

export interface VatValidationPanelProps {
  organizationId: string;
  /** Current "last validation" summary fields from the Organization detail. */
  summary: {
    outcome: Outcome | null;
    provider: Provider | null;
    validatedAt: string | null;
  };
  /** Called after a successful trigger so the parent can re-fetch the Organization. */
  onChanged: () => void | Promise<void>;
  /** Feature 173 — the heading's id, so the moderation notice can link here. */
  headingId?: string;
  /** Feature 173 — the history as loaded, for the moderation notice's divergence count. */
  onHistoryLoaded?: (items: readonly ValidationRecord[]) => void;
}

/**
 * A provider's label. `gus_pl` (feature 173) is worded in this module's bundle;
 * the three older providers keep their `core` keys.
 */
function useProviderLabel(): (provider: Provider) => string {
  const t = useTranslation('core');
  const tm = useTranslation('organizations');
  return (provider) =>
    provider === 'gus_pl' ? tm('vatValidation.provider.gus_pl') : t(`organizations.vatValidation.provider.${provider}`);
}

/**
 * VatValidationPanel — admin surface for feature 026 US7.
 *
 * Top section: summary chip + "Validate now" + "Validate now (auto-fill)".
 * Bottom section: validation-attempt history (newest first), one row
 * per call against VIES / Ministerstwo Finansów / format-only path.
 *
 * The auto-fill button is only enabled when the most recent result was
 * `validated` AND carried a `legalNameReturned`. Clicking it re-runs
 * validation with `applyAutoFill: true` — the backend stamps the org's
 * `legalName` + bumps `version` atomically.
 */
export function VatValidationPanel(props: VatValidationPanelProps): ReactNode {
  const t = useTranslation('core');
  const tm = useTranslation('organizations');
  const providerLabel = useProviderLabel();
  // Held in a ref: a parent's inline callback must not re-create `refresh`
  // and so re-run the load on every render.
  const onHistoryLoaded = useRef(props.onHistoryLoaded);
  onHistoryLoaded.current = props.onHistoryLoaded;
  const [items, setItems] = useState<ValidationRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const res = await apiClient.get<{ items: ValidationRecord[] }>(
        `/api/v1/admin/organizations/${props.organizationId}/vat-validations`,
      );
      setItems(res.items);
      onHistoryLoaded.current?.(res.items);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.envelope.error.message
          : t('organizations.vatValidation.error.load'),
      );
    }
  }, [props.organizationId, t]);

  useEffect((): void => {
    void refresh();
  }, [refresh]);

  const trigger = useCallback(
    async (applyAutoFill: boolean): Promise<void> => {
      if (busy) return;
      setBusy(true);
      setError(null);
      setInfo(null);
      try {
        const res = await apiClient.post<{ outcome: Outcome; errorKind: string | null }>(
          `/api/v1/admin/organizations/${props.organizationId}/vat-validations`,
          { providerHint: 'auto', applyAutoFill },
        );
        setInfo(t(`organizations.vatValidation.success.${res.outcome}`));
        await Promise.all([refresh(), props.onChanged()]);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.envelope.error.message
            : t('organizations.vatValidation.error.trigger'),
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, props, refresh, t],
  );

  const registration = newestRegistrationRow(items);
  const lastOutcome = items[0]?.outcome ?? props.summary.outcome;
  const lastHasLegalName = Boolean(items[0]?.legalNameReturned);
  const canAutoFill = lastOutcome === 'validated' && lastHasLegalName;

  return (
    <Card>
      <CardHeader>
        <CardTitle id={props.headingId} className="scroll-mt-4">
          {t('organizations.vatValidation.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert variant="success">
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {t('organizations.vatValidation.lastResult')}:
          </span>
          <OutcomeBadge outcome={props.summary.outcome} />
          {props.summary.provider ? (
            <span className="text-muted-foreground">
              {providerLabel(props.summary.provider)}
            </span>
          ) : null}
          {props.summary.validatedAt ? (
            <span className="text-muted-foreground">
              · {formatDateTime(props.summary.validatedAt)}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={(): void => void trigger(false)} disabled={busy}>
            {t('organizations.vatValidation.action.validateNow')}
          </Button>
          <Button
            variant="outline"
            onClick={(): void => void trigger(true)}
            disabled={busy || !canAutoFill}
            title={
              !canAutoFill
                ? t('organizations.vatValidation.action.autoFillHint')
                : undefined
            }
          >
            {t('organizations.vatValidation.action.validateAndAutoFill')}
          </Button>
        </div>

        {registration ? <RegistrySnapshotCard row={registration} /> : null}

        {items.length > 0 ? (
          <div className="pt-2">
            <h4 className="mb-2 text-sm font-medium text-muted-foreground">
              {t('organizations.vatValidation.historyTitle')}
            </h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('organizations.vatValidation.column.when')}</TableHead>
                  <TableHead>{tm('vatValidation.column.origin')}</TableHead>
                  <TableHead>{t('organizations.vatValidation.column.provider')}</TableHead>
                  <TableHead>{t('organizations.vatValidation.column.outcome')}</TableHead>
                  <TableHead>{t('organizations.vatValidation.column.legalName')}</TableHead>
                  <TableHead>{t('organizations.vatValidation.column.error')}</TableHead>
                  <TableHead>{tm('vatValidation.column.details')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{formatDateTime(r.createdAt)}</TableCell>
                    <TableCell className="text-xs">{tm(`vatValidation.origin.${r.origin}`)}</TableCell>
                    <TableCell className="text-xs">{providerLabel(r.provider)}</TableCell>
                    <TableCell>
                      <OutcomeBadge outcome={r.outcome} />
                    </TableCell>
                    <TableCell className="text-xs">{r.legalNameReturned ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.errorKind ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <RegistrationDetails row={r} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Feature 173 — a registration row's details: the Polish sources in force, the
 * VAT and activity status, the REGON, and every registry that failed or was not
 * asked. Nothing for an administrator's row.
 */
function RegistrationDetails({ row }: { row: ValidationRecord }): ReactNode {
  const tm = useTranslation('organizations');
  const details = row.registryDetails;
  if (!details) return '—';
  const vat = vatStatusKey(row);
  const lines: string[] = [];
  if (details.plSources) {
    lines.push(tm('vatValidation.sources', { sources: tm(`vatValidation.plSources.${details.plSources}`) }));
  }
  if (vat) lines.push(tm(`vatValidation.vatStatus.${vat}`));
  if (details.activityStatus === 'ceased') lines.push(tm('vatValidation.activity.ceased'));
  if (details.regon) lines.push(tm('vatValidation.regon', { regon: details.regon }));
  for (const note of attemptNotes(row)) {
    lines.push(
      tm('vatValidation.attempt.failed', {
        provider: tm(`vatValidation.provider.${note.provider}`),
        reason: tm(`vatValidation.attempt.reason.${note.reason}`),
      }),
    );
  }
  return (
    <ul className="m-0 list-none space-y-0.5 p-0">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/**
 * Feature 173 — "Registry data at registration": what the registry answered
 * beside what the customer submitted, field by field. A differing field carries
 * an icon **and** the word, never colour alone (WCAG 1.4.1).
 */
function RegistrySnapshotCard({ row }: { row: ValidationRecord }): ReactNode {
  const tm = useTranslation('organizations');
  const providerLabel = useProviderLabel();
  const rows = registryComparisonRows(row);
  const details = row.registryDetails;
  const hasRegistryData = rows.some((entry) => entry.registry !== null && entry.registry !== '');
  const anyDiffers = rows.some((entry) => entry.differs);
  return (
    <section className="rounded-md border p-3" aria-labelledby={`registry-snapshot-${row.id}`}>
      <h4 id={`registry-snapshot-${row.id}`} className="m-0 text-sm font-medium">
        {tm('vatValidation.registry.heading')}
      </h4>
      <p className="mt-1 mb-2 text-xs text-muted-foreground">
        {tm('vatValidation.registry.fetchedFrom', {
          source: providerLabel(details?.dataSource ?? row.provider),
          when: formatDateTime(details?.fetchedAt ?? row.createdAt),
        })}
      </p>
      {!hasRegistryData ? (
        <p className="m-0 text-sm text-muted-foreground">{tm('vatValidation.registry.empty')}</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tm('vatValidation.registry.column.field')}</TableHead>
                <TableHead>{tm('vatValidation.registry.column.registry')}</TableHead>
                <TableHead>{tm('vatValidation.registry.column.submitted')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((entry) => (
                <TableRow key={entry.field}>
                  <TableCell className="text-xs font-medium">
                    {tm(`vatValidation.registry.field.${entry.field}`)}
                  </TableCell>
                  <TableCell className="text-xs">{entry.registry ?? '—'}</TableCell>
                  <TableCell className="text-xs">
                    <span>{entry.submitted}</span>
                    {entry.differs ? (
                      // The admin kit's warning badge (Principle IX): its own dark-mode
                      // pair, where a bare amber text colour fell below 4.5:1.
                      <Badge variant="warning" className="ml-2 gap-1">
                        <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" />
                        {tm('vatValidation.registry.differs')}
                      </Badge>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!anyDiffers ? (
            <p className="mt-2 mb-0 text-sm text-muted-foreground">{tm('vatValidation.registry.matches')}</p>
          ) : null}
        </>
      )}
    </section>
  );
}

function OutcomeBadge({ outcome }: { outcome: Outcome | null }): ReactNode {
  const t = useTranslation('core');
  if (!outcome) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const palette: Record<Outcome, string> = {
    validated: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    failed: 'bg-rose-100 text-rose-900 border-rose-300',
    deferred: 'bg-amber-100 text-amber-900 border-amber-300',
    unverified: 'bg-slate-200 text-slate-700 border-slate-300',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${palette[outcome]}`}
    >
      {t(`organizations.vatValidation.outcome.${outcome}`)}
    </span>
  );
}
