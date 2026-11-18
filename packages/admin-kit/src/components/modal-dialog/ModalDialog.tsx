import { useEffect, useId, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils.js';
import { useFocusTrap } from '../hooks/useFocusTrap.js';

/**
 * Where a dialog stacks. `page` (the default) is the admin's ordinary modal
 * layer, the same `z-50` the kit's popovers and selects use, so a select opened
 * inside the dialog still draws above it. `overlay` lifts the dialog above the
 * fullscreen Page Builder and the floating chrome it carries (the Puck action
 * bar sits at 9999) — for a dialog opened from inside the builder (issue #1444,
 * DS-11). A popover inside an `overlay` dialog must therefore stay inline
 * rather than portal itself to `page`.
 */
export type ModalDialogLayer = 'page' | 'overlay';

/** The z-index of the `overlay` layer: above the builder's 9999 action bar. */
export const MODAL_OVERLAY_Z_INDEX = 10000;

/**
 * The open dialogs, innermost last. Only the last answers Escape, so closing a
 * confirmation opened over a form dialog leaves the form dialog open.
 */
const openDialogs: symbol[] = [];

/**
 * A modal dialog: a titled panel over a scrim that holds focus until it is
 * closed.
 *
 * Promoted from `crm` by feature 147 (`specs/147-saved-views/research.md` R-2)
 * once a second consumer — the saved-views dialogs — wanted it. It carries what
 * a hand-drawn scrim and panel leave out: an accessible name
 * (`aria-labelledby`), a focus trap (the kit's `useFocusTrap`, which also
 * returns focus to the control that opened the dialog), Escape to close, and a
 * `busy` state that makes both Escape and the scrim inert while a request is in
 * flight.
 *
 * Since issue #1444 (DS-11) it is **the** dialog of the admin: it renders into
 * `document.body` through a portal, so a call site may sit anywhere — inside a
 * drawer moved with `transform`, a table row or the fullscreen Page Builder —
 * and still be placed against the viewport; `layer="overlay"` stacks it above
 * the builder; with two open, Escape closes only the topmost; and a dialog with
 * nothing focusable in it focuses its own panel, so focus never stays behind
 * the scrim. A hand-drawn `fixed inset-0` overlay, `role="dialog"` or
 * `createPortal` in admin sources is refused by
 * `admin/test/unit/no-hand-rolled-overlays.test.ts`.
 */
export interface ModalDialogProps {
  /** Rendered as the `<h2>` that names the dialog. */
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** The action row, right-aligned under the content. */
  footer?: ReactNode;
  /** While `true` Escape and the scrim do not close the dialog (a save in flight). */
  busy?: boolean;
  /** Focused on open instead of the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Focused after the dialog unmounts instead of the opener. Read when the
   * dialog closes, so a ref still `null` at that moment falls back to the opener.
   */
  finalFocusRef?: RefObject<HTMLElement | null>;
  /**
   * The id of the element that describes the dialog — its warning or its
   * question — set as the panel's `aria-describedby`, so a screen reader reads
   * it with the title when focus enters the dialog. Left off when absent; pass
   * it only while the element it names is rendered.
   */
  'aria-describedby'?: string;
  /**
   * The panel's width class, replacing the default `max-w-lg` — for a dialog that
   * holds a form rather than a sentence (e.g. `max-w-2xl`).
   */
  widthClassName?: string;
  /**
   * Whether a press on the scrim closes the dialog (default `true`). A dialog
   * holding unsaved input passes `false`, so a stray click does not discard it;
   * Escape and its own buttons still close it.
   */
  dismissOnScrim?: boolean;
  /** Which stacking layer the dialog opens on — see {@link ModalDialogLayer}. */
  layer?: ModalDialogLayer;
}

export function ModalDialog(props: ModalDialogProps): ReactNode {
  const {
    title,
    onClose,
    children,
    footer,
    busy = false,
    initialFocusRef,
    finalFocusRef,
    'aria-describedby': describedBy,
    widthClassName = 'max-w-lg',
    dismissOnScrim = true,
    layer = 'page',
  } = props;
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<symbol>(Symbol('modal-dialog'));
  useFocusTrap(panelRef, true, { initialFocusRef, finalFocusRef });

  // Declared after the trap, so it runs after the trap has placed focus: a
  // dialog holding nothing focusable keeps focus on its own panel.
  useEffect(() => {
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus();
  }, []);

  useEffect(() => {
    const token = tokenRef.current;
    openDialogs.push(token);
    return (): void => {
      const index = openDialogs.lastIndexOf(token);
      if (index >= 0) openDialogs.splice(index, 1);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || busy) return;
      // A listbox, a combobox or a nested dialog answered it first.
      if (openDialogs[openDialogs.length - 1] !== tokenRef.current) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return (): void => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  const layerStyle: CSSProperties | undefined = layer === 'overlay' ? { zIndex: MODAL_OVERLAY_Z_INDEX } : undefined;

  const dialog = (
    <div
      className={cn('fixed inset-0 flex items-center justify-center bg-black/40 p-4', layer === 'page' && 'z-50')}
      style={layerStyle}
      data-layer={layer}
      onMouseDown={(event): void => {
        if (event.target === event.currentTarget && !busy && dismissOnScrim) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        aria-busy={busy}
        tabIndex={-1}
        className={`max-h-full w-full ${widthClassName} overflow-y-auto rounded-lg bg-background p-6 shadow-lg outline-none`}
      >
        <h2 id={titleId} className="mb-4 text-lg font-semibold">
          {title}
        </h2>
        {children}
        {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
