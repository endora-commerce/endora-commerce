import { Fragment, type ReactNode } from 'react';
import { revalidatePath } from 'next/cache';
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
import {
  decodeConversionSkips,
  encodeConversionSkips,
  reportMoreText,
  shoppingListSkipLabel,
} from '../../../../lib/batchReport';
import { tForLocale, type MessageKey } from '../../../../lib/i18n/messages';
import { format } from '../../../../lib/i18n/format';
import { formatCount } from '../../../../lib/orderMinimum';
import { pluralKey, richText } from '../../../../lib/account/labels';
import { LIST_QUANTITY_MAX, parseListQuantity } from '../../../../lib/shoppingListQuantity';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../../lib/i18n/localized-link';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

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
    /** Feature 155 — the conversion's `skipped[]`, carried across the redirect (base64url JSON). */
    cartSkips?: string;
    rfqId?: string;
    rfqAdded?: string;
    rfqSkipped?: string;
    /** U4 — the row whose quantity edit was refused; the page words why beside its input. */
    qtyError?: string;
  }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  const { id } = await params;
  if (!session) return await localeRedirect(`/login?next=/account/shopping-lists/${id}`);
  const sp = await searchParams;
  const { ctx, locale } = await getServerContext();
  const t = tForLocale(locale);
  let list;
  try {
    list = await getShoppingList(session, id);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) {
      return (
        <div>
          <h2>{t('account.shoppingList.notFound.heading')}</h2>
          <p className="b2b-auth__error">{t('account.shoppingList.notFound.body')}</p>
        </div>
      );
    }
    throw err;
  }

  // Resolve each item's product so the table can show a name + SKU and link to
  // the product card (the item row only carries the product UUID). The detail
  // endpoint accepts an id or a slug; failures (archived / removed) fall back
  // to the raw id so the row still renders.
  /** A counted sentence of this page — "Added 3 items to your cart." — in the page's language. */
  const counted = (base: string, raw: string | undefined): string => {
    const count = Number(raw ?? 0);
    return format(t(pluralKey(base, count, locale)), { count: formatCount(count, locale) });
  };
  // Feature 155 (FR-011) — which rows the conversion left out, and why (a minimum included).
  // Carried capped (the first rows plus a count), so the URL stays bounded.
  const cartSkipReport = sp.cartAdded !== undefined ? decodeConversionSkips(sp.cartSkips) : { lines: [], more: 0 };
  const cartSkips = cartSkipReport.lines;
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
        <LocalizedLink href="/shopping-lists">{t('account.shoppingList.backToLists')}</LocalizedLink>
      </p>
      {sp.error ? <p className="b2b-auth__error">{sp.error}</p> : null}
      {sp.cartAdded ? (
        <p className="b2b-auth__success">
          {counted('account.shoppingList.cartAdded', sp.cartAdded)}
          {sp.cartSkipped && Number(sp.cartSkipped) > 0
            ? ` ${counted('account.shoppingList.cartSkipped', sp.cartSkipped)}`
            : ''}
        </p>
      ) : null}
      {cartSkips.length > 0 ? (
        <section
          aria-labelledby="list-cart-skips"
          className="my-[12px] rounded-md border border-warn bg-warn-soft px-[16px] py-[12px] text-fg"
        >
          <h3 id="list-cart-skips" className="m-0 mb-1 text-[14px] font-semibold">
            {t('shoppingList.skip.heading')}
          </h3>
          <ul className="m-0 pl-5 text-[13px]">
            {cartSkips.map((skip) => (
              <li key={skip.itemId}>
                <strong>{productsById.get(skip.productId)?.name ?? t('cart.line.unknownProduct')}</strong>
                {' — '}
                {shoppingListSkipLabel(skip, locale)}
              </li>
            ))}
            {cartSkipReport.more > 0 ? <li>{reportMoreText(cartSkipReport.more, locale)}</li> : null}
          </ul>
        </section>
      ) : null}
      {sp.rfqAdded ? (
        <p className="b2b-auth__success">
          {counted('account.shoppingList.rfqAdded', sp.rfqAdded)}
          {sp.rfqSkipped && Number(sp.rfqSkipped) > 0
            ? ` ${counted('account.shoppingList.rfqSkipped', sp.rfqSkipped)}`
            : ''}{' '}
          <LocalizedLink href={`/quote-requests/${sp.rfqId}`}>{t('account.shoppingList.openRfq')}</LocalizedLink>
        </p>
      ) : null}

      <form action={renameAction} className="flex items-end gap-2">
        <input type="hidden" name="listId" value={list.id} />
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="rename" className="text-sm text-fg-soft">
            {t('account.shoppingList.rename.label')}
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
          {t('account.shoppingList.rename.submit')}
        </button>
      </form>

      <h3 className="mt-10 mb-4">{t('account.common.items')}</h3>
      {list.items.length === 0 ? (
        <p className="muted">
          {richText(t('account.shoppingList.empty'), {
            catalog: <LocalizedLink href="/catalog">{t('account.shoppingList.emptyCatalogLink')}</LocalizedLink>,
          })}
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
            {/* `noValidate`: the browser's own `min` bubble speaks the browser's language. The
                action validates and the row says what is wrong beside the field (U4). */}
            <form id={`sl-qty-${it.id}`} action={updateQtyAction} noValidate>
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
                <th>{t('account.common.product')}</th>
                <th>{t('account.common.quantity')}</th>
                <th>{t('account.shoppingList.col.note')}</th>
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
                        <LocalizedLink href={`/p/${product.slug}`} className="flex flex-col">
                          <span className="font-medium text-fg">{product.name}</span>
                          <span className="text-xs text-fg-soft">{format(t('account.common.sku'), { sku: product.sku })}</span>
                        </LocalizedLink>
                      );
                    })()}
                    {it.variantId ? (
                      <span className="text-xs text-fg-soft">
                        {' · '}
                        {format(t('account.shoppingList.variant'), { id: it.variantId.slice(0, 8) })}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <UpdateQtyForm
                      itemId={it.id}
                      qty={it.quantity}
                      label={t('common.quantity')}
                      saveLabel={t('shoppingList.qty.save')}
                      error={sp.qtyError === it.id ? t('shoppingList.qty.invalid') : null}
                    />
                  </td>
                  <td>{it.note ?? ''}</td>
                  <td>
                    <RemoveItemForm itemId={it.id} label={t('account.common.remove')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-6 mb-10 flex flex-wrap gap-2">
            <button type="submit" form="sl-convert" formAction={convertAllToCartAction} className="btn btn--primary">
              {t('account.shoppingList.toCart.all')}
            </button>
            <button type="submit" form="sl-convert" className="btn btn--outline">
              {t('account.shoppingList.toCart.selected')}
            </button>
            <button type="submit" form="sl-convert" formAction={convertAllToRfqAction} className="btn btn--outline">
              {t('account.shoppingList.toQuote.all')}
            </button>
            <button type="submit" form="sl-convert" formAction={convertSelectedToRfqAction} className="btn btn--outline">
              {t('account.shoppingList.toQuote.selected')}
            </button>
          </div>
        <div className="mb-10 flex flex-wrap gap-2 border-t border-line pt-6">
          <ClearListButton listId={list.id} locale={locale} clearAction={clearListAction} />
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
function UpdateQtyForm({
  itemId,
  qty,
  label,
  saveLabel,
  error,
}: {
  itemId: string;
  qty: number;
  /** The input's accessible name, in the page's language. */
  label: string;
  saveLabel: string;
  /** The refusal of this row's last edit, in the page's language; `null` = none. */
  error: string | null;
}): ReactNode {
  const formId = `sl-qty-${itemId}`;
  const errorId = `sl-qty-error-${itemId}`;
  return (
    <span className="inline-flex flex-col gap-1">
      <span style={{ display: 'inline-flex', gap: '0.25rem' }}>
        <input
          type="number"
          name="quantity"
          form={formId}
          min={1}
          max={LIST_QUANTITY_MAX}
          defaultValue={qty}
          aria-label={label}
          {...(error ? { 'aria-invalid': true, 'aria-describedby': errorId } : {})}
          className="rounded-md border border-line px-2 py-1 text-sm"
          style={{ width: '4rem' }}
        />
        <button type="submit" form={formId} className="btn btn--outline btn--sm">
          {saveLabel}
        </button>
      </span>
      {/* Mounted empty on every row so the polite live region exists before it carries text
          (WCAG 4.1.3), as on the cart line. */}
      <p id={errorId} role="status" className="m-0 text-[12px] font-semibold text-bad">
        {error ?? ''}
      </p>
    </span>
  );
}

/** Per-row remove button, wired to the standalone `sl-remove-<itemId>` form. */
function RemoveItemForm({ itemId, label }: { itemId: string; label: string }): ReactNode {
  return (
    <button type="submit" form={`sl-remove-${itemId}`} className="btn btn--outline btn--sm">
      {label}
    </button>
  );
}

/** A server action's own refusal, in the page's language. */
async function failure(key: MessageKey): Promise<string> {
  const { locale } = await getServerContext();
  return tForLocale(locale)(key);
}

async function renameAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  const name = ((formData.get('name') as string) ?? '').trim();
  try {
    await renameShoppingList(session, listId, name);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.detail : await failure('account.shoppingList.renameFailed');
    return await localeRedirect(`/shopping-lists/${listId}?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect(`/shopping-lists/${listId}`);
}

async function updateQtyAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  const itemId = (formData.get('itemId') as string) ?? '';
  const quantity = parseListQuantity(formData.get('quantity'));
  if (quantity === null) {
    return await localeRedirect(`/shopping-lists/${listId}?qtyError=${encodeURIComponent(itemId)}`);
  }
  try {
    await updateShoppingListItem(session, listId, itemId, { quantity });
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.detail : await failure('account.shoppingList.updateFailed');
    return await localeRedirect(`/shopping-lists/${listId}?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect(`/shopping-lists/${listId}`);
}

async function removeAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  const itemId = (formData.get('itemId') as string) ?? '';
  try {
    await removeShoppingListItem(session, listId, itemId);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.detail : await failure('account.shoppingList.removeFailed');
    return await localeRedirect(`/shopping-lists/${listId}?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect(`/shopping-lists/${listId}`);
}

async function clearListAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  try {
    await clearShoppingListItems(session, listId);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.detail : await failure('account.shoppingList.clearFailed');
    return await localeRedirect(`/shopping-lists/${listId}?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect(`/shopping-lists/${listId}`);
}

async function convertAllToCartAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  // The success redirect must live OUTSIDE the try: Next's `redirect()` signals
  // by throwing `NEXT_REDIRECT`, which a surrounding catch would swallow and
  // mis-report as a failed conversion (the bug this fixes). Only the API call is
  // guarded; the redirect runs after, matching removeAction/clearListAction.
  let result: Awaited<ReturnType<typeof convertShoppingListToCart>>;
  try {
    result = await convertShoppingListToCart(session, listId);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.detail : await failure('account.shoppingList.convertFailed');
    return await localeRedirect(`/shopping-lists/${listId}?error=${encodeURIComponent(message)}`);
  }
  // Flush the cart route's Router Cache so the newly added lines show on the
  // next visit instead of a stale (empty) cached page.
  revalidatePath('/cart');
  return await localeRedirect(cartConversionRedirect(listId, result));
}

async function convertSelectedToCartAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  const itemIds = (formData.getAll('itemIds') as string[]).filter(Boolean);
  if (itemIds.length === 0) {
    const message = await failure('account.shoppingList.selectAtLeastOne');
    return await localeRedirect(`/shopping-lists/${listId}?error=${encodeURIComponent(message)}`);
  }
  let result: Awaited<ReturnType<typeof convertShoppingListToCart>>;
  try {
    result = await convertShoppingListToCart(session, listId, itemIds);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.detail : await failure('account.shoppingList.convertFailed');
    return await localeRedirect(`/shopping-lists/${listId}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath('/cart');
  return await localeRedirect(cartConversionRedirect(listId, result));
}

async function convertAllToRfqAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  let result: Awaited<ReturnType<typeof convertShoppingListToRfq>>;
  try {
    result = await convertShoppingListToRfq(session, listId);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.detail : await failure('account.shoppingList.convertFailed');
    return await localeRedirect(`/shopping-lists/${listId}?error=${encodeURIComponent(message)}`);
  }
  // Without this, Next's Router Cache keeps serving the previously cached
  // (often empty) quote-requests list, so the freshly created RFQ looks like
  // it was never created even though the API persisted it.
  revalidatePath('/quote-requests');
  return await localeRedirect(
    `/shopping-lists/${listId}?rfqId=${result.rfqId}&rfqAdded=${result.added}&rfqSkipped=${result.skipped.length}`,
  );
}

async function convertSelectedToRfqAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  const itemIds = (formData.getAll('itemIds') as string[]).filter(Boolean);
  if (itemIds.length === 0) {
    const message = await failure('account.shoppingList.selectAtLeastOne');
    return await localeRedirect(`/shopping-lists/${listId}?error=${encodeURIComponent(message)}`);
  }
  let result: Awaited<ReturnType<typeof convertShoppingListToRfq>>;
  try {
    result = await convertShoppingListToRfq(session, listId, itemIds);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.detail : await failure('account.shoppingList.convertFailed');
    return await localeRedirect(`/shopping-lists/${listId}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath('/quote-requests');
  return await localeRedirect(
    `/shopping-lists/${listId}?rfqId=${result.rfqId}&rfqAdded=${result.added}&rfqSkipped=${result.skipped.length}`,
  );
}

/**
 * Feature 155 (FR-011) — where a list → cart conversion lands: the counts, and the skipped
 * rows themselves so the page can name each with its reason and minimum.
 */
function cartConversionRedirect(
  listId: string,
  result: { added: number; skipped: ReadonlyArray<unknown> },
): string {
  const params = new URLSearchParams({
    cartAdded: String(result.added),
    cartSkipped: String(result.skipped.length),
  });
  if (result.skipped.length > 0) params.set('cartSkips', encodeConversionSkips(result.skipped));
  return `/shopping-lists/${listId}?${params.toString()}`;
}
