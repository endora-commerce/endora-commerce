import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, AlertDescription, Button, Label } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { errorMessage } from '../lib/labels.js';
import { ReferenceTextarea } from './ReferenceTextarea.js';

/** A comment body's limit — `commentBodySchema` in `@endora-commerce/contracts`. */
export const COMMENT_MAX_LENGTH = 10_000;

export interface CommentComposerProps {
  /** The field's visible label — "New note", "New message". */
  label: string;
  placeholder: string;
  submitLabel: string;
  /** The Opportunity's Organization — whose Orders a reference may name. */
  organizationId: string;
  /** Sends the text; a rejection is shown here and what was typed is kept. */
  onSubmit: (body: string) => Promise<void>;
}

/**
 * The one composer of the Notes and Messages tabs (User Story 4): a textarea
 * and a button. The textarea is the one that inserts product and order
 * references (User Story 12).
 */
export function CommentComposer(props: CommentComposerProps): ReactNode {
  const t = useTranslation('crm');
  const fieldId = useId();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

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
      setFailure(errorMessage(caught, t('comments.error.save')));
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
      <ReferenceTextarea
        id={`${fieldId}-body`}
        organizationId={props.organizationId}
        rows={4}
        value={body}
        maxLength={COMMENT_MAX_LENGTH}
        placeholder={props.placeholder}
        disabled={busy}
        aria-invalid={problem !== null}
        {...(problem ? { 'aria-describedby': `${fieldId}-problem` } : {})}
        onValueChange={(next): void => {
          setBody(next);
          setProblem(null);
        }}
      />
      {problem ? (
        <p id={`${fieldId}-problem`} role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" className="min-h-11 sm:min-h-9" disabled={busy} aria-busy={busy}>
          {props.submitLabel}
        </Button>
      </div>
    </form>
  );
}
