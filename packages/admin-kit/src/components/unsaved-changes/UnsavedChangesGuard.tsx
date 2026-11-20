import { useCallback, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../../ui/button.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { cn } from '../../lib/utils.js';
import { useLeaveInterception } from '../../lib/use-unsaved-changes-prompt.js';
import { ModalDialog } from '../modal-dialog/ModalDialog.js';

/**
 * The admin's one unsaved-changes guard (issue #1446, UX audit DS-13).
 *
 * `useUnsavedChangesGuard` arms the same interception as `useUnsavedChangesPrompt`
 * (`./lib`) — `beforeunload`, same-origin link clicks in the capture phase, and,
 * opt-in, a `role="tab"` outside a given element — but asks in the admin's own
 * dialog with three answers instead of the browser's two:
 *
 * - **Stay here** — nothing happens; focus returns to where it was. It is the
 *   dialog's initial focus, so an Enter pressed by accident keeps the work
 *   (WCAG 3.3.4, error prevention).
 * - **Discard changes** — `onDiscard` runs, then the navigation goes ahead.
 * - **Save and continue** — the one primary action (Von Restorff): `onSave`
 *   runs and the navigation goes ahead only if it resolves `true`. A refused
 *   save closes the dialog and leaves the operator on the screen with the
 *   screen's own error. Without `onSave` the choice is Discard or Stay.
 *
 * The blocked activation is **replayed** — the same link or tab is clicked
 * again — so the guard needs no router and keeps whatever the link does
 * (a basename, `state`, `replace`). A navigation the screen makes itself
 * (`navigate()` behind a button) is not a click; wrap it in `confirm(action)`.
 *
 * The browser's own unload dialog cannot be replaced, and Back / Forward is not
 * blockable under the admin's component `<BrowserRouter>` (no data router, so
 * no `useBlocker`): those two keep the browser's behaviour.
 */
export interface UnsavedChangesGuardOptions {
  /** Whether the screen holds changes that a navigation would lose. */
  dirty: boolean;
  /**
   * Saves the changes; resolves `true` when they were saved. Omit when the
   * screen cannot save from the dialog (no permission, nothing valid to send).
   */
  onSave?: (() => Promise<boolean> | boolean) | undefined;
  /** Throws the changes away before the navigation proceeds (reset to the last saved state). */
  onDiscard?: (() => void) | undefined;
  /** Also guard `role="tab"` activations outside this element. */
  guardTabsOutside?: RefObject<HTMLElement | null> | undefined;
  /** Overrides the dialog's title (default: `form.unsavedChanges.title`). */
  title?: ReactNode;
  /** Overrides the dialog's question (default: `form.unsavedChanges.body`). */
  message?: ReactNode;
}

export interface UnsavedChangesGuard {
  /**
   * Runs `action` now when nothing is unsaved, otherwise asks first and runs it
   * after Discard, or after a successful Save. For the screen's own `navigate()`
   * calls and for any in-screen switch that would drop the changes.
   */
  confirm: (action: () => void) => void;
  /** Whether the dialog is open. */
  asking: boolean;
  /** The dialog — render it once, anywhere in the screen (it portals to `document.body`). */
  dialog: ReactNode;
}

export function useUnsavedChangesGuard(options: UnsavedChangesGuardOptions): UnsavedChangesGuard {
  const { dirty, onSave, onDiscard, guardTabsOutside, title, message } = options;
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);

  useLeaveInterception(
    dirty,
    (replay) => {
      setPending(() => replay);
      return false;
    },
    { guardTabsOutside },
  );

  const confirm = useCallback(
    (action: () => void): void => {
      if (!dirty) {
        action();
        return;
      }
      setPending(() => action);
    },
    [dirty],
  );

  const stay = (): void => setPending(null);
  const discard = (): void => {
    const proceed = pending;
    setPending(null);
    onDiscard?.();
    proceed?.();
  };
  const save = onSave
    ? async (): Promise<void> => {
        const proceed = pending;
        setSaving(true);
        let ok = false;
        try {
          ok = await onSave();
        } catch {
          ok = false;
        } finally {
          setSaving(false);
          setPending(null);
        }
        if (ok) proceed?.();
      }
    : undefined;

  const dialog =
    pending !== null ? (
      <UnsavedChangesDialog
        title={title}
        message={message}
        saving={saving}
        onStay={stay}
        onDiscard={discard}
        onSave={save ? (): void => void save() : undefined}
      />
    ) : null;

  return { confirm, asking: pending !== null, dialog };
}

export interface UnsavedChangesDialogProps {
  title?: ReactNode;
  message?: ReactNode;
  /** A save started from the dialog is in flight: every button, Escape and the scrim are inert. */
  saving?: boolean;
  onStay: () => void;
  onDiscard: () => void;
  /** Absent, the dialog offers Discard or Stay only. */
  onSave?: (() => void) | undefined;
}

/**
 * The Save / Discard / Stay question on its own, for a screen that decides
 * itself *when* to ask (a scope switch, a record switch). Most screens use
 * {@link useUnsavedChangesGuard}, which renders this.
 */
export function UnsavedChangesDialog(props: UnsavedChangesDialogProps): ReactNode {
  const { title, message, saving = false, onStay, onDiscard, onSave } = props;
  const t = useTranslation('core');
  const bodyId = useId();
  const stayRef = useRef<HTMLButtonElement>(null);
  const canSave = onSave !== undefined;

  const dialog = (
    <ModalDialog
      title={title ?? t('form.unsavedChanges.title')}
      onClose={onStay}
      busy={saving}
      dismissOnScrim={false}
      initialFocusRef={stayRef}
      aria-describedby={bodyId}
      footer={
        <>
          <Button
            ref={stayRef}
            type="button"
            variant={canSave ? 'outline' : 'default'}
            disabled={saving}
            onClick={onStay}
            data-testid="unsaved-changes-stay"
          >
            {t('form.unsavedChanges.stay')}
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={onDiscard} data-testid="unsaved-changes-discard">
            {t('form.unsavedChanges.discard')}
          </Button>
          {canSave ? (
            <Button
              type="button"
              disabled={saving}
              aria-busy={saving || undefined}
              onClick={onSave}
              data-testid="unsaved-changes-save"
            >
              {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              {saving ? t('form.unsavedChanges.saving') : t('form.unsavedChanges.save')}
            </Button>
          ) : null}
        </>
      }
    >
      <p id={bodyId} className="text-sm">
        {message ?? t('form.unsavedChanges.body')}
      </p>
    </ModalDialog>
  );
  // ModalDialog portals itself into document.body (#1444, DS-11).
  return dialog;
}

export interface UnsavedChangesHintProps {
  dirty: boolean;
  className?: string;
}

/**
 * "Unsaved changes" beside a screen's Save button — the system status a guard
 * alone does not give (Doherty, visibility of system status). A polite live
 * region mounted empty from the first render, so the change is announced
 * (WCAG 4.1.3); deliberately `aria-live` without `role="status"`, so it never
 * competes with a screen's own save-result status region. The dot is
 * decorative and the text carries the meaning, never the colour alone.
 */
export function UnsavedChangesHint({ dirty, className }: UnsavedChangesHintProps): ReactNode {
  const t = useTranslation('core');
  return (
    <span
      aria-live="polite"
      aria-atomic="true"
      data-testid="unsaved-changes-hint"
      className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}
    >
      {dirty ? (
        <>
          <span aria-hidden="true" className="size-2 rounded-full bg-amber-500" />
          {t('form.unsavedChanges.hint')}
        </>
      ) : null}
    </span>
  );
}
