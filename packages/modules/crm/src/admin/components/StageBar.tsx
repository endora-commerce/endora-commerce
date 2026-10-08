import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, CircleX, Trophy } from 'lucide-react';
import type {
  OpportunityDetail,
  OpportunityStatusRef,
  OpportunityTransitionResult,
  OpportunityWorkflow,
} from '@endora-commerce/contracts';
import { ApiError, formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Input, Label } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { errorMessage } from '../lib/labels.js';
import { stageModel, type StageSide } from '../lib/stage-model.js';

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
 * Where an Opportunity is in the workflow, and the moves allowed from there
 * (`specs/143-crm-sales-opportunities/`, User Story 20; FR-013, FR-016).
 *
 * **Only what can happen next is on screen.** The workflow is a graph the
 * operator draws, so the bar does not draw a line of every status: it names the
 * current one and lists the statuses `allowedTransitions` — the server's
 * answer — lets it move to, sorted into *Back* and *Forward* (see
 * {@link stageModel}). A side with nothing on it is not drawn.
 *
 * Pressing a status is the one transition path this screen has ever had:
 * `POST …/transition` with the optional reason typed below, the server's own
 * sentence shown on a veto, and a re-read on a 409. Somebody without
 * `crm:write` sees the same statuses as text, with no button among them.
 *
 * The direction of a move between two open statuses needs the workflow's order,
 * which the Opportunity's own answer does not carry, so `GET /workflow` is read
 * for it. **The moves do not wait for that read and do not depend on it**: when
 * it fails they are offered under one plain heading, without a direction.
 *
 * No status is told apart by colour alone — a side has its word and its arrow,
 * a closing status its icon and a spoken "won" or "lost". The groups wrap under
 * each other on a narrow screen; nothing scrolls sideways.
 */
export function StageBar(props: StageBarProps): ReactNode {
  const { opportunity, canWrite, onMoved, reload } = props;
  const t = useTranslation('crm');
  const headingId = useId();
  const reasonId = useId();
  /** `undefined` while the workflow is being read; `null` when it could not be. */
  const [workflow, setWorkflow] = useState<OpportunityWorkflow | null | undefined>(undefined);
  const [reason, setReason] = useState('');
  const [movingTo, setMovingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const transitions = opportunity.allowedTransitions;
  // The order is asked for only where it can change what is drawn.
  const needsOrder = transitions.length > 0;

  useEffect(() => {
    if (!needsOrder) {
      setWorkflow(null);
      return undefined;
    }
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
  }, [needsOrder]);

  const model = useMemo(() => stageModel(opportunity, workflow ?? null), [opportunity, workflow]);

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

  const loadingOrder = needsOrder && workflow === undefined;

  /** The icon of a closing status, or the operator's colour as a dot. */
  const marker = (status: OpportunityStatusRef): ReactNode =>
    status.kind === 'won' ? (
      <Trophy aria-hidden="true" className="size-4 shrink-0" />
    ) : status.kind === 'lost' ? (
      <CircleX aria-hidden="true" className="size-4 shrink-0" />
    ) : (
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-full border border-border"
        style={{ backgroundColor: status.color }}
      />
    );

  const outcomeOf = (status: OpportunityStatusRef): string | null =>
    status.kind === 'won'
      ? t('opportunity.stage.kind.won')
      : status.kind === 'lost'
        ? t('opportunity.stage.kind.lost')
        : null;

  /** What pressing a status does, in words: the button's accessible name. */
  const actionName = (side: StageSide, status: OpportunityStatusRef): string => {
    const outcome = outcomeOf(status);
    if (outcome) return t('opportunity.stage.moveToClosing', { status: status.name, outcome });
    if (side === 'back') return t('opportunity.stage.moveBack', { status: status.name });
    if (side === 'forward') return t('opportunity.stage.moveForward', { status: status.name });
    return t('opportunity.stage.moveTo', { status: status.name });
  };

  const side = (
    which: StageSide,
    title: string,
    targets: readonly OpportunityStatusRef[],
    className: string,
  ): ReactNode => {
    if (targets.length === 0) return null;
    const labelId = `${headingId}-${which}`;
    return (
      <div role="group" aria-labelledby={labelId} className={`space-y-1.5 ${className}`}>
        <p
          id={labelId}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground"
        >
          {which === 'back' ? <ArrowLeft aria-hidden="true" className="size-3.5" /> : null}
          {title}
          {which === 'forward' ? <ArrowRight aria-hidden="true" className="size-3.5" /> : null}
        </p>
        <ul role="list" className="flex flex-wrap gap-2">
          {targets.map((target) => {
            const outcome = outcomeOf(target);
            return (
              <li key={target.code} className="max-w-full">
                {canWrite ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto min-h-11 max-w-full justify-start whitespace-normal py-1.5 text-left [overflow-wrap:anywhere] sm:min-h-9"
                    aria-label={actionName(which, target)}
                    disabled={movingTo !== null}
                    aria-busy={movingTo === target.code}
                    onClick={(): void => void move(target.code)}
                  >
                    {marker(target)}
                    <span>{target.name}</span>
                  </Button>
                ) : (
                  <span className="flex min-h-9 items-center gap-2 text-sm [overflow-wrap:anywhere]">
                    {marker(target)}
                    <span>
                      {target.name}
                      {outcome ? <span className="sr-only">{` (${outcome})`}</span> : null}
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  const currentOutcome = outcomeOf(opportunity.status);

  return (
    <section aria-labelledby={headingId} aria-busy={loadingOrder} className="space-y-4">
      <h2 id={headingId} className="sr-only">
        {t('opportunity.section.status')}
      </h2>

      {/*
        In the markup: the current status, then back, then forward — what a
        screen reader should hear first, and the order the keyboard walks. From
        `sm` up they are drawn back · current · forward; the current status takes
        no focus, so the two orders never disagree for the keyboard.
      */}
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:gap-x-8">
        <div className="space-y-1.5 sm:order-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t('opportunity.stage.current')}
          </p>
          <p className="flex min-h-11 items-center gap-2 text-lg font-semibold leading-tight [overflow-wrap:anywhere] sm:min-h-9">
            {marker(opportunity.status)}
            <span>
              {opportunity.status.name}
              {currentOutcome ? <span className="sr-only">{` (${currentOutcome})`}</span> : null}
            </span>
          </p>
          {opportunity.closedKind && opportunity.closedAt ? (
            <p className="text-sm text-muted-foreground">
              {t(`opportunity.status.closed.${opportunity.closedKind}`, {
                date: formatDateTime(opportunity.closedAt),
              })}
            </p>
          ) : null}
        </div>

        {loadingOrder ? (
          // As tall as a row of moves, so their arrival moves nothing below.
          <div aria-hidden="true" className="space-y-1.5 sm:order-3">
            <div className="h-4 w-16 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <div className="h-11 w-40 animate-pulse rounded-md bg-muted motion-reduce:animate-none sm:h-9" />
          </div>
        ) : (
          <>
            {side('back', t('opportunity.stage.back'), model.back, 'sm:order-1')}
            {side('forward', t('opportunity.stage.forward'), model.forward, 'sm:order-3')}
            {side('unsorted', t('opportunity.stage.other'), model.unsorted, 'sm:order-4')}
          </>
        )}
      </div>

      {!loadingOrder && model.unsorted.length > 0 ? (
        <p className="text-xs text-muted-foreground">{t('opportunity.stage.partial')}</p>
      ) : null}

      {!canWrite ? (
        <p className="text-sm text-muted-foreground">{t('opportunity.status.noPermission')}</p>
      ) : transitions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('opportunity.status.none')}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
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
    </section>
  );
}
