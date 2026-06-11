import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  createShoppingList,
  deleteShoppingList,
  listShoppingLists,
  setDefaultShoppingList,
} from '../../../lib/api/shopping-lists';
import { getSessionCookie } from '../../../lib/session';
import { StorefrontApiError } from '../../../lib/api/client';

/**
 * Shopping lists list (T205). Shows every list owned by the current
 * customer with item counts; lets the buyer create new lists and
 * delete old ones.
 */

export default async function ShoppingListsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/account/shopping-lists');
  const lists = await listShoppingLists(session);
  const params = await searchParams;

  return (
    <>
      <h2>Shopping lists</h2>
      <p className="b2b-auth__hint">
        Save recurring orders as lists. Convert all or selected items into a cart or quote
        request when you&apos;re ready.
      </p>
      {params.error ? <p className="b2b-auth__error">{params.error}</p> : null}

      <form action={createAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="new-name">Create a new list</label>
          <input id="new-name" name="name" required maxLength={160} placeholder="Weekly restock" />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">Create list</button>
        </div>
      </form>

      {lists.length === 0 ? (
        <p className="muted">No lists yet.</p>
      ) : (
        <table className="b2b-account__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Items</th>
              <th>Updated</th>
              <th>Default</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lists.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link href={`/shopping-lists/${l.id}`}>{l.name}</Link>
                </td>
                <td>{l.items.length}</td>
                <td>{new Date(l.updatedAt).toLocaleString()}</td>
                <td>
                  {l.isDefault ? (
                    <span className="industria-status industria-status--paid">Domyślna</span>
                  ) : (
                    <form action={setDefaultAction} style={{ display: 'inline' }}>
                      <input type="hidden" name="id" value={l.id} />
                      <button type="submit" className="btn btn--outline btn--sm">
                        Ustaw jako domyślną
                      </button>
                    </form>
                  )}
                </td>
                <td>
                  <form action={deleteAction} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={l.id} />
                    <button type="submit">Delete</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

async function createAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const name = ((formData.get('name') as string) ?? '').trim();
  if (!name) redirect('/shopping-lists?error=name-required');
  let id: string;
  try {
    const created = await createShoppingList(session, name);
    id = created.id;
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Could not create list.';
    redirect(`/shopping-lists?error=${encodeURIComponent(message)}`);
  }
  redirect(`/shopping-lists/${id}`);
}

async function deleteAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const id = (formData.get('id') as string) ?? '';
  try {
    await deleteShoppingList(session, id);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Could not delete list.';
    redirect(`/shopping-lists?error=${encodeURIComponent(message)}`);
  }
  redirect(`/shopping-lists`);
}

async function setDefaultAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const id = (formData.get('id') as string) ?? '';
  try {
    await setDefaultShoppingList(session, id);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Could not set the default list.';
    redirect(`/shopping-lists?error=${encodeURIComponent(message)}`);
  }
  redirect('/shopping-lists');
}
