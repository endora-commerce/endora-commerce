'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Feature 044 / US2 — reusable bottom-sheet primitive (Industria Mobile
 * design §03). A dimmed backdrop + a rounded sheet anchored to the bottom
 * with a grab handle, a scrollable body, and an optional pinned footer.
 *
 * Controlled: the parent owns `open` and supplies `onClose`. Dismisses on
 * backdrop tap, the close button, or Escape. Shown only on phones — the
 * `.m-sheet*` classes are `md:hidden` (globals.css), so a stray `open`
 * on desktop renders nothing visible.
 */
export function BottomSheet(props: {
  open: boolean;
  onClose: () => void;
  title?: string;
  closeLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
}): ReactNode {
  const { open, onClose } = props;
  const bodyRef = useRef<HTMLDivElement>(null);

  // Escape-to-close + body scroll lock while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="m-sheet-dim" onClick={onClose} aria-hidden="true" />
      <div className="m-sheet" role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="m-sheet__grab" aria-hidden="true" />
        {props.title ? (
          <div className="m-sheet__head">
            <h3 className="text-[15px] font-semibold text-fg">{props.title}</h3>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              aria-label={props.closeLabel ?? 'Close'}
            >
              <XIcon />
            </button>
          </div>
        ) : null}
        <div className="m-sheet__body" ref={bodyRef}>
          {props.children}
        </div>
        {props.footer ? <div className="m-sheet__foot">{props.footer}</div> : null}
      </div>
    </>
  );
}

function XIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
