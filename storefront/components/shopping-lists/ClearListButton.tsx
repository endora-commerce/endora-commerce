'use client';

import { useState, type ReactNode } from 'react';

/**
 * "Clear list" control for the shopping-list detail page. Renders a button
 * that opens a confirmation dialog before emptying the whole list — clearing
 * every item is destructive and irreversible, so it must be confirmed.
 *
 * Confirming submits the `clearAction` server action (passed by the server
 * component) so the actual mutation + redirect stays on the server, mirroring
 * the page's other actions (rename, remove item, convert).
 */
export function ClearListButton({
  listId,
  clearAction,
}: {
  listId: string;
  clearAction: (formData: FormData) => void | Promise<void>;
}): ReactNode {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn--outline" onClick={(): void => setOpen(true)}>
        Clear list
      </button>

      {open ? (
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
            zIndex: 60,
          }}
          onClick={(e): void => {
            // Click on the backdrop (not the card) dismisses the dialog.
            if (e.target === e.currentTarget) setOpen(false);
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
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                type="button"
                className="btn btn--outline"
                onClick={(): void => setOpen(false)}
              >
                Cancel
              </button>
              <form action={clearAction}>
                <input type="hidden" name="listId" value={listId} />
                <button
                  type="submit"
                  className="btn"
                  style={{ background: '#b91c1c', borderColor: '#b91c1c', color: '#fff' }}
                  onClick={(): void => setOpen(false)}
                >
                  Clear list
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
