import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { FeedTaxonomyRevision } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';
import { useFocusTrap } from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  feedTaxonomiesClient,
  type TaxonomyRevisionImpactDto,
} from '../taxonomy-api.js';
import { ConsequenceDialog } from './ConsequenceDialog.js';

/**
 * The impact preview — ux-design §2.11, FR-094, FR-095.
 *
 * The problem this solves: *"revision 2026-05-14 is available; 47 mappings
 * would become stale"* is telemetry, not a decision. Four things turn it into
 * one, in this order — a **verdict sentence** in the operator's own units, a
 * **before/after coverage** pair, the **counters** chunked into related groups,
 * and the **price of waiting**, because doing nothing is a real option and an
 * interface that hides its cost is pushing.
 *
 * The middle verdict is the one a count-only design gets wrong: *61 mappings
 * would go stale* sounds catastrophic, and if every affected category still
 * inherits a value from an ancestor then **nothing actually stops being
 * emitted**. That is why this leads with coverage rather than with the mapping
 * count, and why FR-094 names inherited coverage explicitly.
 *
 * There is deliberately **no `Promote` button outside this drawer**: promotion
 * with a number next to it and no explanation is exactly the decision this
 * feature exists to prevent somebody making blind.
 */

export function RevisionImpactDrawer(props: {
  revision: FeedTaxonomyRevision;
  providerLabel: string;
  canWrite: boolean;
  onClose: () => void;
  onPromoted: (input: { revision: string; staleCount: number }) => void;
  /** Spoken through the page's live region — the outcome arrives asynchronously. */
  announce: (message: string) => void;
}): ReactNode {
  const t = useTranslation('product_feeds');
  const { language } = useAppLanguage();
  const containerRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusTrap(containerRef, true);

  const [impact, setImpact] = useState<TaxonomyRevisionImpactDto | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoadFailed(false);
    try {
      const res = await feedTaxonomiesClient.revisionImpact(props.revision.id, language);
      setImpact(res.data);
      return;
    } catch {
      setImpact(null);
      setLoadFailed(true);
    }
  }, [props.revision.id, language]);

  useEffect(() => {
    void load();
  }, [load]);

  // Order matters: `useFocusTrap` focuses the first focusable on activation,
  // which would land on `Close` and read the operator the least useful thing on
  // the screen. The verdict heading carries `tabIndex={-1}`, so it takes focus
  // without joining the tab cycle (ux-design §5.1).
  useEffect(() => {
    if (impact) headingRef.current?.focus();
  }, [impact]);

  const provider = props.providerLabel;
  const verdict = impact ? verdictOf(impact) : null;

  async function promote(): Promise<void> {
    if (!impact) return;
    setBusy(true);
    setConflict(null);
    try {
      await feedTaxonomiesClient.promoteRevision({
        taxonomyId: props.revision.id,
        expectedStaleMappingCount: impact.mappings.wouldBecomeStale,
      });
      props.announce(
        t('promote.a11y.done').replace('{revision}', props.revision.revision),
      );
      props.onPromoted({
        revision: props.revision.revision,
        staleCount: impact.mappings.wouldBecomeStale,
      });
    } catch (error) {
      const reason = (error as { details?: { reason?: string } } | null)?.details?.reason;
      if (reason === 'impact_changed') {
        // The dialog closes, the drawer stays open and refetches, and the new
        // figures are announced — mirroring `builder.conflict.*` on the
        // template editor, the same idea applied to a decision.
        setConfirming(false);
        await load();
        setConflict(t('promote.conflict.body'));
        return;
      }
      if (reason === 'taxonomy_revision_already_current') {
        setConflict(t('promote.alreadyCurrent'));
        return;
      }
      setConflict(t('promote.failed').replace('{reason}', ''));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <div className="b2b-scrim" onClick={props.onClose} />
      <aside
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="taxonomy-impact-title"
        className="b2b-drawer b2b-drawer--wide"
        onKeyDown={(event): void => {
          if (event.key === 'Escape' && !confirming) props.onClose();
        }}
      >
        <div className="b2b-drawer__head">
          <h2
            id="taxonomy-impact-title"
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-medium outline-none"
          >
            {t('impact.title')
              .replace('{provider}', provider)
              .replace('{revision}', props.revision.revision)}
          </h2>
        </div>

        <div className="b2b-drawer__body space-y-4">
          {loadFailed ? (
            <Alert variant="destructive">
              <AlertDescription>
                {t('impact.loadFailed')}{' '}
                <Button type="button" variant="outline" size="sm" onClick={(): void => void load()}>
                  {t('revisions.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {conflict ? (
            <Alert variant="warning" role="status">
              <AlertDescription>{conflict}</AlertDescription>
            </Alert>
          ) : null}

          {!impact && !loadFailed ? (
            // The drawer opens immediately with a skeleton matching the final
            // layout: the impact call is not fast, and an empty drawer is worse
            // than a slow one (Doherty).
            <div aria-hidden="true" className="space-y-3">
              <div className="h-12 animate-pulse rounded bg-muted" />
              <div className="h-20 animate-pulse rounded bg-muted" />
              <div className="h-32 animate-pulse rounded bg-muted" />
            </div>
          ) : null}

          {impact && verdict ? (
            <>
              <p className="text-sm">{verdict.sentence(t, impact, provider)}</p>

              <section aria-label={t('impact.coverage.heading')} className="space-y-2">
                <h3 className="text-sm font-medium">{t('impact.coverage.heading')}</h3>
                <CoverageBar
                  label={t('impact.coverage.now')}
                  ariaLabel={t('impact.coverage.nowAria')}
                  value={impact.categories.coveredNow}
                  total={impact.categories.total}
                  text={t('impact.coverage.value')
                    .replace('{covered}', String(impact.categories.coveredNow))
                    .replace('{total}', String(impact.categories.total))}
                />
                <CoverageBar
                  label={t('impact.coverage.after')}
                  ariaLabel={t('impact.coverage.afterAria')}
                  value={impact.categories.coveredAfter}
                  total={impact.categories.total}
                  text={t('impact.coverage.value')
                    .replace('{covered}', String(impact.categories.coveredAfter))
                    .replace('{total}', String(impact.categories.total))}
                  delta={impact.categories.coveredAfter - impact.categories.coveredNow}
                />
              </section>

              <div className="grid gap-4 sm:grid-cols-2">
                <section>
                  <h3 className="text-sm font-medium">
                    {t('impact.mappings.heading').replace(
                      '{total}',
                      String(impact.mappings.total),
                    )}
                  </h3>
                  <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                    <li>
                      {t('impact.mappings.live').replace(
                        '{count}',
                        String(impact.mappings.wouldRemainLive),
                      )}
                    </li>
                    <li>
                      {t('impact.mappings.stale').replace(
                        '{count}',
                        String(impact.mappings.wouldBecomeStale),
                      )}
                    </li>
                    <li>
                      {t('impact.mappings.revived').replace(
                        '{count}',
                        String(impact.mappings.wouldBecomeLive),
                      )}
                    </li>
                  </ul>
                </section>
                <section>
                  <h3 className="text-sm font-medium">
                    {t('impact.nodes.heading').replace('{provider}', provider)}
                  </h3>
                  <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                    <li>
                      {t('impact.nodes.change')
                        .replace('{current}', String(impact.nodeCountCurrent))
                        .replace('{candidate}', String(impact.nodeCountCandidate))}
                    </li>
                    <li>
                      {t('impact.nodes.delta')
                        .replace('{removed}', String(impact.nodesRemoved))
                        .replace('{added}', String(impact.nodesAdded))}
                    </li>
                  </ul>
                </section>
              </div>

              <Alert>
                <AlertDescription>
                  {t('impact.wait')
                    .replace('{revision}', impact.currentRevision ?? props.revision.revision)
                    .replace('{added}', String(impact.nodesAdded))
                    .replace('{provider}', provider)}
                </AlertDescription>
              </Alert>

              <AffectedGroup
                title={t('impact.list.stale').replace(
                  '{count}',
                  String(impact.mappings.wouldBecomeStale),
                )}
                defaultOpen
                rows={impact.affected.filter((row) => row.effect !== 'becomes_live')}
                wasLabel={t('impact.list.was')}
                descendantsLabel={t('impact.list.descendants')}
              />
              <AffectedGroup
                title={t('impact.list.revived').replace(
                  '{count}',
                  String(impact.mappings.wouldBecomeLive),
                )}
                defaultOpen={false}
                rows={impact.affected.filter((row) => row.effect === 'becomes_live')}
                wasLabel={t('impact.list.was')}
                descendantsLabel={t('impact.list.descendants')}
              />
              {impact.affectedTruncated ? (
                <p className="text-xs text-muted-foreground">
                  {t('impact.truncated')
                    .replace('{shown}', String(impact.affected.length))
                    .replace(
                      '{total}',
                      String(impact.mappings.wouldBecomeStale + impact.mappings.wouldBecomeLive),
                    )}
                </p>
              ) : null}

              <p className="text-xs text-muted-foreground">
                {t('impact.reassurance').replace(
                  '{revision}',
                  impact.currentRevision ?? props.revision.revision,
                )}
              </p>
            </>
          ) : null}
        </div>

        <div className="b2b-drawer__foot flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={props.onClose}>
            {t('impact.close')}
          </Button>
          {props.revision.isCurrent ? (
            <p className="self-center text-sm text-muted-foreground">{t('impact.current')}</p>
          ) : impact ? (
            // Not rendered while the impact failed to load: there is no figure
            // to acknowledge, and this is the UI half of
            // `expectedStaleMappingCount`.
            <Button
              type="button"
              disabled={!props.canWrite || busy}
              aria-busy={busy}
              title={props.canWrite ? undefined : t('permission.needWrite')}
              onClick={(): void => setConfirming(true)}
            >
              {busy
                ? t('promote.busy')
                : props.revision.supersededAt
                  ? t('impact.rollback')
                  : t('impact.promote')}
            </Button>
          ) : null}
        </div>
      </aside>

      {confirming && impact ? (
        <ConsequenceDialog
          title={t('promote.confirm.title')
            .replace('{provider}', provider)
            .replace('{revision}', props.revision.revision)}
          body={t('promote.confirm.body')
            .replace('{stale}', String(impact.mappings.wouldBecomeStale))
            .replace('{previous}', impact.currentRevision ?? props.revision.revision)}
          confirmLabel={t('promote.confirm.confirm')}
          cancelLabel={t('promote.confirm.cancel')}
          // Promotion is consequential and reversible; `destructive` is
          // reserved for deletion (ux-design §2.12).
          confirmVariant="default"
          busy={busy}
          onCancel={(): void => setConfirming(false)}
          onConfirm={(): void => void promote()}
        />
      ) : null}
    </>
  );
}

type Translate = (key: string) => string;

/** The four verdicts of ux-design §2.11, in the order they are tested. */
function verdictOf(impact: TaxonomyRevisionImpactDto): {
  sentence: (t: Translate, impact: TaxonomyRevisionImpactDto, provider: string) => string;
} {
  if (impact.currentRevision === null) {
    return {
      sentence: (t, _impact, provider) => t('impact.verdict.first').replace('{provider}', provider),
    };
  }
  if (impact.categories.losingCoverage === 0 && impact.mappings.wouldBecomeStale === 0) {
    return {
      sentence: (t, _impact, provider) => t('impact.verdict.safe').replace('{provider}', provider),
    };
  }
  if (impact.categories.losingCoverage === 0) {
    return {
      sentence: (t, value, provider) =>
        t('impact.verdict.stale')
          .replace('{stale}', String(value.mappings.wouldBecomeStale))
          .replaceAll('{provider}', provider),
    };
  }
  return {
    sentence: (t, value, provider) => {
      const descendants = value.affected.reduce(
        (sum, row) => sum + row.descendantsLosingCoverage,
        0,
      );
      const head = t('impact.verdict.loss')
        .replace('{losing}', String(value.categories.losingCoverage))
        .replace('{total}', String(value.categories.total))
        .replace('{provider}', provider);
      if (descendants === 0) return head;
      return `${head} ${t('impact.verdict.lossDescendants').replace('{descendants}', String(descendants))}`;
    },
  };
}

/**
 * The same grammar as the mapping screen's coverage strip: a `progressbar`
 * **and** the identical numbers as text. A bar the operator cannot read off is
 * not information (WCAG 1.4.1 and ux-design §5.2).
 */
function CoverageBar(props: {
  label: string;
  ariaLabel: string;
  value: number;
  total: number;
  text: string;
  delta?: number;
}): ReactNode {
  const percent = props.total === 0 ? 0 : Math.round((props.value / props.total) * 100);
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-16 shrink-0 text-muted-foreground">{props.label}</span>
      <div
        role="progressbar"
        aria-label={props.ariaLabel}
        aria-valuenow={props.value}
        aria-valuemin={0}
        aria-valuemax={props.total}
        className="h-2 w-40 overflow-hidden rounded bg-muted"
      >
        <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <span>{props.text}</span>
      {props.delta !== undefined && props.delta !== 0 ? (
        // The sign is carried as text, never as a red tint.
        <span className="font-medium">{props.delta > 0 ? `+${props.delta}` : props.delta}</span>
      ) : null}
    </div>
  );
}

function AffectedGroup(props: {
  title: string;
  defaultOpen: boolean;
  rows: Array<{
    categoryId: string;
    categoryName: string;
    nodeFullPath: string | null;
    descendantsLosingCoverage: number;
  }>;
  wasLabel: string;
  descendantsLabel: string;
}): ReactNode {
  const [open, setOpen] = useState(props.defaultOpen);
  if (props.rows.length === 0) return null;
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        className="text-sm font-medium underline-offset-2 hover:underline"
        onClick={(): void => setOpen((value) => !value)}
      >
        {props.title}
      </button>
      {open ? (
        <ul role="list" className="mt-1 space-y-1 text-sm text-muted-foreground">
          {props.rows.map((row) => (
            <li key={row.categoryId} className="flex flex-wrap gap-2">
              <span className="text-foreground">{row.categoryName}</span>
              {row.nodeFullPath ? (
                // Past tense, because once the node is gone the present tense
                // would be a lie.
                <span>{props.wasLabel.replace('{path}', row.nodeFullPath)}</span>
              ) : null}
              {row.descendantsLosingCoverage > 0 ? (
                <span>
                  {props.descendantsLabel.replace(
                    '{count}',
                    String(row.descendantsLosingCoverage),
                  )}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
