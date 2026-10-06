import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  QUOTE_REQUEST_STATUS_VALUES,
  type OpportunityWorkflow,
  type SetValueCountingStatusesRequest,
} from '@endora-commerce/contracts';
import { useModulePresence } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Checkbox } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { OrderStatusOption } from '../../api.js';
import { quoteRequestStatusKey } from '../../components/LinkedQuoteRequests.js';
import { errorMessage, orderStatusLabel } from '../../lib/labels.js';

type QuoteRequestStatusValue = SetValueCountingStatusesRequest['quoteRequest'][number];

export interface ValueCountingStatusesProps {
  workflow: OpportunityWorkflow;
  /** `null` when the Order statuses could not be read (no `orders:read`, or `orders` off). */
  orderStatuses: readonly OrderStatusOption[] | null;
  language: string;
  /** Replaces the whole set; resolves when the write was accepted (202). */
  onSave: (body: SetValueCountingStatusesRequest) => Promise<void>;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

/**
 * Which statuses make a linked document count towards a computed value
 * (User Story 8, FR-032): two groups of checkboxes, one for Order statuses and
 * one for Quote Request statuses, saved together as one set.
 *
 * **Saving is accepted, not finished.** The endpoint answers 202: the set is
 * stored at once and every computed Opportunity is recalculated afterwards by a
 * queue job. The confirmation says exactly that — until the job has run, the
 * lists and the board still show the figures of the previous set — rather than
 * a plain "saved" that would let those figures pass for final.
 *
 * **"This and every later status"** ticks an Order status together with all
 * that follow it in the Orders module's own order — the usual intent ("paid and
 * everything after it") in one press instead of five.
 *
 * A code that is saved but that the Orders module no longer lists stays on
 * screen, marked, so unticking it is possible; the Quote Request group is not
 * offered while that module is off, and what was saved for it is sent back
 * untouched.
 */
export function ValueCountingStatuses(props: ValueCountingStatusesProps): ReactNode {
  const { workflow, orderStatuses, language, onSave } = props;
  const t = useTranslation('crm');
  const { isPresent } = useModulePresence();
  const quotesPresent = isPresent('quote_requests');
  const orderLegendId = useId();
  const quoteLegendId = useId();

  const savedKey = JSON.stringify([
    sorted(workflow.valueCountingStatuses.order),
    sorted(workflow.valueCountingStatuses.quoteRequest),
  ]);
  const saved = useMemo(() => {
    const [order, quoteRequest] = JSON.parse(savedKey) as [string[], string[]];
    return { order: new Set(order), quoteRequest: new Set(quoteRequest) };
  }, [savedKey]);

  const [order, setOrder] = useState<Set<string>>(saved.order);
  const [quoteRequest, setQuoteRequest] = useState<Set<string>>(saved.quoteRequest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setOrder(saved.order);
    setQuoteRequest(saved.quoteRequest);
  }, [saved]);

  /** The Orders module's statuses in its order, then saved codes it no longer lists. */
  const orderRows = useMemo(() => {
    const known = (orderStatuses ?? []).map((status) => ({ code: status.code, known: true }));
    const listed = new Set(known.map((row) => row.code));
    const orphans = sorted(saved.order)
      .filter((code) => !listed.has(code))
      .map((code) => ({ code, known: orderStatuses === null }));
    return [...known, ...orphans];
  }, [orderStatuses, saved.order]);

  const dirty =
    JSON.stringify([sorted(order), sorted(quoteRequest)]) !== savedKey;

  const toggle = (
    set: Set<string>,
    apply: (next: Set<string>) => void,
    code: string,
    checked: boolean,
  ): void => {
    const next = new Set(set);
    if (checked) next.add(code);
    else next.delete(code);
    apply(next);
    setNotice('');
  };

  const tickFrom = (index: number): void => {
    const next = new Set(order);
    for (const row of orderRows.slice(index)) if (row.known) next.add(row.code);
    setOrder(next);
    setNotice('');
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      await onSave({
        order: sorted(order),
        quoteRequest: sorted(quoteRequest) as QuoteRequestStatusValue[],
      });
      setNotice(t('value.counting.accepted'));
    } catch (failure) {
      setError(errorMessage(failure, t('workflow.error.save')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5" aria-busy={busy}>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <fieldset aria-labelledby={orderLegendId} className="space-y-2">
        <legend id={orderLegendId} className="text-sm font-medium">
          {t('value.counting.order.legend')}
        </legend>
        {orderStatuses === null ? (
          <p className="text-sm text-muted-foreground">{t('value.counting.order.unreadable')}</p>
        ) : null}
        {orderRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('value.counting.order.none')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {orderRows.map((row, index) => {
              const name = orderStatusLabel(row.code, orderStatuses ?? [], language);
              return (
                <li
                  key={row.code}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-1"
                >
                  <label className="flex min-h-11 flex-1 items-center gap-2 text-sm">
                    <Checkbox
                      checked={order.has(row.code)}
                      disabled={busy}
                      onChange={(event): void =>
                        toggle(order, setOrder, row.code, event.target.checked)
                      }
                    />
                    <span>{name}</span>
                    {row.known ? null : (
                      <span className="text-xs text-muted-foreground">
                        {t('value.counting.order.gone')}
                      </span>
                    )}
                  </label>
                  {row.known && index < orderRows.length - 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11 sm:min-h-9"
                      disabled={busy}
                      aria-label={t('value.counting.order.andLaterLabel', { status: name })}
                      onClick={(): void => tickFrom(index)}
                    >
                      {t('value.counting.order.andLater')}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      {quotesPresent ? (
        <fieldset aria-labelledby={quoteLegendId} className="space-y-2">
          <legend id={quoteLegendId} className="text-sm font-medium">
            {t('value.counting.quote.legend')}
          </legend>
          <ul className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            {QUOTE_REQUEST_STATUS_VALUES.map((status) => (
              <li key={status}>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <Checkbox
                    checked={quoteRequest.has(status)}
                    disabled={busy}
                    onChange={(event): void =>
                      toggle(quoteRequest, setQuoteRequest, status, event.target.checked)
                    }
                  />
                  <span>{t(quoteRequestStatusKey(status))}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : (
        <p className="text-sm text-muted-foreground">{t('value.counting.quote.moduleOff')}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Mounted before it has text, so the announcement is reliable. */}
        <p role="status" className="max-w-prose text-sm text-muted-foreground">
          {notice}
        </p>
        <Button
          className="min-h-11 sm:min-h-9"
          disabled={!dirty || busy}
          aria-busy={busy}
          onClick={(): void => void save()}
        >
          {t('value.counting.save')}
        </Button>
      </div>
    </div>
  );
}
