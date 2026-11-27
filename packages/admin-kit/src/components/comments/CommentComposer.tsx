import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, AlertDescription } from '../../ui/alert.js';
import { Button } from '../../ui/button.js';
import { Label } from '../../ui/label.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { ApiError } from '../../lib/index.js';
import { ReferenceField } from '../references/ReferenceField.js';
import type { ReferenceLookups, ReferenceTriggerKind } from '../references/reference-kinds.js';

/** A note's or a message's limit — CRM's `commentBodySchema` and Projects' alike. */
export const COMMENT_MAX_LENGTH = 10_000;

/**
 * The sentence to show for a failed call: the one the backend resolved in the
 * reader's language, as it arrived, else `fallback` (a failure that never
 * produced an envelope — the network).
 */
export function commentErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.envelope.error.message : fallback;
}

export interface CommentComposerProps {
  /** The field's visible label — "New note", "New message". */
  label: string;
  placeholder: string;
  submitLabel: string;
  /** One line under the field that describes it (`aria-describedby`); none when omitted. */
  hint?: string;
  /** What the text may refer to — the trigger table of {@link ReferenceField}. */
  referenceKinds: readonly ReferenceTriggerKind[];
  /** Where the references' suggestions come from. */
  lookups: ReferenceLookups;
  /** Defaults to {@link COMMENT_MAX_LENGTH}. */
  maxLength?: number;
  /** Sends the text; a rejection is shown here and what was typed is kept. */
  onSubmit: (body: string) => Promise<void>;
  /**
   * More fields of the same entry, drawn under the text and above the button — a note's custom
   * fields (issue #2005). The host keeps their values and sends them from `onSubmit`.
   */
  children?: ReactNode;
}

/**
 * The one composer of a record's Notes and Messages (CRM User Story 4,
 * promoted by `specs/163-projects-and-tasks/` research R-17): the formatted
 * field and a button. The field is the one that inserts references.
 */
export function CommentComposer(props: CommentComposerProps): ReactNode {
  const t = useTranslation('core');
  const fieldId = useId();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // The problem first: it is what the writer has to act on.
  const describedBy =
    [problem ? `${fieldId}-problem` : null, props.hint ? `${fieldId}-hint` : null]
      .filter((id): id is string => id !== null)
      .join(' ') || undefined;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const text = body.trim();
    if (text === '') {
      setProblem(t('comments.error.empty'));
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await props.onSubmit(text);
      setBody('');
    } catch (caught) {
      setFailure(commentErrorMessage(caught, t('comments.error.save')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate className="space-y-2" onSubmit={(event): void => void submit(event)}>
      {failure ? (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
      <Label htmlFor={`${fieldId}-body`}>{props.label}</Label>
      <ReferenceField
        id={`${fieldId}-body`}
        kinds={props.referenceKinds}
        lookups={props.lookups}
        rows={4}
        value={body}
        maxLength={props.maxLength ?? COMMENT_MAX_LENGTH}
        placeholder={props.placeholder}
        disabled={busy}
        aria-invalid={problem !== null}
        {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
        onValueChange={(next): void => {
          setBody(next);
          setProblem(null);
        }}
      />
      {props.hint ? (
        <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
          {props.hint}
        </p>
      ) : null}
      {problem ? (
        <p id={`${fieldId}-problem`} role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      ) : null}
      {props.children}
      <div className="flex justify-end">
        <Button type="submit" className="min-h-11 sm:min-h-9" disabled={busy} aria-busy={busy}>
          {props.submitLabel}
        </Button>
      </div>
    </form>
  );
}
