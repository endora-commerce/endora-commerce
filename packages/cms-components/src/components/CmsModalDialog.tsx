'use client';

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * The z-index of the rich-text dialogs and of the editor's full-screen mode:
 * above the fullscreen Page Builder and its 9999 action bar, below the admin
 * kit's `overlay` layer (`MODAL_OVERLAY_Z_INDEX`, 2147483646), so the asset
 * library a host opens from inside the image dialog draws above it.
 */
export const CMS_DIALOG_Z_INDEX = { fullscreen: 2147483000, dialog: 2147483001 } as const;

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hasAttribute('disabled') && element.offsetParent !== null,
  );
}

/** Whether `panel` is the topmost modal dialog in the document — the kit's and this package's alike. */
function isTopmost(panel: HTMLElement): boolean {
  const modals = document.querySelectorAll('[aria-modal="true"]');
  return modals[modals.length - 1] === panel;
}

export interface CmsModalDialogProps {
  /** Rendered as the `<h2>` that names the dialog (`aria-labelledby`). */
  title: ReactNode;
  /** Called on Escape and on a press on the scrim. */
  onClose: () => void;
  children: ReactNode;
  /** Keep the title for assistive technology only — the full-screen editor names itself without a visible heading. */
  hideTitle?: boolean;
  /**
   * `panel` (the default): a centred panel. `fullscreen`: the panel fills the
   * viewport and lays its children out as a column — the rich-text editor's
   * full-screen mode.
   */
  variant?: 'panel' | 'fullscreen';
  /** The panel's width class for `panel`, replacing `cmsc:max-w-[420px]`. */
  widthClassName?: string;
  /**
   * Focused when the dialog closes, instead of the element that held focus
   * when it opened. Read at that moment — for an opener that is re-mounted
   * while the dialog is open, as the full-screen editor's toggle is.
   */
  returnFocusRef?: RefObject<HTMLElement | null> | undefined;
}

/**
 * The modal dialog of `@endora-commerce/cms-components` (issue #1652).
 *
 * The package ships to the storefront, so it cannot use the admin kit's
 * `ModalDialog`; this keeps the same contract with no dependency: a titled
 * panel over a scrim, portalled to `document.body`, named by its title,
 * focus moved in on open and held by Tab / Shift+Tab, Escape and a press on the
 * scrim close it, focus returns to the element that held it when it opened,
 * and with dialogs stacked — this package's or the kit's, such as the asset
 * library opened from the image dialog — only the topmost answers Escape.
 *
 * `admin/test/unit/no-hand-rolled-overlays.test.ts` refuses a hand-drawn
 * overlay anywhere else in the package.
 */
export function CmsModalDialog({
  title,
  onClose,
  children,
  hideTitle = false,
  variant = 'panel',
  widthClassName = 'cmsc:max-w-[420px]',
  returnFocusRef,
}: CmsModalDialogProps): ReactNode {
  const titleId = useId();
  // Read while rendering, before an `autoFocus` control inside the panel takes focus on commit.
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );
  const returnFocusRefRef = useRef(returnFocusRef);
  returnFocusRefRef.current = returnFocusRef;
  const panelRef = useRef<HTMLDivElement>(null);
  /** What took focus inside the panel first (an `autoFocus` control), so StrictMode's second mount puts it back. */
  const initialRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    const current = document.activeElement as HTMLElement | null;

    if (current && panel.contains(current)) {
      initialRef.current = current;
    } else {
      const initial = initialRef.current?.isConnected ? initialRef.current : (focusables(panel)[0] ?? panel);
      initial.focus();
      if (initial !== panel) initialRef.current = initial;
    }

    const onTab = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const items = focusables(panel);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey ? index <= 0 : index === items.length - 1) {
        event.preventDefault();
        items[event.shiftKey ? items.length - 1 : 0]!.focus();
      }
    };

    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTopmost(panel)) return;
      // Focus on another surface (a dialog of the host's) is that surface's to answer.
      const target = event.target as Node | null;
      if (target && target !== document.body && target !== document.documentElement && !panel.contains(target)) return;
      event.preventDefault();
      onCloseRef.current();
    };

    panel.addEventListener('keydown', onTab);
    document.addEventListener('keydown', onEscape);
    return (): void => {
      panel.removeEventListener('keydown', onTab);
      document.removeEventListener('keydown', onEscape);
      const target = returnFocusRefRef.current?.current ?? opener;
      if (target?.isConnected && !panel.contains(target)) target.focus();
    };
  }, [opener]);

  const fullscreen = variant === 'fullscreen';
  const dialog = (
    <div
      data-layer="overlay"
      className={
        fullscreen
          ? 'cmsc:fixed cmsc:inset-0 cmsc:flex cmsc:flex-col cmsc:bg-[rgba(15,23,42,0.55)] cmsc:p-[24px]'
          : 'cmsc:fixed cmsc:inset-0 cmsc:flex cmsc:items-center cmsc:justify-center cmsc:bg-[rgba(15,23,42,0.45)] cmsc:p-[16px]'
      }
      style={{ zIndex: fullscreen ? CMS_DIALOG_Z_INDEX.fullscreen : CMS_DIALOG_Z_INDEX.dialog }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={
          fullscreen
            ? 'cmsc:flex cmsc:h-full cmsc:w-full cmsc:max-w-[860px] cmsc:mx-auto cmsc:flex-col cmsc:outline-none'
            : `cmsc:font-sans cmsc:box-border cmsc:max-h-full cmsc:overflow-y-auto cmsc:w-full ${widthClassName} cmsc:rounded-[10px] cmsc:border cmsc:border-solid cmsc:border-[#d9e0e7] cmsc:bg-white cmsc:p-[16px] cmsc:shadow-lg cmsc:outline-none`
        }
      >
        <h2
          id={titleId}
          className={
            hideTitle
              ? 'cmsc:sr-only'
              : 'cmsc:m-0 cmsc:mb-[12px] cmsc:text-[15px] cmsc:font-semibold cmsc:text-[#15202b]'
          }
        >
          {title}
        </h2>
        {children}
      </div>
    </div>
  );

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
