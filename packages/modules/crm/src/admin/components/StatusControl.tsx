import { useId, useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import type { OpportunityDetail, OpportunityTransitionResult } from '@endora-commerce/contracts';
import { ApiError, formatDateTime, statusBadgeStyle } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Input,
  Label,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { errorMessage } from '../lib/labels.js';

export interface StatusControlProps {
  opportunity: OpportunityDetail;
  /** `crm:write` — without it the status is shown and cannot be changed. */
  canWrite: boolean;
  /** The Opportunity moved: the server's answer, with what became of its Orders. */
  onMoved: (result: OpportunityTransitionResult) => void;
  /** Read the Opportunity again, after a refusal that says it has changed. */
  reload: () => Promise<void>;
}

/**
 * The Opportunity's status and the moves the workflow allows from it.
 *
 * **Only `allowedTransitions` is offered** — the list the server computed from
 * the configured graph — one button per target, so a move is one press and a
 * move the workflow lacks is not on screen to be attempted (FR-015, FR-016).
 * The server still decides: a guard's veto or a concurrent change is shown in
 * its own words, and nothing on screen changes.
 *
 * A move may carry a **reason** (`contracts/admin-api.md` §2, optional): what is
 * written in the field goes with the next move and is recorded in the
 * Opportunity's history. It is never required — a required reason would make
 * every move two steps.
 */
export function StatusControl(props: StatusControlProps): ReactNode {
  const { opportunity, canWrite, onMoved, reload } = props;
  const t = useTranslation('crm');
  const labelId = useId();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [movingTo, setMovingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const move = async (to: string): Promise<void> => {
    setMovingTo(to);
    setError(null);
    setNotice('');
    try {
      const result = await crmApi.transition(opportunity.id, to, reason.trim() || undefined);
      onMoved(result);
      // A reason belongs to one change; the next one starts without it.
      setReason('');
      setNotice(t('opportunity.status.moved', { status: result.opportunity.status.name }));
    } catch (failure) {
      setError(errorMessage(failure, t('opportunity.status.error')));
      // 409 says the Opportunity is not where this screen thought it was (or a
      // rule refused the move): show what is true now.
      if (failure instanceof ApiError && failure.status === 409) void reload();
    } finally {
      setMovingTo(null);
    }
  };

  const transitions = opportunity.allowedTransitions;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t('opportunity.status.current')}</span>
        <Badge className="font-medium" style={statusBadgeStyle(opportunity.status.color)}>
          {opportunity.status.name}
        </Badge>
        {opportunity.closedKind && opportunity.closedAt ? (
          <span className="text-muted-foreground">
            {t(`opportunity.status.closed.${opportunity.closedKind}`, {
              date: formatDateTime(opportunity.closedAt),
            })}
          </span>
        ) : null}
      </div>

      {!canWrite ? (
        <p className="text-sm text-muted-foreground">{t('opportunity.status.noPermission')}</p>
      ) : transitions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('opportunity.status.none')}</p>
      ) : (
        <>
          <div
            role="group"
            aria-labelledby={labelId}
            aria-busy={movingTo !== null}
            className="flex flex-wrap items-center gap-2"
          >
            <span
              id={labelId}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground"
            >
              {t('opportunity.status.moveTo')}
              <ArrowRight aria-hidden="true" className="size-4" />
            </span>
            {transitions.map((target) => (
              <Button
                key={target.code}
                variant="outline"
                className="min-h-11 sm:min-h-9"
                disabled={movingTo !== null}
                aria-busy={movingTo === target.code}
                onClick={(): void => void move(target.code)}
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full border border-black/10"
                  style={{ backgroundColor: target.color }}
                />
                {target.name}
              </Button>
            ))}
          </div>
          <div className="max-w-xl space-y-1">
            <Label htmlFor={reasonId}>{t('opportunity.status.reason')}</Label>
            <Input
              id={reasonId}
              value={reason}
              maxLength={2000}
              disabled={movingTo !== null}
              aria-describedby={`${reasonId}-hint`}
              onChange={(event): void => setReason(event.target.value)}
            />
            <p id={`${reasonId}-hint`} className="text-xs text-muted-foreground">
              {t('opportunity.status.reasonHint')}
            </p>
          </div>
        </>
      )}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {/* For assistive technology only — the badge above is the visible
          confirmation. Mounted before it has text, so the announcement is
          reliable. */}
      <p role="status" className="sr-only">
        {notice}
      </p>
    </div>
  );
}
