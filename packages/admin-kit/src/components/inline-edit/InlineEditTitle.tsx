import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Button } from '../../ui/button.js';
import { Input } from '../../ui/input.js';
import { PageHeader, type PageHeaderProps } from '../../ui/page-header.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { InlineEditPencil } from './InlineEdit.js';

export interface InlineEditTitleProps extends Omit<PageHeaderProps, 'title' | 'titleActions'> {
  /** The record's title as it is now. */
  value: string;
  /** The field's name — the input's label and what the pencil says it edits ("Edit Title"). */
  label: string;
  /** Whether the reader may change it — without, it is the plain page header. */
  canEdit: boolean;
  /** What stands beside the title in the heading row — a status badge. */
  beside?: ReactNode;
  maxLength?: number;
  /** A sentence when the trimmed draft cannot be saved — an empty title. */
  validate?: (draft: string) => string | null;
  /** Saves the trimmed title. A rejection carries the sentence to show; the draft is kept. */
  save: (draft: string) => Promise<void>;
}

/**
 * The page header with the record's title **edited where it is read** — the
 * title form of {@link InlineEdit} (issue #1453, DS-21; first written for
 * CRM's Opportunity in `specs/158-crm-opportunity-inline-editing/`).
 *
 * Idle, it is the kit's `PageHeader`, with a pencil beside the title named
 * "Edit <label>". Editing, the heading is the field: a large input holding the
 * title as it is, with *Save* and *Cancel*; Enter saves, Escape cancels and
 * gives the focus back to the pencil. The field is not put inside the `h1` —
 * a heading holds words, not a form — so a visually hidden `h1` stays for
 * assistive technology while it is edited. A refusal is said under the field
 * and what was typed is kept.
 */
export function InlineEditTitle(props: InlineEditTitleProps): ReactNode {
  const { value, label, canEdit, beside, maxLength, validate, save, ...header } = props;
  const t = useTranslation('core');
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const pencil = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const returnFocus = useRef(false);
  const editing = draft !== null;

  useEffect(() => {
    if (editing) {
      field.current?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      pencil.current?.focus();
    }
  }, [editing]);

  const close = (): void => {
    returnFocus.current = true;
    setDraft(null);
    setProblem(null);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (draft === null || busy) return;
    const title = draft.trim();
    const invalid = validate?.(title) ?? null;
    if (invalid) {
      setProblem(invalid);
      return;
    }
    if (title === value) {
      close();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await save(title);
      close();
      setNotice(t('common.inlineEdit.saved', { field: label }));
    } catch (failure) {
      setProblem(failure instanceof Error && failure.message ? failure.message : t('common.inlineEdit.error'));
    } finally {
      setBusy(false);
    }
  };

  // The live region keeps its place in either state, so its announcement is reliable.
  const status = (
    <p role="status" className="sr-only">
      {notice}
    </p>
  );

  if (!editing) {
    return (
      <>
        {status}
        <PageHeader
          {...header}
          title={
            <>
              <span className="min-w-0 [overflow-wrap:anywhere]">{value}</span>
              {beside}
            </>
          }
          titleActions={
            canEdit ? (
              <InlineEditPencil
                ref={pencil}
                label={t('common.inlineEdit.edit', { field: label })}
                onClick={(): void => {
                  setProblem(null);
                  setNotice('');
                  setDraft(value);
                }}
              />
            ) : undefined
          }
        />
      </>
    );
  }

  return (
    <>
      {status}
      <header className="mb-6 space-y-1">
        {header.back ? (
          <Link
            to={header.back.to}
            onClick={header.back.onClick}
            className="-ml-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft aria-hidden="true" className="size-3.5" />
            {header.back.label}
          </Link>
        ) : null}
        <h1 className="sr-only">{value}</h1>
        <form
          noValidate
          aria-busy={busy}
          className="flex flex-wrap items-start gap-2"
          onSubmit={(event): void => void submit(event)}
          onKeyDown={(event): void => {
            if (event.key === 'Escape' && !busy) {
              event.preventDefault();
              close();
            }
          }}
        >
          <label htmlFor={fieldId} className="sr-only">
            {label}
          </label>
          <div className="min-w-0 flex-1 basis-64 space-y-1">
            <Input
              ref={field}
              id={fieldId}
              value={draft}
              {...(maxLength !== undefined ? { maxLength } : {})}
              required
              disabled={busy}
              className="h-11 text-xl font-semibold"
              aria-invalid={problem !== null}
              aria-describedby={problem ? errorId : undefined}
              onChange={(event): void => {
                setDraft(event.target.value);
                setProblem(null);
              }}
            />
            {problem ? (
              <p id={errorId} role="alert" className="text-xs text-destructive">
                {problem}
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={close}>
              {t('common.action.cancel')}
            </Button>
            <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy}>
              {busy ? t('common.state.saving') : t('common.action.save')}
            </Button>
          </div>
        </form>
        {header.description ? <p className="text-sm text-muted-foreground">{header.description}</p> : null}
      </header>
    </>
  );
}
