import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, MinusCircle, RotateCw, X } from 'lucide-react';
import type { PropagationOutcome } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi, type OrderStatusOption } from '../api.js';
import { errorMessage, orderStatusLabel } from '../lib/labels.js';

type Tone = 'done' | 'neutral' | 'refused';

/** How an outcome reads at a glance. The sentence beside the icon says the same in words. */
const TONE: Record<PropagationOutcome['outcome'], Tone> = {
  applied: 'done',
  already_there: 'neutral',
  skipped: 'neutral',
  not_found: 'refused',
  unknown_status: 'refused',
  not_permitted: 'refused',
  vetoed: 'refused',
  failed: 'refused',
};

export interface PropagationOutcomesProps {
  opportunityId: string;
  /** What to show: the outcomes of the last move, then older refusals still open. */
  outcomes: readonly PropagationOutcome[];
  /** The ids the server still counts as unresolved — the ones *Retry* and *Dismiss* address. */
  unresolvedIds: ReadonlySet<string>;
  orderStatuses: readonly OrderStatusOption[];
  language: string;
  /** `crm:write` — without it a refusal is shown and cannot be acted on. */
  canWrite: boolean;
  /** A retry was answered: `previousId` is settled and `outcome` is what the Order said this time. */
  onRetried: (previousId: string, outcome: PropagationOutcome) => Promise<void>;
  onDismissed: (id: string) => Promise<void>;
}

/**
 * What became of each linked Order when the Opportunity moved (FR-021 –
 * FR-023).
 *
 * A refused Order change is not an error of the move — the Opportunity did
 * move — so it is reported here, per Order, with the Order workflow's own
 * reason, and it stays until someone retries it (usually after correcting the
 * mapping or the Order) or dismisses it.
 */
export function PropagationOutcomes(props: PropagationOutcomesProps): ReactNode {
  const { opportunityId, outcomes, unresolvedIds, orderStatuses, language, canWrite } = props;
  const t = useTranslation('crm');
  const headingId = useId();
  const rowId = useId();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const run = async (id: string, action: () => Promise<string>): Promise<void> => {
    setBusyId(id);
    setError(null);
    setNotice('');
    try {
      setNotice(await action());
    } catch (failure) {
      setError(errorMessage(failure, t('propagation.error')));
    } finally {
      setBusyId(null);
    }
  };

  const retry = (outcome: PropagationOutcome): Promise<void> =>
    run(outcome.id, async () => {
      const next = await crmApi.retryPropagation(opportunityId, outcome.id);
      await props.onRetried(outcome.id, next);
      return t('propagation.retried');
    });

  const dismiss = (outcome: PropagationOutcome): Promise<void> =>
    run(outcome.id, async () => {
      await crmApi.dismissPropagation(opportunityId, outcome.id);
      await props.onDismissed(outcome.id);
      return t('propagation.dismissed');
    });

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-sm font-semibold tracking-tight">
        {t('propagation.title')}
      </h2>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {outcomes.length === 0 ? (
        // Everything shown during this visit has been settled. The section
        // stays, so the confirmation has somewhere to be read.
        <p className="text-sm text-muted-foreground">{t('propagation.empty')}</p>
      ) : null}
      <ul className={outcomes.length === 0 ? 'hidden' : 'divide-y divide-border rounded-md border'}>
        {outcomes.map((outcome) => {
          const tone = TONE[outcome.outcome];
          const status = orderStatusLabel(outcome.orderStatusCode, orderStatuses, language);
          const actionable = canWrite && unresolvedIds.has(outcome.id);
          const describedBy = `${rowId}-${outcome.id}`;
          const Icon = tone === 'done' ? CheckCircle2 : tone === 'refused' ? AlertTriangle : MinusCircle;
          return (
            <li
              key={outcome.id}
              className="flex flex-wrap items-start justify-between gap-3 p-3"
              aria-busy={busyId === outcome.id}
            >
              <div className="flex min-w-0 items-start gap-2">
                <Icon
                  aria-hidden="true"
                  className={
                    tone === 'done'
                      ? 'mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-400'
                      : tone === 'refused'
                        ? 'mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400'
                        : 'mt-0.5 size-4 shrink-0 text-muted-foreground'
                  }
                />
                <div className="min-w-0 space-y-0.5 text-sm">
                  <p id={describedBy}>
                    <Link
                      to={`/orders/${outcome.orderId}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {outcome.orderNumber
                        ? t('propagation.order', { number: outcome.orderNumber })
                        : t('propagation.orderUnknown')}
                    </Link>
                  </p>
                  <p>{t(`propagation.outcome.${outcome.outcome}`, { status })}</p>
                  {outcome.detail ? (
                    <p className="break-words text-xs text-muted-foreground">{outcome.detail}</p>
                  ) : null}
                </div>
              </div>
              {actionable ? (
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:min-h-8"
                    disabled={busyId !== null}
                    aria-describedby={describedBy}
                    onClick={(): void => void retry(outcome)}
                  >
                    <RotateCw aria-hidden="true" />
                    {t('propagation.retry')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11 sm:min-h-8"
                    disabled={busyId !== null}
                    aria-describedby={describedBy}
                    onClick={(): void => void dismiss(outcome)}
                  >
                    <X aria-hidden="true" />
                    {t('propagation.dismiss')}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p role="status" className="sr-only">
        {notice}
      </p>
    </section>
  );
}
