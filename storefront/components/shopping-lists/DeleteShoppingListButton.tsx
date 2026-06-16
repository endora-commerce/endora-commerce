'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * "Delete list" control for the shopping-lists overview. Renders a button that
 * opens a confirmation dialog before deleting a whole shopping list — deleting
 * a list is destructive and irreversible, so it must be confirmed.
 *
 * Mirrors `ClearListButton`: the dialog is portalled to `document.body` so its
 * fixed backdrop covers the viewport rather than being trapped inside the
 * account panel, and the `deleteAction` server action runs inside a transition
 * so dismissing the dialog can't unmount the form and abort the mutation.
 */
export function DeleteShoppingListButton({
  listId,
  listName,
  deleteAction,
}: {
  listId: string;
  listName: string;
  deleteAction: (formData: FormData) => void | Promise<void>;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const confirmDelete = (): void => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set('id', listId);
      await deleteAction(formData);
    });
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className="btn btn--outline btn--sm"
        onClick={(): void => setOpen(true)}
      >
        Delete
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-list-title"
              style={{
                position: 'fixed',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(0,0,0,0.55)',
                zIndex: 1000,
              }}
              onClick={(e): void => {
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
                <h2 id="delete-list-title" style={{ marginTop: 0, fontSize: 18 }}>
                  Delete this list?
                </h2>
                <p style={{ marginTop: 8, fontSize: 14 }}>
                  Deleting <strong>{listName}</strong> removes the list and all its items.
                  This action cannot be undone.
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
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
                    onClick={confirmDelete}
                  >
                    {pending ? 'Deleting…' : 'Delete list'}
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
