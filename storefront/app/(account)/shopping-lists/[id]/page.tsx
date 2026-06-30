import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  clearShoppingListItems,
  convertShoppingListToCart,
  convertShoppingListToRfq,
  getShoppingList,
  removeShoppingListItem,
  renameShoppingList,
  updateShoppingListItem,
} from '../../../../lib/api/shopping-lists';
import { getSessionCookie } from '../../../../lib/session';
import { StorefrontApiError } from '../../../../lib/api/client';
import { getServerContext } from '../../../../lib/server-context';
import { getProductBySlug } from '../../../../lib/api/catalog';
import { ClearListButton } from '../../../../components/shopping-lists/ClearListButton';

/** Minimal product info shown for a shopping-list row. */
interface ResolvedProduct {
  name: string;
  sku: string;
  slug: string;
}

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

  // Resolve each item's product so the table can show a name + SKU and link to
  // the product card (the item row only carries the product UUID). The detail
  // endpoint accepts an id or a slug; failures (archived / removed) fall back
  // to the raw id so the row still renders.
  const { ctx } = await getServerContext();
  const uniqueProductIds = [...new Set(list.items.map((it) => it.productId))];
  const resolvedEntries = await Promise.all(
    uniqueProductIds.map(async (pid): Promise<[string, ResolvedProduct | null]> => {
      try {
        const product = await getProductBySlug(pid, ctx);
        return [pid, { name: product.name, sku: product.sku, slug: product.slug }];
      } catch {
        return [pid, null];
      }
    }),
  );
  const productsById = new Map<string, ResolvedProduct | null>(resolvedEntries);

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

      <form action={renameAction} className="flex items-end gap-2">
        <input type="hidden" name="listId" value={list.id} />
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="rename" className="text-sm text-fg-soft">
            Rename list
          </label>
          <input
            id="rename"
            name="name"
            defaultValue={list.name}
            required
            maxLength={160}
            className="w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>
        <button type="submit" className="btn btn--outline">
          Rename
        </button>
      </form>

      <h3 className="mt-10 mb-4">Items</h3>
      {list.items.length === 0 ? (
        <p className="muted">
          No items yet. Find a product on the <Link href="/catalog">catalog</Link> and add it from
          its detail page (coming next).
        </p>
      ) : (
        <>
        {/*
          The per-row "Save" / "Remove" controls and the "Convert" buttons each
          need their own form, but a table can't host nested forms (the browser
          drops the inner ones, which is why Remove appeared to do nothing).
          Instead we declare every form once here as a sibling of the table and
          wire the in-cell controls to them via the HTML `form` attribute.
        */}
        <form id="sl-convert" action={convertSelectedToCartAction}>
          <input type="hidden" name="listId" value={list.id} />
        </form>
        {list.items.map((it) => (
          <Fragment key={`forms-${it.id}`}>
            <form id={`sl-qty-${it.id}`} action={updateQtyAction}>
              <input type="hidden" name="listId" value={list.id} />
              <input type="hidden" name="itemId" value={it.id} />
            </form>
            <form id={`sl-remove-${it.id}`} action={removeAction}>
              <input type="hidden" name="listId" value={list.id} />
              <input type="hidden" name="itemId" value={it.id} />
            </form>
          </Fragment>
        ))}
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
                    <input type="checkbox" name="itemIds" value={it.id} form="sl-convert" />
                  </td>
                  <td>
                    {(() => {
                      const product = productsById.get(it.productId);
                      if (!product) {
                        return (
                          <span className="text-fg-soft">
                            {it.productId.slice(0, 8)}
                          </span>
                        );
                      }
                      return (
                        <Link href={`/p/${product.slug}`} className="flex flex-col">
                          <span className="font-medium text-fg">{product.name}</span>
                          <span className="text-xs text-fg-soft">SKU: {product.sku}</span>
                        </Link>
                      );
                    })()}
                    {it.variantId ? (
                      <span className="text-xs text-fg-soft"> · variant {it.variantId.slice(0, 8)}</span>
                    ) : null}
                  </td>
                  <td>
                    <UpdateQtyForm itemId={it.id} qty={it.quantity} />
                  </td>
                  <td>{it.note ?? ''}</td>
                  <td>
                    <RemoveItemForm itemId={it.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-6 mb-10 flex flex-wrap gap-2">
            <button type="submit" form="sl-convert" formAction={convertAllToCartAction} className="btn btn--primary">
              Convert all to cart
            </button>
            <button type="submit" form="sl-convert" className="btn btn--outline">
              Convert selected to cart
            </button>
            <button type="submit" form="sl-convert" formAction={convertAllToRfqAction} className="btn btn--outline">
              Convert all to RFQ
            </button>
            <button type="submit" form="sl-convert" formAction={convertSelectedToRfqAction} className="btn btn--outline">
              Convert selected to RFQ
            </button>
          </div>
        <div className="mb-10 flex flex-wrap gap-2 border-t border-line pt-6">
          <ClearListButton listId={list.id} clearAction={clearListAction} />
        </div>
        </>
      )}
    </>
  );
}

/**
 * Per-row quantity editor. The control lives inside a table cell but is wired
 * to the standalone `sl-qty-<itemId>` form (declared as a table sibling) via
 * the HTML `form` attribute, so it submits independently of the convert form.
 */
function UpdateQtyForm({ itemId, qty }: { itemId: string; qty: number }): ReactNode {
  const formId = `sl-qty-${itemId}`;
  return (
    <span style={{ display: 'inline-flex', gap: '0.25rem' }}>
      <input
        type="number"
        name="quantity"
        form={formId}
        min={1}
        max={9999}
        defaultValue={qty}
        className="rounded-md border border-line px-2 py-1 text-sm"
        style={{ width: '4rem' }}
      />
      <button type="submit" form={formId} className="btn btn--outline btn--sm">
        Save
      </button>
    </span>
  );
}

/** Per-row remove button, wired to the standalone `sl-remove-<itemId>` form. */
function RemoveItemForm({ itemId }: { itemId: string }): ReactNode {
  return (
    <button type="submit" form={`sl-remove-${itemId}`} className="btn btn--outline btn--sm">
      Remove
    </button>
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

async function clearListAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  try {
    await clearShoppingListItems(session, listId);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Clear failed.';
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
