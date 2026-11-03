import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { FORMS_LIMITS } from '@endora-commerce/contracts';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Label, Textarea } from '@endora-commerce/admin-kit/ui';
import type { EntryNote } from '../api.js';
import { errorMessage } from '../lib/errors.js';

/**
 * An entry's internal notes (`specs/170-forms-module/` FR-049, research R-16): append-only, oldest
 * first, each with its time and author. Notes stay inside the admin: never in an e-mail, an event,
 * an export or a public answer. Adding one needs `forms:entries_write`; reading them does not.
 */
export interface EntryNotesProps {
  readonly notes: readonly EntryNote[];
  readonly canWrite: boolean;
  readonly onAdd: (body: string) => Promise<void>;
}

export function EntryNotes({ notes, canWrite, onAdd }: EntryNotesProps): ReactNode {
  const t = useTranslation('forms');
  const { language } = useAppLanguage();
  const id = useId();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const time = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (body.trim() === '' || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(body.trim());
      setBody('');
    } catch (failure) {
      setError(errorMessage(failure, t('entries.actionError')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card role="region" aria-labelledby={`${id}-title`}>
      <CardHeader className="p-4 pb-2">
        <CardTitle>
          <h2 id={`${id}-title`}>{t('entry.notes')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="space-y-3">
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('entry.noNotes')}</p>
          ) : (
            <ol className="space-y-3">
              {notes.map((note) => (
                <li key={note.id} className="rounded-md border border-border p-3">
                  <p className="whitespace-pre-wrap break-words text-sm">{note.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <time dateTime={note.createdAt}>{time.format(new Date(note.createdAt))}</time>
                    {note.authorAdminUserId ? ` · ${t('entry.noteAuthor', { id: note.authorAdminUserId })}` : null}
                  </p>
                </li>
              ))}
            </ol>
          )}
          {canWrite ? (
            <form className="space-y-2" onSubmit={(event) => void submit(event)}>
              <Label htmlFor={`${id}-body`}>{t('entry.noteLabel')}</Label>
              <Textarea
                id={`${id}-body`}
                rows={3}
                value={body}
                maxLength={FORMS_LIMITS.noteChars}
                disabled={busy}
                onChange={(event) => setBody(event.target.value)}
              />
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <Button type="submit" size="sm" disabled={busy || body.trim() === ''}>
                {t('entry.addNote')}
              </Button>
            </form>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
