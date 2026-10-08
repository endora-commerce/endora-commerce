import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { OpportunityEvent } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Input,
  Label,
  Textarea,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmCalendarApi } from '../calendar-api.js';
import {
  createEventBody,
  defaultEventForm,
  defaultRemindAt,
  eventFormOf,
  fieldOfDetails,
  ruleOfDetails,
  shiftedTo,
  updateEventBody,
  validateEventForm,
  type EventFormErrors,
  type EventFormField,
  type EventFormValues,
} from '../lib/calendar/event-form.js';
import { errorMessage } from '../lib/labels.js';
import { ModalDialog } from './ModalDialog.js';

const NAME_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 5000;

export interface EventDialogProps {
  opportunityId: string;
  /** The Event being edited, or `null` to add one. */
  event: OpportunityEvent | null;
  /** The write was accepted. The dialog closes itself after calling this. */
  onSaved: (saved: OpportunityEvent, mode: 'created' | 'updated') => void;
  onClose: () => void;
}

/**
 * Add or edit one Event of an Opportunity
 * (`specs/143-crm-sales-opportunities/contracts/admin-surfaces.md` §1b — *The
 * dialog*; FR-130, FR-131, FR-137).
 *
 * One column, labels above their fields, an error under the field it is about
 * and tied to it. Native date and time controls: the platform's pickers are
 * what a phone and a screen reader already know (Jakob's Law).
 *
 * **The form does the arithmetic, not the person** (Tesler's Law): *To* keeps
 * the Event's length when *From* moves, and the reminder time is offered as the
 * Event's start and **follows it until it is edited by hand** — after that it
 * is the user's and is left alone.
 *
 * Nothing is refused while it is being typed; the form speaks on Save
 * (Postel's Law), and the server's own refusal — a 422 naming a member and a
 * rule — lands under the same field in the same words.
 */
export function EventDialog(props: EventDialogProps): ReactNode {
  const { opportunityId, event, onSaved, onClose } = props;
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const fieldId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const [initial] = useState<EventFormValues | null>(() => (event ? eventFormOf(event) : null));
  const [values, setValues] = useState<EventFormValues>(
    () => initial ?? defaultEventForm(new Date()),
  );
  // The reminder follows the start until its field is edited by hand. An Event
  // whose stored reminder is not at its start was already set by hand.
  const [remindFollows, setRemindFollows] = useState(
    () => initial === null || !initial.remind || initial.remindAt === defaultRemindAt(initial),
  );
  const [errors, setErrors] = useState<EventFormErrors>({});
  /** The server's sentence for a refusal the bundle has no words for. */
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The focus trap lands on the panel's first control; the name is the first
  // field, and this says so rather than relying on the order of the markup.
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  /** Change the form; a change to the start takes the reminder with it while it follows. */
  const change = (patch: Partial<EventFormValues>): void => {
    setValues((previous) => {
      const next = { ...previous, ...patch };
      const startMoved = 'date' in patch || 'from' in patch || 'allDay' in patch || 'remind' in patch;
      if (startMoved && remindFollows && next.remind) next.remindAt = defaultRemindAt(next);
      return next;
    });
  };

  const submit = async (submitted: FormEvent): Promise<void> => {
    submitted.preventDefault();
    const found = validateEventForm(values, new Date(), initial);
    setErrors(found);
    setServerMessage(null);
    if (Object.keys(found).length > 0) return;

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setBusy(true);
    try {
      if (event === null) {
        const body = createEventBody(values, timeZone);
        if (body === null) {
          setErrors({ form: 'events.error.save' });
          setBusy(false);
          return;
        }
        onSaved(await crmCalendarApi.createEvent(opportunityId, body), 'created');
      } else {
        const body = updateEventBody(event, values, timeZone);
        if (Object.keys(body).length > 0) {
          onSaved(await crmCalendarApi.updateEvent(opportunityId, event.id, body), 'updated');
        }
      }
      onClose();
    } catch (failure) {
      const details = failure instanceof ApiError ? failure.envelope.error.details : undefined;
      const rule = ruleOfDetails(details);
      const field: EventFormField = rule ? fieldOfDetails(details, values.allDay) : 'form';
      if (rule) {
        setErrors({ [field]: `events.error.${rule}` });
      } else {
        setErrors({ form: 'events.error.save' });
        setServerMessage(errorMessage(failure, t('events.error.save')));
      }
      setBusy(false);
    }
  };

  /** The props that tie a field to its error, and the error itself. */
  const describe = (field: EventFormField): { invalid: boolean; errorId: string; message: string | null } => {
    const key = errors[field];
    return { invalid: key !== undefined, errorId: `${fieldId}-${field}-error`, message: key ? t(key) : null };
  };
  const fieldError = (field: EventFormField): ReactNode => {
    const { errorId, message } = describe(field);
    return message ? (
      <p id={errorId} className="text-xs text-destructive">
        {message}
      </p>
    ) : null;
  };

  const name = describe('name');
  const date = describe('date');
  const from = describe('from');
  const to = describe('to');
  const remindAt = describe('remindAt');
  const formError = errors.form ? (serverMessage ?? t(errors.form)) : null;

  return (
    <ModalDialog
      title={event === null ? t('events.dialog.addTitle') : t('events.dialog.editTitle')}
      onClose={onClose}
      busy={busy}
    >
      <form className="space-y-4" noValidate onSubmit={(submitted): void => void submit(submitted)}>
        {formError ? (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-name`}>{t('events.field.name')}</Label>
          <Input
            ref={nameRef}
            id={`${fieldId}-name`}
            className="h-11 sm:h-9"
            value={values.name}
            required
            maxLength={NAME_MAX_LENGTH}
            autoComplete="off"
            aria-invalid={name.invalid}
            aria-describedby={name.invalid ? name.errorId : undefined}
            onChange={(changed): void => change({ name: changed.target.value })}
          />
          {fieldError('name')}
        </div>

        {/* The whole row is the target, not the 16 px box. */}
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9">
          <Checkbox
            checked={values.allDay}
            onChange={(changed): void => change({ allDay: changed.target.checked })}
          />
          {t('events.field.allDay')}
        </label>

        <div className={values.allDay ? 'space-y-1' : 'grid gap-4 sm:grid-cols-3'}>
          <div className="space-y-1">
            <Label htmlFor={`${fieldId}-date`}>{t('events.field.date')}</Label>
            <Input
              id={`${fieldId}-date`}
              type="date"
              className="h-11 sm:h-9"
              value={values.date}
              required
              aria-invalid={date.invalid}
              aria-describedby={date.invalid ? date.errorId : undefined}
              onChange={(changed): void => change({ date: changed.target.value })}
            />
            {fieldError('date')}
          </div>
          {values.allDay ? null : (
            <>
              <div className="space-y-1">
                <Label htmlFor={`${fieldId}-from`}>{t('events.field.from')}</Label>
                <Input
                  id={`${fieldId}-from`}
                  type="time"
                  className="h-11 sm:h-9"
                  value={values.from}
                  required
                  aria-invalid={from.invalid}
                  aria-describedby={from.invalid ? from.errorId : undefined}
                  onChange={(changed): void =>
                    // *To* keeps the Event's length.
                    change({
                      from: changed.target.value,
                      to: shiftedTo(values.from, values.to, changed.target.value),
                    })
                  }
                />
                {fieldError('from')}
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${fieldId}-to`}>{t('events.field.to')}</Label>
                <Input
                  id={`${fieldId}-to`}
                  type="time"
                  className="h-11 sm:h-9"
                  value={values.to}
                  required
                  aria-invalid={to.invalid}
                  aria-describedby={to.invalid ? to.errorId : undefined}
                  onChange={(changed): void => change({ to: changed.target.value })}
                />
                {fieldError('to')}
              </div>
            </>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-description`}>{t('events.field.description')}</Label>
          <Textarea
            id={`${fieldId}-description`}
            rows={3}
            value={values.description}
            maxLength={DESCRIPTION_MAX_LENGTH}
            onChange={(changed): void => change({ description: changed.target.value })}
          />
        </div>

        <div className="space-y-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9">
            <Checkbox
              checked={values.remind}
              aria-describedby={`${fieldId}-remind-hint`}
              onChange={(changed): void => change({ remind: changed.target.checked })}
            />
            {t('events.field.remind')}
          </label>
          {values.remind ? (
            <div className="space-y-1">
              <Label htmlFor={`${fieldId}-remindAt`}>{t('events.field.remindAt')}</Label>
              <Input
                id={`${fieldId}-remindAt`}
                type="datetime-local"
                className="h-11 sm:h-9"
                value={values.remindAt}
                required
                aria-invalid={remindAt.invalid}
                aria-describedby={remindAt.invalid ? remindAt.errorId : undefined}
                onChange={(changed): void => {
                  // Edited by hand: from here on it is the user's.
                  setRemindFollows(false);
                  setValues((previous) => ({ ...previous, remindAt: changed.target.value }));
                }}
              />
              {fieldError('remindAt')}
            </div>
          ) : null}
          <p id={`${fieldId}-remind-hint`} className="text-xs text-muted-foreground">
            {t('events.field.remindHint')}
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 sm:min-h-9"
            disabled={busy}
            onClick={onClose}
          >
            {tCore('common.action.cancel')}
          </Button>
          <Button type="submit" className="min-h-11 sm:min-h-9" disabled={busy} aria-busy={busy}>
            {busy ? tCore('common.state.saving') : tCore('common.action.save')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}
