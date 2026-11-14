/**
 * The generic Save of an adopting editor that has no Save of its own to extend (feature 180,
 * `specs/180-one-save-zone-editors/contracts/save-participation.md` §5; FR-007, FR-010, FR-035;
 * research R16).
 *
 * A composition, not a new primitive: `StickyFormActions` (fixed to the bottom below 1024 px,
 * inline above) around the design system's primary `b2b-btn`, worded and pluralised as the
 * product editor's own Save (`ProductEditorSaveAction`). The count is the host's own staged
 * changes plus every participant's, read from the session the control sits under.
 */
import { useId, type ReactNode } from 'react';
import { Save } from 'lucide-react';

import { useTranslationContext } from '../../i18n/TranslationProvider.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { useSaveSession } from '../../save-session/SaveSessionProvider.js';
import { StickyFormActions } from '../StickyFormActions.js';

export interface SaveSessionActionsProps {
  /** The host part's own unsaved changes; the participants' are added from the session. */
  readonly hostCount: number;
  /**
   * The operator may write the host record. Save is also shown when any participant is
   * writable (FR-035), so a host passes its own permission and nothing else.
   */
  readonly canSave: boolean;
  readonly saving: boolean;
  onSave(): void;
  /** An id the button is additionally described by, e.g. the host's summary. */
  readonly describedBy?: string;
}

export function SaveSessionActions({
  hostCount,
  canSave,
  saving,
  onSave,
  describedBy,
}: SaveSessionActionsProps): ReactNode {
  const t = useTranslation('core');
  const { language } = useTranslationContext();
  const session = useSaveSession();
  const noteId = useId();
  if (!canSave && !session.hasWritableParticipant) return null;
  const total = hostCount + session.dirtyCount;
  const busy = saving || session.saving;
  const inert = total === 0 || busy;
  const label = busy
    ? t('saveSession.action.saving')
    : total > 0
      ? t(`saveSession.action.count.${new Intl.PluralRules(language).select(total)}`, { count: String(total) })
      : t('saveSession.action.save');
  return (
    <StickyFormActions>
      <div className="flex w-full flex-col gap-1 lg:w-auto lg:flex-row lg:items-center lg:gap-2">
        <button
          type="button"
          className="b2b-btn b2b-btn--primary max-lg:min-h-11 max-lg:w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          // aria-disabled, not disabled: focus stays on Save after it has saved (WCAG 2.4.3).
          aria-disabled={inert}
          aria-busy={busy}
          aria-describedby={describedBy === undefined ? noteId : `${noteId} ${describedBy}`}
          onClick={(): void => {
            if (inert) return;
            onSave();
          }}
        >
          <Save size={14} aria-hidden="true" />
          {label}
        </button>
        <span id={noteId} className="text-xs text-muted-foreground max-lg:text-center">
          {total === 0 && !busy ? t('saveSession.action.noChanges') : ''}
        </span>
      </div>
    </StickyFormActions>
  );
}
