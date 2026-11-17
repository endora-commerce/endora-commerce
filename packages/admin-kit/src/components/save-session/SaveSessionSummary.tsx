/**
 * The outcome of an adopting editor's Save, part by part (feature 180,
 * `specs/180-one-save-zone-editors/contracts/save-participation.md` §5 and
 * `product-editor-save-ui.md` §2; FR-011, FR-014, FR-016, FR-081; research R9, R16).
 *
 * A composition of the design system's `Alert`: destructive for a Save that wrote nothing,
 * warning for a partial one, one list item per part with a "Show" the host answers by moving to
 * the part (a tab, a section) and focusing its first error. A full save is announced in a polite
 * live region only. Focus moves to the summary's heading when an outcome arrives, so a keyboard
 * or screen-reader operator lands on what happened. The host clears the outcome on the next edit
 * (the session does so for participant edits).
 */
import { useEffect, useRef, type ReactNode } from 'react';

import { useTranslationContext } from '../../i18n/TranslationProvider.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import type { ParticipantIssues, SaveOutcome, SaveOutcomePart } from '../../save-session/run-save.js';
import { Alert, AlertDescription, AlertTitle } from '../../ui/alert.js';
import { InlineStatus } from '../../ui/inline-status.js';

export interface SaveSessionSummaryProps {
  readonly outcome: SaveOutcome | null;
  /** Discarded-change notices (a module switched off, a contribution that crashed). */
  readonly notices: readonly string[];
  /** Move to the part and focus its first error. */
  onShow(partId: string): void;
}

function problemCount(issues: ParticipantIssues | undefined): number {
  if (issues === undefined) return 1;
  const count = Object.keys(issues.fields).length + (issues.message === undefined ? 0 : 1);
  return Math.max(count, 1);
}

export function SaveSessionSummary({ outcome, notices, onShow }: SaveSessionSummaryProps): ReactNode {
  const t = useTranslation('core');
  const { language } = useTranslationContext();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (outcome !== null && outcome.result !== 'saved') headingRef.current?.focus();
  }, [outcome]);

  const plural = (count: number): string => new Intl.PluralRules(language).select(count);
  const labels = (parts: readonly SaveOutcomePart[]): string => parts.map((part) => part.label).join(', ');
  const showButton = (part: SaveOutcomePart): ReactNode => (
    <button
      type="button"
      className="ml-2 underline underline-offset-2"
      onClick={(): void => onShow(part.id)}
    >
      {t('saveSession.summary.show')}
      <span className="sr-only"> {part.label}</span>
    </button>
  );
  const reasonOf = (part: SaveOutcomePart): string =>
    part.result === 'not-attempted'
      ? t('saveSession.summary.notAttempted')
      : (part.message ?? t('saveSession.summary.unknownReason'));

  // Mounted before it has text (InlineStatus), so a full save is announced (WCAG 4.1.3).
  const savedMessage =
    outcome !== null && outcome.result === 'saved'
      ? t('saveSession.summary.saved', { labels: labels(outcome.parts) })
      : null;
  let body: ReactNode = null;
  if (outcome !== null && outcome.result === 'refused') {
    const refused = outcome.parts.filter((part) => part.result === 'refused');
    body = (
      <Alert variant="destructive">
        <AlertTitle ref={headingRef} tabIndex={-1} className="outline-none">
          {t('saveSession.summary.refused')}
        </AlertTitle>
        <AlertDescription>
          <ul className="list-disc pl-5">
            {refused.map((part) => {
              const count = problemCount(part.issues);
              return (
                <li key={part.id}>
                  {t(`saveSession.summary.problems.${plural(count)}`, { label: part.label, count: String(count) })}
                  {showButton(part)}
                </li>
              );
            })}
          </ul>
        </AlertDescription>
      </Alert>
    );
  } else if (outcome !== null && outcome.result !== 'saved') {
    const saved = outcome.parts.filter((part) => part.result === 'saved');
    const notSaved = outcome.parts.filter((part) => part.result !== 'saved');
    const partial = outcome.result === 'partial';
    body = (
      // A partial save is a warning that needs attention, as a failure does.
      <Alert variant={partial ? 'warning' : 'destructive'} live="assertive">
        <AlertTitle ref={headingRef} tabIndex={-1} className="outline-none">
          {partial ? t('saveSession.summary.partial') : t('saveSession.summary.failed')}
        </AlertTitle>
        <AlertDescription>
          {saved.length > 0 ? <p>{t('saveSession.summary.saved', { labels: labels(saved) })}</p> : null}
          <ul className="list-disc pl-5">
            {notSaved.map((part) => (
              <li key={part.id}>
                {t('saveSession.summary.notSaved', { label: part.label, reason: reasonOf(part) })}
                {part.result === 'failed' ? showButton(part) : null}
              </li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className={body === null && notices.length === 0 ? undefined : 'space-y-2'}>
      <InlineStatus visuallyHidden>{savedMessage}</InlineStatus>
      {body}
      {notices.length > 0 ? (
        <Alert variant="warning" live="polite">
          <AlertDescription>
            <ul className="list-disc pl-5">
              {notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
