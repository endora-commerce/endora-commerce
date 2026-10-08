import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Check, CircleX, Trophy } from 'lucide-react';
import type {
  OpportunityDetail,
  OpportunityTransitionResult,
  OpportunityWorkflow,
} from '@endora-commerce/contracts';
import { ApiError, cn, formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Input, Label } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { errorMessage, workflowStatusLabel } from '../lib/labels.js';
import { stageModel } from '../lib/stage-model.js';

export interface StageBarProps {
  opportunity: OpportunityDetail;
  /** `crm:write` — without it the bar is a picture and nothing in it can be pressed. */
  canWrite: boolean;
  /** The Opportunity moved: the server's answer, with what became of its Orders. */
  onMoved: (result: OpportunityTransitionResult) => void;
  /** Read the Opportunity again, after a refusal that says it has changed. */
  reload: () => Promise<void>;
}

/**
 * The Opportunity's place in the workflow, and the moves allowed from it
 * (`specs/143-crm-sales-opportunities/`, User Story 20; FR-015, FR-016).
 *
 * One ordered list of the workflow's statuses — see {@link stageModel} for what
 * it claims and what it does not. **A status the workflow allows from here is a
 * button; every other one is text.** Pressing it is the one transition path
 * this screen has ever had: `POST …/transition` with the optional reason typed
 * below, the server's own sentence shown on a veto, and a re-read on a 409.
 * Somebody without `crm:write` gets the same list with no button in it.
 *
 * The list wraps instead of scrolling: with ten statuses on a phone it becomes
 * three or four short rows, and a move the workflow allows is never off screen.
 * No status is told apart by colour alone — the current one carries a tick, its
 * name in bold and `aria-current`; a closing one carries an icon and a spoken
 * "won" or "lost"; a reachable one is the only kind with a border.
 */
export function StageBar(props: StageBarProps): ReactNode {
  const { opportunity, canWrite, onMoved, reload } = props;
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const headingId = useId();
  const hintId = useId();
  const reasonId = useId();
  /** `undefined` while the workflow is being read; `null` when it could not be. */
  const [workflow, setWorkflow] = useState<OpportunityWorkflow | null | undefined>(undefined);
  const [reason, setReason] = useState('');
  const [movingTo, setMovingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    crmApi
      .getWorkflow()
      .then((loaded) => {
        if (alive) setWorkflow(loaded);
      })
      .catch(() => {
        if (alive) setWorkflow(null);
      });
    return (): void => {
      alive = false;
    };
  }, []);

  const model = useMemo(
    () =>
      stageModel(opportunity, workflow ?? null, (status) => workflowStatusLabel(status, language)),
    [opportunity, workflow, language],
  );

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
  const actionable = canWrite && transitions.length > 0;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <h2 id={headingId} className="sr-only">
          {t('opportunity.section.status')}
        </h2>
        {model.position !== null && model.total !== null ? (
          <span className="text-muted-foreground">
            {t('opportunity.stage.position', { position: model.position, total: model.total })}
          </span>
        ) : null}
        <span className="font-semibold [overflow-wrap:anywhere]">{opportunity.status.name}</span>
        {opportunity.closedKind && opportunity.closedAt ? (
          <span className="text-muted-foreground">
            {t(`opportunity.status.closed.${opportunity.closedKind}`, {
              date: formatDateTime(opportunity.closedAt),
            })}
          </span>
        ) : null}
      </div>

      {workflow === undefined ? (
        // The same height as one row of the list, so its arrival moves nothing.
        <div aria-hidden="true" className="space-y-1.5">
          <div className="h-1.5 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
          <div className="min-h-11 sm:min-h-9" />
        </div>
      ) : (
        <ol
          aria-label={t('opportunity.stage.list')}
          aria-describedby={actionable ? hintId : undefined}
          aria-busy={movingTo !== null}
          className="flex flex-wrap gap-x-2 gap-y-3"
        >
          {model.segments.map((segment) => {
            const isCurrent = segment.state === 'current';
            const isTarget = segment.state === 'target' && canWrite;
            const marker =
              segment.kind === 'won' ? (
                <Trophy aria-hidden="true" className="size-4 shrink-0" />
              ) : segment.kind === 'lost' ? (
                <CircleX aria-hidden="true" className="size-4 shrink-0" />
              ) : isCurrent ? (
                <Check aria-hidden="true" className="size-4 shrink-0" />
              ) : (
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: segment.color }}
                />
              );
            const outcome =
              segment.kind === 'won'
                ? t('opportunity.stage.kind.won')
                : segment.kind === 'lost'
                  ? t('opportunity.stage.kind.lost')
                  : null;
            return (
              <li
                key={segment.code}
                aria-current={isCurrent ? 'step' : undefined}
                className="flex min-w-24 flex-1 basis-24 flex-col gap-1.5"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-1.5 rounded-full',
                    isCurrent ? 'bg-primary' : isTarget ? 'bg-primary/30' : 'bg-muted',
                  )}
                />
                {isTarget ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto min-h-11 w-full justify-start whitespace-normal px-2 py-1.5 text-left [overflow-wrap:anywhere] sm:min-h-9"
                    aria-label={
                      outcome
                        ? t('opportunity.stage.moveToClosing', { status: segment.name, outcome })
                        : t('opportunity.stage.moveTo', { status: segment.name })
                    }
                    disabled={movingTo !== null}
                    aria-busy={movingTo === segment.code}
                    onClick={(): void => void move(segment.code)}
                  >
                    {marker}
                    <span>{segment.name}</span>
                  </Button>
                ) : (
                  <span
                    className={cn(
                      'flex min-h-11 items-center gap-2 px-2 py-1.5 text-sm [overflow-wrap:anywhere] sm:min-h-9',
                      isCurrent ? 'font-semibold' : 'text-muted-foreground',
                    )}
                  >
                    {marker}
                    <span>
                      {segment.name}
                      {outcome ? <span className="sr-only">{` (${outcome})`}</span> : null}
                      {isCurrent ? (
                        <span className="sr-only">{` (${t('opportunity.stage.current')})`}</span>
                      ) : null}
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {workflow === null ? (
        <p className="text-xs text-muted-foreground">{t('opportunity.stage.partial')}</p>
      ) : null}

      {!canWrite ? (
        <p className="text-sm text-muted-foreground">{t('opportunity.status.noPermission')}</p>
      ) : transitions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('opportunity.status.none')}</p>
      ) : (
        <>
          <p id={hintId} className="text-xs text-muted-foreground">
            {t('opportunity.stage.hint')}
          </p>
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
      {/* For assistive technology only — the bar itself is the visible
          confirmation. Mounted before it has text, so the announcement is
          reliable. */}
      <p role="status" className="sr-only">
        {notice}
      </p>
      {workflow === undefined ? (
        <p role="status" className="sr-only">
          {tCore('common.state.loading')}
        </p>
      ) : null}
    </section>
  );
}
