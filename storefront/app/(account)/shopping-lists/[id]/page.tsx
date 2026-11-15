import type { ReactNode } from 'react';
import { revalidatePath } from 'next/cache';
import {
  clearShoppingListItems,
  convertShoppingListToCart,
  convertShoppingListToRfq,
  getShoppingList,
  removeShoppingListItem,
  updateShoppingList,
} from '../../../../lib/api/shopping-lists';
import { getSessionCookie } from '../../../../lib/session';
import { getCommerceAbilitiesAction } from '../../../../lib/actions/cart';
import { StorefrontApiError } from '../../../../lib/api/client';
import { isRecordId } from '../../../../lib/record-id';
import { getServerContext } from '../../../../lib/server-context';
import { getProductBySlug } from '../../../../lib/api/catalog';
import { ClearListButton } from '../../../../components/shopping-lists/ClearListButton';
import {
  type CarriedConversionSkip,
  type CarriedReport,
  decodeConversionSkips,
  encodeConversionSkips,
  reportMoreText,
  shoppingListSkipLabel,
} from '../../../../lib/batchReport';
import { tForLocale } from '../../../../lib/i18n/messages';
import { shoppingListDisplayName } from '../../../../lib/shopping-list-name';
import { format } from '../../../../lib/i18n/format';
import { formatCount } from '../../../../lib/orderMinimum';
import { pluralKey, richText } from '../../../../lib/account/labels';
import { readShoppingListEdits } from '../../../../lib/account/shopping-list-edits';
import { ShoppingListEditor } from '../../../../components/shopping-lists/ShoppingListEditor';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { SHOPPING_LIST_ERRORS } from '../../../../lib/account/shopping-list-errors';
import { rfqConversionRedirect } from '../../../../lib/account/shopping-list-conversion';
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
 * Shopping list detail (T205). The list's name and every line quantity are
 * edited in one form with one *Save changes* (issue #1251); "Convert all to
 * cart" / "Convert all to RFQ" run the bulk conversion, and per-item
 * checkboxes feed an `itemIds` array to the "Convert selected" variants. The
 * conversions submit the same form, so what the buyer typed is saved first
 * and converted as typed. Archived skips are surfaced via a banner after
 * conversion.
 *
 * `specs/170-organization-roles/` (FR-047, FR-048): renaming and editing the
 * list need `shopping_lists.create`; each conversion needs
 * `shopping_lists.convert` plus its target's create code. What the member's
 * role does not allow is not offered, and a read-only list says so.
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
    /** Issue #1161 — the quote-request conversion's `skipped[]`, carried as `cartSkips` is. */
    rfqSkips?: string;
    /** U4 — the row whose quantity edit was refused; the page words why beside its input. */
    qtyError?: string;
    /** Issue #1251 — `saved` after *Save changes* wrote something. */
    status?: string;
  }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  const { id } = await params;
  if (!session) return await localeRedirect(`/login?next=/account/shopping-lists/${id}`);
  const sp = await searchParams;
  const { ctx, locale } = await getServerContext();
  const t = tForLocale(locale);
  const abilities = await getCommerceAbilitiesAction();
  const canEdit = abilities.editShoppingLists;
  const notFound = (
    <div>
      <h2>{t('account.shoppingList.notFound.heading')}</h2>
      <p className="b2b-auth__error">{t('account.shoppingList.notFound.body')}</p>
    </div>
  );
  // Issue #749 — an id that cannot name a list is not asked for: the API answers it 500.
  if (!isRecordId(id)) return notFound;

  let list;
  try {
    list = await getShoppingList(session, id);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) return notFound;
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
  // Issue #1161 — the quote-request conversion names its skipped rows the same way, each with its reason.
  const rfqSkipReport = sp.rfqAdded !== undefined ? decodeConversionSkips(sp.rfqSkips) : { lines: [], more: 0 };
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
      <h2>{shoppingListDisplayName(list, t)}</h2>
      <p>
        <LocalizedLink href="/shopping-lists" className="b2b-account__link b2b-account__link--standalone">{t('account.shoppingList.backToLists')}</LocalizedLink>
      </p>
      {/* Issue #745 — `?error=` is a code; one this page does not know reads as its generic failure. */}
      {sp.error ? <p className="b2b-auth__error">{t(SHOPPING_LIST_ERRORS.errorKey(sp.error)!)}</p> : null}
      {sp.cartAdded ? (
        <p className="b2b-auth__success">
          {counted('account.shoppingList.cartAdded', sp.cartAdded)}
          {sp.cartSkipped && Number(sp.cartSkipped) > 0
            ? ` ${counted('account.shoppingList.cartSkipped', sp.cartSkipped)}`
            : ''}
        </p>
      ) : null}
      <ConversionSkipReport
        id="list-cart-skips"
        heading={t('shoppingList.skip.heading')}
        report={cartSkipReport}
        productName={(productId) => productsById.get(productId)?.name ?? t('cart.line.unknownProduct')}
        locale={locale}
      />
      {sp.rfqAdded !== undefined && Number(sp.rfqAdded) > 0 ? (
        <p className="b2b-auth__success">
          {counted('account.shoppingList.rfqAdded', sp.rfqAdded)}
          {sp.rfqSkipped && Number(sp.rfqSkipped) > 0
            ? ` ${counted('account.shoppingList.rfqSkipped', sp.rfqSkipped)}`
            : ''}
          {/* Issue #1159 — a link only to a quote request that exists and received something. */}
          {sp.rfqId ? (
            <>
              {' '}
              <LocalizedLink href={`/quote-requests/${sp.rfqId}`} className="b2b-account__link">{t('account.shoppingList.openRfq')}</LocalizedLink>
            </>
          ) : null}
        </p>
      ) : sp.rfqAdded !== undefined ? (
        // Issue #1159 — nothing converted, so no quote request was created: said neutrally, not as a success.
        <p className="b2b-auth__hint" role="status">
          {t('account.shoppingList.rfqNothingAdded')}
          {sp.rfqSkipped && Number(sp.rfqSkipped) > 0
            ? ` ${counted('account.shoppingList.rfqSkipped', sp.rfqSkipped)}`
            : ''}
        </p>
      ) : null}
      <ConversionSkipReport
        id="list-rfq-skips"
        heading={t('shoppingList.skip.rfqHeading')}
        report={rfqSkipReport}
        productName={(productId) => productsById.get(productId)?.name ?? t('cart.line.unknownProduct')}
        locale={locale}
      />

      {!canEdit ? (
        <p className="b2b-auth__hint" role="note">
          {t('commerce.shoppingLists.readOnlyNote')}
        </p>
      ) : null}

      {sp.status === 'saved' ? (
        <p className="b2b-auth__success" role="status">
          {t('account.shoppingList.saved')}
        </p>
      ) : null}

      {/* Keyed by what the list holds, so a save, a removal or a clear starts the form afresh. */}
      <ShoppingListEditor
        key={`${list.name}|${list.items.map((it) => `${it.id}:${it.quantity}`).join(',')}`}
        listId={list.id}
        locale={locale}
        name={shoppingListDisplayName(list, t)}
        canEdit={canEdit}
        canConvertToCart={abilities.convertListToCart}
        canConvertToQuote={abilities.convertListToQuote}
        qtyErrorItemId={sp.qtyError ?? null}
        nameError={sp.error === 'NAME_REQUIRED'}
        heading={<h3 className="mt-10 mb-4">{t('account.common.items')}</h3>}
        empty={
          <p className="muted">
            {richText(t('account.shoppingList.empty'), {
              catalog: <LocalizedLink href="/catalog" className="b2b-account__link">{t('account.shoppingList.emptyCatalogLink')}</LocalizedLink>,
            })}
          </p>
        }
        rows={list.items.map((it) => ({
          id: it.id,
          quantity: it.quantity,
          note: it.note ?? null,
          product: <ProductCell product={productsById.get(it.productId) ?? null} productId={it.productId} variantId={it.variantId} t={t} />,
        }))}
        saveListAction={saveListAction}
        removeAction={removeAction}
        convertAllToCartAction={convertAllToCartAction}
        convertSelectedToCartAction={convertSelectedToCartAction}
        convertAllToRfqAction={convertAllToRfqAction}
        convertSelectedToRfqAction={convertSelectedToRfqAction}
      />
      {canEdit && list.items.length > 0 ? (
        <div className="mb-10 flex flex-wrap gap-2 border-t border-line pt-6">
          <ClearListButton listId={list.id} locale={locale} clearAction={clearListAction} />
        </div>
      ) : null}
    </>
  );
}

/** A line's product: its name and SKU linking to its page, or the id of one that no longer resolves. */
function ProductCell({
  product,
  productId,
  variantId,
  t,
}: {
  product: ResolvedProduct | null;
  productId: string;
  variantId: string | null;
  t: ReturnType<typeof tForLocale>;
}): ReactNode {
  return (
    <>
      {product ? (
        <LocalizedLink href={`/p/${product.slug}`} className="b2b-account__link b2b-account__link--stacked">
          <span className="font-medium">{product.name}</span>
          <span className="text-xs text-fg-soft">{format(t('account.common.sku'), { sku: product.sku })}</span>
        </LocalizedLink>
      ) : (
        <span className="text-fg-soft">{productId.slice(0, 8)}</span>
      )}
      {variantId ? (
        <span className="text-xs text-fg-soft">
          {' · '}
          {format(t('account.shoppingList.variant'), { id: variantId.slice(0, 8) })}
        </span>
      ) : null}
    </>
  );
}

/**
 * Feature 155 (FR-011) / issue #1161 — the rows a conversion left out, each with its product and
 * the reason it was skipped, below the conversion's counted sentence. Renders nothing for an
 * empty report, which is also what a hand-made or malformed carried value decodes to.
 */
function ConversionSkipReport({
  id,
  heading,
  report,
  productName,
  locale,
}: {
  id: string;
  /** The section's heading, in the page's language. */
  heading: string;
  report: CarriedReport<CarriedConversionSkip>;
  productName: (productId: string) => string;
  locale: string;
}): ReactNode {
  if (report.lines.length === 0) return null;
  return (
    <section
      aria-labelledby={id}
      className="b2b-auth__warning my-[12px] rounded-md px-[16px] py-[12px] text-[14px]"
    >
      <h3 id={id} className="m-0 mb-1 text-[14px] font-semibold">
        {heading}
      </h3>
      <ul className="m-0 pl-5 text-[13px]">
        {report.lines.map((skip) => (
          <li key={skip.itemId}>
            <strong>{productName(skip.productId)}</strong>
            {' — '}
            {shoppingListSkipLabel(skip, locale)}
          </li>
        ))}
        {report.more > 0 ? <li>{reportMoreText(report.more, locale)}</li> : null}
      </ul>
    </section>
  );
}

/**
 * Issue #1251 — writes what the buyer changed on the list form, the name and the edited
 * quantities together, in one request. `{ saved }` says whether anything was written;
 * `{ refusal }` is where to send the buyer instead: the refused field, or the refusal's
 * code. Every conversion runs it first, so a conversion converts the quantities the buyer
 * typed, and does not run when the save is refused.
 */
async function saveTypedEdits(session: string, listId: string, formData: FormData): Promise<{ refusal: string } | { saved: boolean }> {
  const reading = readShoppingListEdits(formData);
  if (reading.kind === 'nameRequired') return { refusal: `/shopping-lists/${listId}?error=NAME_REQUIRED` };
  if (reading.kind === 'invalidQuantity') {
    return { refusal: `/shopping-lists/${listId}?qtyError=${encodeURIComponent(reading.itemId)}` };
  }
  if (reading.edits === null) return { saved: false };
  try {
    await updateShoppingList(session, listId, reading.edits);
  } catch (err) {
    return { refusal: `/shopping-lists/${listId}?error=${SHOPPING_LIST_ERRORS.failureCode(err, 'SAVE_FAILED')}` };
  }
  return { saved: true };
}

async function saveListAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  const outcome = await saveTypedEdits(session, listId, formData);
  if ('refusal' in outcome) return await localeRedirect(outcome.refusal);
  return await localeRedirect(outcome.saved ? `/shopping-lists/${listId}?status=saved` : `/shopping-lists/${listId}`);
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
    return await localeRedirect(`/shopping-lists/${listId}?error=${SHOPPING_LIST_ERRORS.failureCode(err, 'REMOVE_FAILED')}`);
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
    return await localeRedirect(`/shopping-lists/${listId}?error=${SHOPPING_LIST_ERRORS.failureCode(err, 'CLEAR_FAILED')}`);
  }
  return await localeRedirect(`/shopping-lists/${listId}`);
}

async function convertAllToCartAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  // Issue #1251 — what the buyer typed is saved first, so the conversion converts it.
  const saved = await saveTypedEdits(session, listId, formData);
  if ('refusal' in saved) return await localeRedirect(saved.refusal);
  // The success redirect must live OUTSIDE the try: Next's `redirect()` signals
  // by throwing `NEXT_REDIRECT`, which a surrounding catch would swallow and
  // mis-report as a failed conversion (the bug this fixes). Only the API call is
  // guarded; the redirect runs after, matching removeAction/clearListAction.
  let result: Awaited<ReturnType<typeof convertShoppingListToCart>>;
  try {
    result = await convertShoppingListToCart(session, listId);
  } catch (err) {
    return await localeRedirect(`/shopping-lists/${listId}?error=${SHOPPING_LIST_ERRORS.failureCode(err, 'CONVERT_FAILED')}`);
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
    return await localeRedirect(`/shopping-lists/${listId}?error=SELECT_AT_LEAST_ONE`);
  }
  // Issue #1251 — what the buyer typed is saved first, so the conversion converts it.
  const saved = await saveTypedEdits(session, listId, formData);
  if ('refusal' in saved) return await localeRedirect(saved.refusal);
  let result: Awaited<ReturnType<typeof convertShoppingListToCart>>;
  try {
    result = await convertShoppingListToCart(session, listId, itemIds);
  } catch (err) {
    return await localeRedirect(`/shopping-lists/${listId}?error=${SHOPPING_LIST_ERRORS.failureCode(err, 'CONVERT_FAILED')}`);
  }
  revalidatePath('/cart');
  return await localeRedirect(cartConversionRedirect(listId, result));
}

async function convertAllToRfqAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  // Issue #1251 — what the buyer typed is saved first, so the conversion converts it.
  const saved = await saveTypedEdits(session, listId, formData);
  if ('refusal' in saved) return await localeRedirect(saved.refusal);
  let result: Awaited<ReturnType<typeof convertShoppingListToRfq>>;
  try {
    result = await convertShoppingListToRfq(session, listId);
  } catch (err) {
    return await localeRedirect(`/shopping-lists/${listId}?error=${SHOPPING_LIST_ERRORS.failureCode(err, 'CONVERT_FAILED')}`);
  }
  // Without this, Next's Router Cache keeps serving the previously cached
  // (often empty) quote-requests list, so the freshly created RFQ looks like
  // it was never created even though the API persisted it.
  revalidatePath('/quote-requests');
  return await localeRedirect(rfqConversionRedirect(listId, result));
}

async function convertSelectedToRfqAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const listId = (formData.get('listId') as string) ?? '';
  const itemIds = (formData.getAll('itemIds') as string[]).filter(Boolean);
  if (itemIds.length === 0) {
    return await localeRedirect(`/shopping-lists/${listId}?error=SELECT_AT_LEAST_ONE`);
  }
  // Issue #1251 — what the buyer typed is saved first, so the conversion converts it.
  const saved = await saveTypedEdits(session, listId, formData);
  if ('refusal' in saved) return await localeRedirect(saved.refusal);
  let result: Awaited<ReturnType<typeof convertShoppingListToRfq>>;
  try {
    result = await convertShoppingListToRfq(session, listId, itemIds);
  } catch (err) {
    return await localeRedirect(`/shopping-lists/${listId}?error=${SHOPPING_LIST_ERRORS.failureCode(err, 'CONVERT_FAILED')}`);
  }
  revalidatePath('/quote-requests');
  return await localeRedirect(rfqConversionRedirect(listId, result));
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
