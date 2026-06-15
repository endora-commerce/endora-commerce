'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * "Clear list" control for the shopping-list detail page. Renders a button
 * that opens a confirmation dialog before emptying the whole list — clearing
 * every item is destructive and irreversible, so it must be confirmed.
 *
 * The dialog is rendered through a portal to `document.body` so its
 * `position: fixed` backdrop covers the whole viewport: rendered inline it was
 * trapped inside the account-panel container (an ancestor establishes a
 * containing block), so the overlay only dimmed the panel.
 *
 * Confirming invokes the `clearAction` server action inside a transition
 * (rather than a plain `<form>` submit) so dismissing the dialog can't unmount
 * the form mid-flight and abort the mutation — the previous version closed the
 * dialog in the submit button's onClick, which cancelled the clear before it
 * ran.
 */
export function ClearListButton({
  listId,
  clearAction,
}: {
  listId: string;
  clearAction: (formData: FormData) => void | Promise<void>;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const confirmClear = (): void => {
    // Dispatch inside the transition (held by this still-mounted component),
    // then close the dialog. Closing the portal can't abort the in-flight
    // action; the server action's redirect refreshes the page with the
    // now-empty list.
    startTransition(async () => {
      const formData = new FormData();
      formData.set('listId', listId);
      await clearAction(formData);
    });
    setOpen(false);
  };

  return (
    <>
      <button type="button" className="btn btn--outline" onClick={(): void => setOpen(true)}>
        Clear list
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="clear-list-title"
              style={{
                position: 'fixed',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(0,0,0,0.55)',
                zIndex: 1000,
              }}
              onClick={(e): void => {
                // Click on the backdrop (not the card) dismisses the dialog.
                if (e.target === e.currentTarget && !pending) setOpen(false);
              }}
            >
              <div
                style={{
                  background: 'var(--surface, #fff)',
                  color: 'var(--fg, #111)',
                  maxWidth: 460,
                  width: '90%',
                  padding: 24,
                  borderRadius: 8,
                  boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
                }}
              >
                <h2 id="clear-list-title" style={{ marginTop: 0, fontSize: 18 }}>
                  Clear this list?
                </h2>
                <p style={{ marginTop: 8, fontSize: 14 }}>
                  This removes all items from the list. This action cannot be undone.
                </p>
                <div
                  style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}
                >
                  <button
                    type="button"
                    className="btn btn--outline"
                    disabled={pending}
                    onClick={(): void => setOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={pending}
                    style={{ background: '#b91c1c', borderColor: '#b91c1c', color: '#fff' }}
                    onClick={confirmClear}
                  >
                    {pending ? 'Clearing…' : 'Clear list'}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
