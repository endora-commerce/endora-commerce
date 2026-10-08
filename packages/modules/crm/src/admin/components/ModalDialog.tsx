import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useFocusTrap } from '@endora-commerce/admin-kit/components';

/**
 * A modal dialog: a titled panel over a scrim that holds focus until it is
 * closed.
 *
 * The kit publishes no dialog primitive — the screens that need one each draw
 * the scrim and the panel themselves (`OrderStatusConfigPage`'s delete
 * confirmation is the nearest). This one adds what those leave out: an
 * accessible name (`aria-labelledby`), a focus trap (the kit's `useFocusTrap`,
 * which also returns focus to the control that opened the dialog), and Escape
 * to close. It is module-private and a promotion candidate for the kit the
 * moment a second module wants it.
 */
export interface ModalDialogProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** The action row, right-aligned under the content. */
  footer?: ReactNode;
  /** While `true` Escape and the scrim do not close the dialog (a save in flight). */
  busy?: boolean;
}

export function ModalDialog(props: ModalDialogProps): ReactNode {
  const { title, onClose, children, footer, busy = false } = props;
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return (): void => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event): void => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-background p-6 shadow-lg"
      >
        <h2 id={titleId} className="mb-4 text-lg font-semibold">
          {title}
        </h2>
        {children}
        {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
