import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  convertShoppingListToCart,
  convertShoppingListToRfq,
  getShoppingList,
  removeShoppingListItem,
  renameShoppingList,
  updateShoppingListItem,
} from '../../../../lib/api/shopping-lists';
import { getSessionCookie } from '../../../../lib/session';
import { StorefrontApiError } from '../../../../lib/api/client';

/**
 * Shopping list detail (T205). Items can be edited inline; "Convert all
 * to cart" / "Convert all to RFQ" run the bulk conversion. Per-item
 * checkboxes feed an `itemIds` array to the server actions for the
 * "Convert selected" variant; archived skips are surfaced via a banner
 * after conversion.
 */

export default async function ShoppingListDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    cartAdded?: string;
    cartSkipped?: string;
    rfqId?: string;
    rfqAdded?: string;
    rfqSkipped?: string;
  }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  const { id } = await params;
  if (!session) redirect(`/login?next=/account/shopping-lists/${id}`);
  const sp = await searchParams;
  let list;
  try {
    list = await getShoppingList(session, id);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) {
      return (
        <div>
          <h2>Shopping list not found</h2>
          <p className="b2b-auth__error">We couldn&apos;t find that list.</p>
        </div>
      );
    }
    throw err;
  }

  return (
    <>
      <h2>{list.name}</h2>
      <p>
        <Link href="/shopping-lists">← All lists</Link>
      </p>
      {sp.error ? <p className="b2b-auth__error">{sp.error}</p> : null}
      {sp.cartAdded ? (
        <p className="b2b-auth__success">
          Added {sp.cartAdded} item(s) to your cart
          {sp.cartSkipped && Number(sp.cartSkipped) > 0
            ? `, skipped ${sp.cartSkipped} archived row(s)`
            : ''}
          .
        </p>
      ) : null}
      {sp.rfqAdded ? (
        <p className="b2b-auth__success">
          Added {sp.rfqAdded} item(s) to your draft RFQ
          {sp.rfqSkipped && Number(sp.rfqSkipped) > 0
            ? `, skipped ${sp.rfqSkipped} archived row(s)`
            : ''}
          . <Link href={`/quote-requests/${sp.rfqId}`}>Open the RFQ</Link>.
        </p>
      ) : null}

      <form action={renameAction} className="b2b-auth__form">
        <input type="hidden" name="listId" value={list.id} />
        <div className="b2b-auth__field">
          <label htmlFor="rename">Rename list</label>
          <input id="rename" name="name" defaultValue={list.name} required maxLength={160} />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">Rename</button>
        </div>
      </form>

      <h3>Items</h3>
      {list.items.length === 0 ? (
        <p className="muted">
          No items yet. Find a product on the <Link href="/catalog">catalog</Link> and add it from
          its detail page (coming next).
        </p>
      ) : (
        <form action={convertSelectedToCartAction}>
          <input type="hidden" name="listId" value={list.id} />
          <table className="b2b-account__table">
            <thead>
              <tr>
                <th></th>
                <th>Product</th>
                <th>Qty</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <input type="checkbox" name="itemIds" value={it.id} />
                  </td>
                  <td>
                    <Link href={`/p/${it.productId}`}>{it.productId.slice(0, 8)}</Link>
                    {it.variantId ? <> · variant {it.variantId.slice(0, 8)}</> : null}
                  </td>
                  <td>
                    <UpdateQtyForm listId={list.id} itemId={it.id} qty={it.quantity} />
                  </td>
                  <td>{it.note ?? ''}</td>
                  <td>
                    <RemoveItemForm listId={list.id} itemId={it.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="b2b-auth__actions">
            <button type="submit" formAction={convertAllToCartAction}>
              Convert all to cart
            </button>
            <button type="submit">Convert selected to cart</button>
            <button type="submit" formAction={convertAllToRfqAction}>
              Convert all to RFQ
            </button>
            <button type="submit" formAction={convertSelectedToRfqAction}>
              Convert selected to RFQ
            </button>
          </div>
        </form>
      )}
    </>
  );
}

function UpdateQtyForm({
  listId,
  itemId,
  qty,
}: {
  listId: string;
  itemId: string;
  qty: number;
}): ReactNode {
  return (
    <form action={updateQtyAction} style={{ display: 'inline-flex', gap: '0.25rem' }}>
      <input type="hidden" name="listId" value={listId} />
      <input type="hidden" name="itemId" value={itemId} />
      <input
        type="number"
        name="quantity"
        min={1}
        max={9999}
        defaultValue={qty}
        style={{ width: '4rem' }}
      />
      <button type="submit">Save</button>
    </form>
  );
}

function RemoveItemForm({ listId, itemId }: { listId: string; itemId: string }): ReactNode {
  return (
    <form action={removeAction} style={{ display: 'inline' }}>
      <input type="hidden" name="listId" value={listId} />
      <input type="hidden" name="itemId" value={itemId} />
      <button type="submit">Remove</button>
    </form>
  );
}

async function renameAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  const name = ((formData.get('name') as string) ?? '').trim();
  try {
    await renameShoppingList(session, listId, name);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Rename failed.';
    redirect(`/shopping-lists/${listId}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/shopping-lists/${listId}`);
}

async function updateQtyAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  const itemId = (formData.get('itemId') as string) ?? '';
  const quantity = Number(formData.get('quantity') ?? '1');
  try {
    await updateShoppingListItem(session, listId, itemId, { quantity });
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Update failed.';
    redirect(`/shopping-lists/${listId}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/shopping-lists/${listId}`);
}

async function removeAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  const itemId = (formData.get('itemId') as string) ?? '';
  try {
    await removeShoppingListItem(session, listId, itemId);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Remove failed.';
    redirect(`/shopping-lists/${listId}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/shopping-lists/${listId}`);
}

async function convertAllToCartAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  try {
    const result = await convertShoppingListToCart(session, listId);
    redirect(
      `/shopping-lists/${listId}?cartAdded=${result.added}&cartSkipped=${result.skipped.length}`,
    );
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Convert failed.';
    redirect(`/shopping-lists/${listId}?error=${encodeURIComponent(message)}`);
  }
}

async function convertSelectedToCartAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  const itemIds = (formData.getAll('itemIds') as string[]).filter(Boolean);
  if (itemIds.length === 0) {
    redirect(`/shopping-lists/${listId}?error=Select+at+least+one+item.`);
  }
  try {
    const result = await convertShoppingListToCart(session, listId, itemIds);
    redirect(
      `/shopping-lists/${listId}?cartAdded=${result.added}&cartSkipped=${result.skipped.length}`,
    );
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Convert failed.';
    redirect(`/shopping-lists/${listId}?error=${encodeURIComponent(message)}`);
  }
}

async function convertAllToRfqAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  try {
    const result = await convertShoppingListToRfq(session, listId);
    redirect(
      `/shopping-lists/${listId}?rfqId=${result.rfqId}&rfqAdded=${result.added}&rfqSkipped=${result.skipped.length}`,
    );
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Convert failed.';
    redirect(`/shopping-lists/${listId}?error=${encodeURIComponent(message)}`);
  }
}

async function convertSelectedToRfqAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  const itemIds = (formData.getAll('itemIds') as string[]).filter(Boolean);
  if (itemIds.length === 0) {
    redirect(`/shopping-lists/${listId}?error=Select+at+least+one+item.`);
  }
  try {
    const result = await convertShoppingListToRfq(session, listId, itemIds);
    redirect(
      `/shopping-lists/${listId}?rfqId=${result.rfqId}&rfqAdded=${result.added}&rfqSkipped=${result.skipped.length}`,
    );
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Convert failed.';
    redirect(`/shopping-lists/${listId}?error=${encodeURIComponent(message)}`);
  }
}
