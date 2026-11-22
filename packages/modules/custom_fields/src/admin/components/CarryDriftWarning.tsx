import { useId, useRef, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { SupportedEntityType } from '@endora-commerce/contracts';
import { carryDriftProceed, type CarryCounterpart, type DefinitionChange } from '../lib/carry-drift.js';
import { shownKey } from '../lib/carry-labels.js';

export interface CarryDriftNoticeProps {
  counterparts: readonly CarryCounterpart[];
  /** The translated name of an entity type. */
  typeLabel: (entityType: SupportedEntityType) => string;
  /** A sentence naming the action itself, above the warning (a deletion says what it deletes). */
  lead?: string;
  /** The wrapper's id, for the dialog's `aria-describedby`. */
  id?: string;
  /**
   * A removal or a deletion: the warning icon reads in the destructive colour.
   * Otherwise (an added option, an audience change) it reads amber — a caution,
   * not a loss.
   */
  destructive?: boolean;
}

/**
 * What a change is about to break (FR-019, `admin-surfaces.md` §1.4): the
 * warning's sentence and one "<entity type> · <key>" line per counterpart.
 * Text only — the key is interpolated, never markup.
 */
export function CarryDriftNotice({ counterparts, typeLabel, lead, id, destructive = false }: CarryDriftNoticeProps): ReactNode {
  const t = useTranslation('custom_fields');
  return (
    <div id={id} className="space-y-2 text-sm">
      {lead ? <p className="break-words">{lead}</p> : null}
      <p className="flex items-start gap-2 break-words">
        <TriangleAlert
          className={
            destructive
              ? 'mt-0.5 size-4 shrink-0 text-destructive'
              : 'mt-0.5 size-4 shrink-0 text-amber-700'
          }
          aria-hidden="true"
        />
        <span>{t('customFields.carry.warning.body')}</span>
      </p>
      <ul className="list-disc space-y-0.5 pl-10">
        {counterparts.map((counterpart) => (
          <li key={`${counterpart.role}:${counterpart.entityType}:${counterpart.key}`} className="break-words">
            {t('customFields.carry.warning.counterpart', {
              entityType: typeLabel(counterpart.entityType),
              key: shownKey(counterpart.key),
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The warning as one inline sentence, for a question asked by something else —
 * the row audience control's confirm step (issue #1749), which renders it
 * inside its summary sentence. Phrasing content only, so it can sit in a `<p>`.
 */
export function CarryDriftSentence({
  counterparts,
  typeLabel,
}: Pick<CarryDriftNoticeProps, 'counterparts' | 'typeLabel'>): ReactNode {
  const t = useTranslation('custom_fields');
  const lines = counterparts
    .map((counterpart) =>
      t('customFields.carry.warning.counterpart', {
        entityType: typeLabel(counterpart.entityType),
        key: shownKey(counterpart.key),
      }),
    )
    .join(', ');
  return (
    <span className="mt-2 flex items-start gap-2 break-words">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
      <span>
        {t('customFields.carry.warning.body')} {lines}
      </span>
    </span>
  );
}

export interface CarryDriftDialogProps extends Omit<CarryDriftNoticeProps, 'id' | 'destructive'> {
  onCancel: () => void;
  onProceed: () => void;
  /** The change the warning confirms: its proceed button names it, destructive-styled for a deletion. */
  action: DefinitionChange['kind'];
}

/**
 * The warning as a dialog of its own, for a change made outside any dialog
 * (the table's audience select and *Delete*). Focus starts on *Cancel* — the
 * choice that changes nothing — and Escape or the scrim cancel too. The notice
 * describes the dialog (`aria-describedby`), so a screen reader reads the
 * warning and its counterparts with the title as focus enters.
 */
export function CarryDriftDialog({
  counterparts,
  typeLabel,
  lead,
  onCancel,
  onProceed,
  action,
}: CarryDriftDialogProps): ReactNode {
  const t = useTranslation('custom_fields');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const noticeId = useId();
  const proceed = carryDriftProceed(action);
  return (
    <ModalDialog
      title={t('customFields.carry.warning.title')}
      onClose={onCancel}
      initialFocusRef={cancelRef}
      aria-describedby={noticeId}
      footer={
        <>
          <Button ref={cancelRef} type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={onCancel}>
            {t('customFields.carry.warning.cancel')}
          </Button>
          <Button
            type="button"
            variant={proceed.destructive ? 'destructive' : 'default'}
            className="min-h-11 sm:min-h-9"
            onClick={onProceed}
          >
            {t(proceed.labelKey)}
          </Button>
        </>
      }
    >
      <CarryDriftNotice
        id={noticeId}
        counterparts={counterparts}
        typeLabel={typeLabel}
        destructive={proceed.destructive}
        {...(lead ? { lead } : {})}
      />
    </ModalDialog>
  );
}
