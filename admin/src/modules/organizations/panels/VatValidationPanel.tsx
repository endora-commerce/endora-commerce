import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { useTranslation } from '@/i18n/useTranslation';

type Outcome = 'validated' | 'failed' | 'deferred' | 'unverified';

interface ValidationRecord {
  id: string;
  provider: 'vies' | 'mf_pl' | 'format_only';
  outcome: Outcome;
  taxIdValue: string;
  legalNameReturned: string | null;
  errorKind: string | null;
  createdAt: string;
}

export interface VatValidationPanelProps {
  organizationId: string;
  /** Current "last validation" summary fields from the Organization detail. */
  summary: {
    outcome: Outcome | null;
    provider: 'vies' | 'mf_pl' | 'format_only' | null;
    validatedAt: string | null;
  };
  /** Called after a successful trigger so the parent can re-fetch the Organization. */
  onChanged: () => void | Promise<void>;
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

  const lastOutcome = items[0]?.outcome ?? props.summary.outcome;
  const lastHasLegalName = Boolean(items[0]?.legalNameReturned);
  const canAutoFill = lastOutcome === 'validated' && lastHasLegalName;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('organizations.vatValidation.title')}</CardTitle>
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
              {t(`organizations.vatValidation.provider.${props.summary.provider}`)}
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

        {items.length > 0 ? (
          <div className="pt-2">
            <h4 className="mb-2 text-sm font-medium text-muted-foreground">
              {t('organizations.vatValidation.historyTitle')}
            </h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('organizations.vatValidation.column.when')}</TableHead>
                  <TableHead>{t('organizations.vatValidation.column.provider')}</TableHead>
                  <TableHead>{t('organizations.vatValidation.column.outcome')}</TableHead>
                  <TableHead>{t('organizations.vatValidation.column.legalName')}</TableHead>
                  <TableHead>{t('organizations.vatValidation.column.error')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{formatDateTime(r.createdAt)}</TableCell>
                    <TableCell className="text-xs">
                      {t(`organizations.vatValidation.provider.${r.provider}`)}
                    </TableCell>
                    <TableCell>
                      <OutcomeBadge outcome={r.outcome} />
                    </TableCell>
                    <TableCell className="text-xs">{r.legalNameReturned ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.errorKind ?? '—'}
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
