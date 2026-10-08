import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Calculator, PencilLine } from 'lucide-react';
import type {
  OpportunityDetail,
  OpportunityExcludedDocument,
  OpportunityValueMode,
} from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { errorMessage, moneyLabel } from '../lib/labels.js';

/** The reasons a counting document is left out that this screen has a sentence for. */
const KNOWN_REASONS: ReadonlySet<string> = new Set(['currency_mismatch']);

export interface OpportunityValueProps {
  opportunity: OpportunityDetail;
  /** `crm:write` — without it the value is shown and its mode cannot be changed. */
  canWrite: boolean;
  onChange: (next: OpportunityDetail) => void;
  reload: () => Promise<void>;
}

/**
 * The value of an Opportunity and where it comes from (User Story 8,
 * FR-030 – FR-033): the figure, whether it is typed in or computed from the
 * linked documents, and — for a computed one — the documents that would count
 * but were left out, each with the reason.
 *
 * **Switching the mode is one press and loses nothing.** The typed estimate is
 * kept while the value is computed, shown beside it, and is back the moment the
 * mode is switched again; the amount itself is edited with the rest of the
 * details. The switch sends the version it was read at: when somebody changed
 * the Opportunity meanwhile it is read again and the operator is told, instead
 * of a mode being set on a state they have not seen.
 *
 * It is one labelled fact of the screen's sidebar — a group under an `h3`, not
 * a landmark of its own — so the figure, its mode and the switch stack in a
 * narrow column.
 *
 * A document is named by its number when the link carries one, and links to its
 * own screen; one this reader cannot see is named by its kind alone.
 */
export function OpportunityValue(props: OpportunityValueProps): ReactNode {
  const { opportunity, canWrite, onChange, reload } = props;
  const t = useTranslation('crm');
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const computed = opportunity.valueMode === 'computed';

  const switchTo = async (valueMode: OpportunityValueMode): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      onChange(await crmApi.updateOpportunity(opportunity.id, { valueMode }, opportunity.version));
      setNotice(
        valueMode === 'computed' ? t('value.switched.computed') : t('value.switched.manual'),
      );
    } catch (failure) {
      if (
        failure instanceof ApiError &&
        failure.status === 409 &&
        failure.envelope.error.code === 'VERSION_CONFLICT'
      ) {
        await reload();
        setError(t('value.error.conflict'));
      } else {
        setError(errorMessage(failure, t('value.error.switch')));
      }
    } finally {
      setBusy(false);
    }
  };

  const describe = (excluded: OpportunityExcludedDocument): ReactNode => {
    const link = opportunity.links.find(
      (item) => item.documentKind === excluded.kind && item.documentId === excluded.id,
    );
    const kind = t(`value.excluded.kind.${excluded.kind}`);
    const reason = KNOWN_REASONS.has(excluded.reason)
      ? t(`value.excluded.reason.${excluded.reason}`, { currency: opportunity.currency })
      : t('value.excluded.reason.other');
    const to = excluded.kind === 'order' ? `/orders/${excluded.id}` : `/quote-requests/${excluded.id}`;
    return (
      <>
        <span className="font-medium">
          {kind}{' '}
          {link?.available && link.number ? (
            <Link to={to} className="text-primary underline-offset-4 hover:underline">
              {link.number}
            </Link>
          ) : null}
        </span>
        {link?.available && link.total ? (
          <span className="tabular-nums text-muted-foreground">
            {' '}
            ({moneyLabel(link.total, link.currency ?? opportunity.currency)})
          </span>
        ) : null}
        <span>{' — '}{reason}</span>
      </>
    );
  };

  return (
    <div role="group" aria-labelledby={headingId} className="space-y-2" aria-busy={busy}>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div className="space-y-0.5">
          <h3 id={headingId} className="text-xs font-normal text-muted-foreground">
            {t('value.title')}
          </h3>
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-semibold tabular-nums">
              {moneyLabel(
                computed ? opportunity.computedValue : opportunity.manualValue,
                opportunity.currency,
              )}
            </span>
            <Badge variant="outline" className="gap-1 font-normal">
              {computed ? (
                <Calculator aria-hidden="true" className="size-3.5" />
              ) : (
                <PencilLine aria-hidden="true" className="size-3.5" />
              )}
              {computed ? t('value.mode.computed') : t('value.mode.manual')}
            </Badge>
          </p>
        </div>
        {canWrite ? (
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-9"
            disabled={busy}
            aria-busy={busy}
            onClick={(): void => void switchTo(computed ? 'manual' : 'computed')}
          >
            {computed ? t('value.switch.toManual') : t('value.switch.toComputed')}
          </Button>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <p className="max-w-prose text-xs text-muted-foreground">
        {computed ? t('value.hint.computed') : t('value.hint.manual')}
      </p>

      {computed && opportunity.manualValue !== null ? (
        <p className="text-sm text-muted-foreground">
          {t('value.estimateKept', {
            amount: moneyLabel(opportunity.manualValue, opportunity.currency),
          })}
        </p>
      ) : null}

      {computed && opportunity.excludedDocuments.length > 0 ? (
        <div className="space-y-1">
          <h4 className="text-sm font-medium">{t('value.excluded.title')}</h4>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {opportunity.excludedDocuments.map((excluded) => (
              <li key={`${excluded.kind}:${excluded.id}`}>{describe(excluded)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Mounted before it has text, so the announcement is reliable. */}
      <p role="status" className="sr-only">
        {notice}
      </p>
    </div>
  );
}
