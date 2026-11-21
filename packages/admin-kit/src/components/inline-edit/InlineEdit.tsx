import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '../../ui/button.js';
import { cn } from '../../lib/utils.js';
import { useTranslation } from '../../i18n/useTranslation.js';

/** What the editor of an inline field is handed while it is open. */
export interface InlineEditorProps<T> {
  /** The id the control takes, so the field's name labels it and the focus lands on it. */
  id: string;
  /**
   * The id of the field's name. A `group` editor — a radio group, a tag
   * picker — names itself with it (`aria-labelledby`); a single control is
   * already labelled through `id`.
   */
  labelId: string;
  draft: T;
  setDraft: (next: T) => void;
  busy: boolean;
  /** The id of the line that says what is wrong, while something is. */
  errorId: string | undefined;
  /** Save now — for a control whose own key saves (a formatted field's Ctrl/Cmd + Enter). */
  submit: () => void;
}

export interface InlineEditProps<T> {
  /** The field's name: the label of its control, and what its *Edit* button says it edits. */
  label: string;
  /** The value as it is read. */
  display: ReactNode;
  /** Whether the reader may change it — without, it is read and nothing more. */
  canEdit: boolean;
  /** The draft an edit starts from: the value as it now is. */
  initial: () => T;
  editor: (props: InlineEditorProps<T>) => ReactNode;
  /** A sentence when the draft cannot be saved as it is; checked before anything is sent. */
  validate?: (draft: T) => string | null;
  /**
   * Saves the draft. A rejection carries the sentence to show (its `message`),
   * and the draft is kept for another try; one without a sentence shows the
   * kit's.
   */
  save: (draft: T) => Promise<void>;
  /** Whether the draft is the value unchanged — then *Save* is no request. */
  unchanged?: (draft: T) => boolean;
  /** Where the label goes: above the value (a fact), or nowhere visible (a section's heading names it). */
  labelVisible?: boolean;
  /**
   * The editor is a group of controls — radios, a multi-select — rather than
   * one: the label is then drawn as text with `labelId`, for the group's
   * `aria-labelledby`, instead of a `<label for>` that would name only one of
   * them. The editor still puts `id` on the control the focus should land on.
   */
  group?: boolean;
  className?: string;
}

/**
 * One fact of a record, edited where it is shown — the admin's one model for
 * editing a record's facts (issue #1453, UX audit 2026-11-17 DS-21, owner
 * decision DEC-05; first written for CRM in
 * `specs/158-crm-opportunity-inline-editing/`, FR-001 – FR-004): no form
 * elsewhere, no page of its own.
 *
 * Four states, each said on screen and to assistive technology:
 *
 * - **idle** — the value, and beside it a pencil that is always there (nothing
 *   is behind a hover) and is named "Edit <field>";
 * - **editing** — the control, holding the value as it now is, with the focus
 *   in it, and *Save* and *Cancel*. Enter saves a one-line field (a
 *   formatted text keeps Enter for its lines and saves on Ctrl/Cmd + Enter);
 *   Escape cancels and gives the focus back to the pencil;
 * - **saving** — the control and the buttons held, *Save* busy;
 * - **error** — the sentence of what went wrong under the control, tied to it,
 *   and the draft kept as typed.
 *
 * Once saved, the value is shown again and "<field> saved." is announced
 * through a live region mounted before it has text (WCAG 4.1.3). The one
 * *Save* is the only filled button while a field is open (Von Restorff);
 * *Cancel* is beside it, as every form of the admin has them (Jakob).
 */
export function InlineEdit<T>(props: InlineEditProps<T>): ReactNode {
  const {
    label,
    display,
    canEdit,
    initial,
    editor,
    validate,
    save,
    unchanged,
    labelVisible = true,
    group = false,
    className,
  } = props;
  const t = useTranslation('core');
  const baseId = useId();
  const controlId = `${baseId}-control`;
  const labelId = `${baseId}-label`;
  const errorId = `${baseId}-error`;
  // A draft may itself be `null` — a cleared contact, no Sales Channel — so
  // whether the field is open is its own state.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const pencil = useRef<HTMLButtonElement>(null);
  const region = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  /** Where the focus goes once the field closes: back to its pencil. */
  const returnFocus = useRef(false);

  useEffect(() => {
    if (editing) {
      // The control the editor drew: an input, a picker, a formatted field. One
      // still held — a picker reading its options — leaves the focus on the
      // form, inside the field, so the next Tab reaches it (WCAG 2.4.3).
      const control = region.current?.ownerDocument.getElementById(controlId);
      if (control && !control.matches(':disabled')) control.focus();
      else form.current?.focus();
      return;
    }
    if (returnFocus.current) {
      returnFocus.current = false;
      pencil.current?.focus();
    }
  }, [editing, controlId]);

  const open = (): void => {
    setProblem(null);
    setNotice('');
    setDraft(initial());
    setEditing(true);
  };

  const close = (): void => {
    returnFocus.current = true;
    setEditing(false);
    setDraft(null);
    setProblem(null);
  };

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (!editing || busy) return;
    const current = draft as T;
    const invalid = validate?.(current) ?? null;
    if (invalid) {
      setProblem(invalid);
      return;
    }
    if (unchanged?.(current)) {
      close();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await save(current);
      close();
      setNotice(t('common.inlineEdit.saved', { field: label }));
    } catch (failure) {
      setProblem(failure instanceof Error && failure.message ? failure.message : t('common.inlineEdit.error'));
    } finally {
      setBusy(false);
    }
  };

  const labelClass = labelVisible ? 'block text-xs text-muted-foreground' : 'sr-only';
  const labelElement = editing ? (
    group ? (
      <p id={labelId} className={labelClass}>
        {label}
      </p>
    ) : (
      <label id={labelId} htmlFor={controlId} className={labelClass}>
        {label}
      </label>
    )
  ) : labelVisible ? (
    <p className="text-xs text-muted-foreground">{label}</p>
  ) : null;

  return (
    <div ref={region} className={className}>
      {labelElement}
      {editing ? (
        <form
          ref={form}
          noValidate
          tabIndex={-1}
          aria-busy={busy}
          className="mt-1 space-y-2 outline-none"
          onSubmit={(event): void => void submit(event)}
          onKeyDown={(event): void => {
            // A control that takes Escape for itself — an open list — stops it first.
            if (event.key === 'Escape' && !busy && !event.defaultPrevented) {
              event.preventDefault();
              close();
            }
          }}
        >
          {editor({
            id: controlId,
            labelId,
            draft: draft as T,
            setDraft: (next) => {
              setDraft(next);
              setProblem(null);
            },
            busy,
            errorId: problem ? errorId : undefined,
            submit: () => void submit(),
          })}
          {problem ? (
            <p id={errorId} role="alert" className="text-xs text-destructive">
              {problem}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-8"
              disabled={busy}
              onClick={close}
            >
              {t('common.action.cancel')}
            </Button>
            <Button type="submit" size="sm" className="min-h-11 sm:min-h-8" disabled={busy} aria-busy={busy}>
              {busy ? t('common.state.saving') : t('common.action.save')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{display}</div>
          {canEdit ? (
            <InlineEditPencil
              ref={pencil}
              className="-my-1"
              label={t('common.inlineEdit.edit', { field: label })}
              onClick={open}
            />
          ) : null}
        </div>
      )}
      {/* Mounted before it has text, so the announcement is reliable. */}
      <p role="status" className="sr-only">
        {notice}
      </p>
    </div>
  );
}

/** The pencil every inline field opens with: icon-only, so named, and 44 px on touch (Fitts). */
export function InlineEditPencil(props: {
  label: string;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
  disabled?: boolean;
  className?: string;
}): ReactNode {
  return (
    <Button
      ref={props.ref}
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        'min-h-11 min-w-11 shrink-0 px-2 text-muted-foreground hover:text-foreground sm:min-h-8 sm:min-w-8',
        props.className,
      )}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled ?? false}
      onClick={props.onClick}
    >
      <Pencil aria-hidden="true" className="size-4" />
    </Button>
  );
}
