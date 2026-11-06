import type { ReactNode } from 'react';
import {
  buildQuickOrder,
  importQuickOrderCsv,
  importQuickOrderFile,
  searchProducts,
  type QuickOrderImportResponse,
} from '../../../lib/api/quick-order';
import { getRfqById } from '../../../lib/api/rfq';
import {
  cutReportName,
  reportMoreText,
  quickOrderBuildOutcome,
  quickOrderBuildRejectionText,
  quickOrderRejectionLabel,
} from '../../../lib/batchReport';
import { tForLocale } from '../../../lib/i18n/messages';
import { getSessionCookie } from '../../../lib/session';
import { getCommerceAbilitiesAction } from '../../../lib/actions/cart';
import type { CommerceAbilities } from '../../../lib/commerce-permissions';
import { getServerContext } from '../../../lib/server-context';
import { FileDropzone } from '../../../components/FileDropzone';
import { summarizeQuickOrderPreview } from '../../../lib/quick-order-preview';
import {
  clearQuickOrderPreview,
  readQuickOrderPreview,
  writeQuickOrderPreview,
  type QuickOrderPreview as PreviewState,
} from '../../../lib/quick-order-preview-cookie';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { QUICK_ORDER_ERRORS } from '../../../lib/commerce-errors';
import { LocalizedLink, LocalizedAnchor } from '../../../lib/i18n/localized-link';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The paste box's example: the import format itself — the `sku,quantity` header the backend
 * parser reads and two example SKUs — not copy, so it is the same in every language.
 */
const CSV_SAMPLE = ['sku,quantity', 'EXAMPLE-SIMPLE-001,10', 'EXAMPLE-BLUE-002,5'].join('\n');

/**
 * The longest search text the page reads from `?q=` — the type-ahead's own limit
 * (`quickOrderSearchQuerySchema`, 120). Issue #790: the query is the buyer's own input, the one
 * free-text value a URL may carry, and the page shows it only quoted or in the search field.
 */
const QUERY_MAX = 120;

/** A quote request's id — the only shape `?rfqId=` is looked up in. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Quick order (feature 039 / US1). Two-step flow:
 *   1. Paste a CSV with `sku,quantity` headers (plus optional variant
 *      attribute columns) OR drag-drop a CSV / Excel file; the importer
 *      returns recognized + rejected partitions and a summary.
 *   2. The page server-renders the partition; the buyer reviews, then
 *      chooses to build a Cart or a Quote Request from the recognized rows.
 *
 * The preview lives in the storefront's own httpOnly cookie between the steps
 * (`lib/quick-order-preview-cookie.ts`, issue #790 — never in the URL, where a
 * crafted link could put any text on the page), so the page is fully
 * server-rendered; only the dropzone is a small client component.
 *
 * `specs/170-organization-roles/` (owner ruling Q2(b), 2026-11-04): the page is
 * open to a member holding `carts.create` **or** `quote_requests.create`; each
 * target is offered only to the holder of its own code. A member with neither
 * is told why instead of being handed an import that would be refused.
 */

export default async function QuickOrderPage({
  searchParams,
}: {
  searchParams: Promise<{
    /**
     * A refusal — the page's own or the API's — as a code the page words in its language
     * (issue #745: never a sentence; an `?error=` is no longer read at all).
     */
    problem?: string;
    built?: string;
    /** Issue #790 — the quote request a build created; the page reads its reference. */
    rfqId?: string;
    q?: string;
    /** Feature 155 — how many lines the cart build sent. */
    sent?: string;
    /**
     * Feature 155 — how many of them the cart did not take. Issue #790: a count only; the
     * lines themselves are the preview cookie's, each with its reason.
     */
    rejected?: string;
  }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/account/quick-order');
  const sp = await searchParams;
  const abilities = await getCommerceAbilitiesAction();

  const preview = await readQuickOrderPreview(session);
  const searchQuery = (sp.q ?? '').trim().slice(0, QUERY_MAX).trim();
  // Issue #174 — the type-ahead is channel-scoped on the backend now, so the
  // page has to say which channel the buyer is shopping. Resolved the same way
  // every other storefront page resolves it.
  const { ctx, locale } = await getServerContext();
  const t = tForLocale(locale);
  // A code this page does not know shows nothing: the address is the buyer's to edit.
  const problemKey = sp.problem && QUICK_ORDER_ERRORS.isCode(sp.problem) ? QUICK_ORDER_ERRORS.errorKey(sp.problem) : null;
  // Issue #790 — the quote reference is read from the request the id names, never carried; a
  // lookup that fails leaves the confirmation without one.
  const rfqRef =
    sp.built === 'quote' && sp.rfqId && UUID.test(sp.rfqId)
      ? await getRfqById(session, sp.rfqId)
          .then((rfq) => rfq.businessId ?? null)
          .catch(() => null)
      : null;
  // Feature 155 (FR-011 (b)) — the lines the cart build left out, below a minimum. Issue #790:
  // the URL carries the counts; the lines are the preview cookie's, each with why it was left out.
  const sentCount = sp.built === 'cart' ? Math.max(0, Number.parseInt(sp.sent ?? '', 10) || 0) : 0;
  const notAddedCount = Math.min(sentCount, Math.max(0, Number.parseInt(sp.rejected ?? '', 10) || 0));
  const notAdded = notAddedCount > 0 ? (preview?.recognized ?? []).filter((row) => row.notAdded).slice(0, notAddedCount) : [];
  const notAddedMore = notAddedCount - notAdded.length;
  if (!abilities.useQuickOrder) {
    return (
      <>
        <h2>{t('quickOrder.page.heading')}</h2>
        <p className="b2b-auth__hint" role="note">
          {t('commerce.quickOrder.notAllowed')}
        </p>
      </>
    );
  }
  const searchResults = searchQuery
    ? await searchProducts(session, searchQuery, ctx).catch(() => [])
    : [];

  return (
    <>
      <h2>{t('quickOrder.page.heading')}</h2>
      <p className="b2b-auth__hint">
        {t('quickOrder.page.introPrefix')}
        <code>sku,quantity</code>
        {t('quickOrder.page.introSuffix')}{' '}
        <LocalizedAnchor href="/quick-order-template.csv" download>
          {t('quickOrder.page.template')}
        </LocalizedAnchor>
        .
      </p>

      {problemKey ? <p className="b2b-auth__error">{t(problemKey)}</p> : null}
      {sp.built === 'cart' && notAddedCount === 0 ? (
        <p className="b2b-auth__success">
          {t('quickOrder.built.cart')} <LocalizedLink href="/cart">{t('quickOrder.build.openCart')}</LocalizedLink> ·{' '}
          <LocalizedLink href="/checkout">{t('quickOrder.built.goToCheckout')}</LocalizedLink>.
        </p>
      ) : null}
      {notAddedCount > 0 ? (
        // Feature 155 — a partial build is reported as one: what was added, and each line
        // that was not, with the minimum it missed. Checkout is not offered from here — the
        // cart is where the quantities are fixed; the lines left out stay in the preview below,
        // to correct and build again (issue #790).
        <section
          role="status"
          aria-labelledby="quick-order-not-added"
          className="my-[12px] rounded-md border border-warn bg-warn-soft px-[16px] py-[12px] text-fg"
        >
          <p className="m-0 mb-1 font-semibold">{quickOrderBuildOutcome(sentCount, notAddedCount, locale)}</p>
          <h3 id="quick-order-not-added" className="m-0 mb-1 text-[14px] font-semibold">
            {t('quickOrder.build.rejectedHeading')}
          </h3>
          <ul className="m-0 mb-2 pl-5 text-[13px]">
            {notAdded.map((row) => (
              <li key={row.line}>
                {quickOrderBuildRejectionText({ sku: row.sku, quantity: row.quantity, ...row.notAdded! }, locale)}
              </li>
            ))}
            {notAddedMore > 0 ? <li>{reportMoreText(notAddedMore, locale)}</li> : null}
          </ul>
          {sentCount > notAddedCount ? <LocalizedLink href="/cart">{t('quickOrder.build.openCart')}</LocalizedLink> : null}
        </section>
      ) : null}
      {sp.built === 'quote' ? (
        <p className="b2b-auth__success">
          {t('quickOrder.built.quote')}
          {rfqRef ? ` (#${rfqRef})` : ''}.{' '}
          <LocalizedLink href="/quote-requests">{t('quickOrder.built.viewQuotes')}</LocalizedLink>.
        </p>
      ) : null}

      <form action={importAction} className="b2b-auth__form">
        <FileDropzone
          filenameField="quickOrderFilename"
          contentField="quickOrderFileContent"
          locale={locale}
          label={t('quickOrder.page.dropzone')}
        />
      </form>

      <form action={importAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="csv">{t('quickOrder.page.pasteLabel')}</label>
          <textarea
            id="csv"
            name="csv"
            rows={8}
            placeholder={CSV_SAMPLE}
            style={{ fontFamily: 'monospace' }}
          />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">{t('quickOrder.page.preview')}</button>
        </div>
      </form>

      <h3>{t('quickOrder.search.heading')}</h3>
      <p className="b2b-auth__hint">{t('quickOrder.search.hint')}</p>
      <form action={searchAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <input type="search" name="q" defaultValue={searchQuery} placeholder={t('quickOrder.search.placeholder')} />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">{t('common.searchAction')}</button>
        </div>
      </form>

      {searchQuery ? (
        <table className="b2b-account__table">
          <thead>
            <tr>
              <th>{t('quickOrder.col.sku')}</th>
              <th>{t('quickOrder.col.name')}</th>
              <th>{t('quickOrder.col.qty')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {searchResults.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  {t('quickOrder.search.none').replace('{query}', () => searchQuery)}
                </td>
              </tr>
            ) : (
              searchResults.map((r) => (
                <tr key={r.productId}>
                  <td>{r.sku}</td>
                  <td>{r.name}</td>
                  <td>
                    <form action={addSearchResultAction} id={`add-${r.productId}`} noValidate>
                      <input type="hidden" name="q" value={searchQuery} />
                      <input type="hidden" name="productId" value={r.productId} />
                      <input type="hidden" name="sku" value={r.sku} />
                      <input
                        type="number"
                        name="quantity"
                        min={1}
                        defaultValue={1}
                        style={{ width: 64 }}
                        aria-label={t('quickOrder.qtyFor').replace('{sku}', () => r.sku)}
                      />
                    </form>
                  </td>
                  <td>
                    <button type="submit" form={`add-${r.productId}`}>
                      {t('quickOrder.search.add')}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      ) : null}

      {preview ? <PreviewPanel preview={preview} locale={locale} abilities={abilities} /> : null}

      {/* Feature 044 / US7 — sticky mobile bar: recognised summary + add-all.
          A spacer reserves room so it never covers the rejected-rows table. */}
      {preview && preview.recognized.length > 0 && abilities.editCart ? (
        <>
          <div className="h-[84px] md:hidden" aria-hidden="true" />
          <form action={confirmAction} className="m-actionbar">
            <div className="mr-auto flex flex-col leading-tight">
              <span className="text-[11px] text-muted">{t('quickOrder.bar.recognised')}</span>
              <span className="font-mono text-[15px] font-semibold text-fg">
                {summarizeQuickOrderPreview(preview).recognised} ·{' '}
                {summarizeQuickOrderPreview(preview).units} {t('quickOrder.preview.units')}
              </span>
            </div>
            <button
              type="submit"
              name="target"
              value="cart"
              className="btn btn--dark"
              style={{ flex: '0 0 auto', height: 44 }}
            >
              {t('quickOrder.bar.addToCart').replace('{count}', String(preview.recognized.length))}
            </button>
          </form>
        </>
      ) : null}
    </>
  );
}

function PreviewPanel({
  preview,
  locale,
  abilities,
}: {
  preview: PreviewState;
  locale: string;
  abilities: Pick<CommerceAbilities, 'editCart' | 'requestQuote'>;
}): ReactNode {
  const totals = summarizeQuickOrderPreview(preview);
  const t = tForLocale(locale);
  return (
    <>
      <h3>{t('quickOrder.preview.heading')}</h3>
      {/* Feature 044 / US7 — at-a-glance recognised / invalid / units pills. */}
      <div className="mb-3 flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-ok-soft bg-ok-soft px-[10px] py-[4px] text-[12px] font-medium text-ok">
          <strong className="font-mono">{totals.recognised}</strong> {t('quickOrder.preview.recognised')}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-bad-soft bg-bad-soft px-[10px] py-[4px] text-[12px] font-medium text-bad">
          <strong className="font-mono">{totals.invalid}</strong> {t('quickOrder.preview.invalid')}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-alt px-[10px] py-[4px] text-[12px] font-medium text-fg-soft">
          <strong className="font-mono">{totals.units}</strong> {t('quickOrder.preview.units')}
        </span>
      </div>
      {preview.summary.truncated ? (
        <p className="b2b-auth__error">{t('quickOrder.preview.truncated')}</p>
      ) : null}
      {preview.summary.mergedCount > 0 ? (
        <p className="muted">
          {t('quickOrder.preview.merged').replace('{count}', String(preview.summary.mergedCount))}
        </p>
      ) : null}

      {preview.recognized.length > 0 ? (
        <>
          <p className="b2b-auth__success">
            {t('quickOrder.preview.recognisedRows').replace('{count}', String(preview.recognized.length))}
          </p>
          <table className="b2b-account__table">
            <thead>
              <tr>
                <th>{t('quickOrder.col.line')}</th>
                <th>{t('quickOrder.col.sku')}</th>
                <th>{t('quickOrder.col.variant')}</th>
                <th>{t('common.quantity')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {preview.recognized.map((r) => (
                <tr key={r.line}>
                  <td>{r.line}</td>
                  <td>{r.sku}</td>
                  <td>{r.resolvedVariantSku ?? '—'}</td>
                  <td>
                    <form action={updateQuantityAction} id={`qty-${r.line}`} noValidate>
                      <input type="hidden" name="line" value={r.line} />
                      <input
                        type="number"
                        name="quantity"
                        min={1}
                        defaultValue={r.quantity}
                        style={{ width: 72 }}
                        aria-label={t('quickOrder.qtyFor').replace('{sku}', () => r.sku)}
                      />
                      <button type="submit">{t('quickOrder.preview.update')}</button>
                    </form>
                  </td>
                  <td>
                    <form action={removeRecognizedAction}>
                      <input type="hidden" name="line" value={r.line} />
                      <button type="submit">{t('quickOrder.preview.remove')}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form action={confirmAction}>
            <div className="b2b-auth__actions">
              {abilities.editCart ? (
                <button type="submit" name="target" value="cart">
                  {t('quickOrder.preview.addAll')}
                </button>
              ) : null}
              {abilities.requestQuote ? (
                <button type="submit" name="target" value="quote_request">
                  {t('quickOrder.preview.sendAsQuote')}
                </button>
              ) : null}
            </div>
          </form>
        </>
      ) : (
        <p className="muted">{t('quickOrder.preview.noneMatched')}</p>
      )}

      {preview.rejected.length > 0 ? (
        <>
          <h4>{t('quickOrder.preview.rejectedHeading')}</h4>
          <table className="b2b-account__table">
            <thead>
              <tr>
                <th>{t('quickOrder.col.line')}</th>
                <th>{t('quickOrder.col.reason')}</th>
                <th>{t('quickOrder.col.raw')}</th>
              </tr>
            </thead>
            <tbody>
              {preview.rejected.map((r) => (
                <tr key={r.line}>
                  <td>{r.line}</td>
                  <td>{quickOrderRejectionLabel(r, locale)}</td>
                  <td>
                    <code>{r.raw}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </>
  );
}

async function searchAction(formData: FormData): Promise<void> {
  'use server';
  const q = ((formData.get('q') as string) ?? '').trim();
  // The preview stays where it is — in its cookie — so the search carries only the query.
  return await localeRedirect(quickOrderHref(q));
}

/** The page, with the search text the buyer typed when there is one — and nothing else. */
function quickOrderHref(q: string): string {
  return q ? `/quick-order?${new URLSearchParams({ q }).toString()}` : '/quick-order';
}

/**
 * Writes the preview to its cookie and returns to the page (issue #790). A preview over the
 * cookie's budget is not written: an import is told to split the file (`preview_too_large`); an
 * add or an edit, whose preview stays as it was, to build what it has first (`preview_full`).
 */
async function returnWithPreview(
  session: string,
  preview: PreviewState,
  overflow: 'preview_too_large' | 'preview_full',
  q = '',
): Promise<void> {
  if (!(await writeQuickOrderPreview(session, preview))) {
    return await localeRedirect(`/quick-order?problem=${overflow}`);
  }
  return await localeRedirect(quickOrderHref(q));
}

async function addSearchResultAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');

  const productId = (formData.get('productId') as string) ?? '';
  const sku = (formData.get('sku') as string) ?? '';
  const q = ((formData.get('q') as string) ?? '').trim();
  const quantity = Math.max(1, Number.parseInt((formData.get('quantity') as string) ?? '1', 10) || 1);

  const preview: PreviewState = (await readQuickOrderPreview(session)) ?? {
    recognized: [],
    rejected: [],
    summary: { recognizedCount: 0, rejectedCount: 0, mergedCount: 0, truncated: false },
  };

  // If the product is already in the list, bump its quantity; else append.
  const existing = preview.recognized.find((r) => r.productId === productId && !r.variantId);
  if (existing) {
    existing.quantity += quantity;
  } else {
    const nextLine = preview.recognized.reduce((max, r) => Math.max(max, r.line), 0) + 1;
    preview.recognized.push({ line: nextLine, sku, productId, variantId: null, quantity });
  }
  preview.summary = { ...preview.summary, recognizedCount: preview.recognized.length };

  return await returnWithPreview(session, preview, 'preview_full', q);
}

async function updateQuantityAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const preview = await readQuickOrderPreview(session);
  const line = Number.parseInt((formData.get('line') as string) ?? '', 10);
  const quantity = Math.max(1, Number.parseInt((formData.get('quantity') as string) ?? '1', 10) || 1);
  if (!preview) return await localeRedirect('/quick-order?problem=nothing_to_update');

  const row = preview!.recognized.find((r) => r.line === line);
  if (row) {
    row.quantity = quantity;
    // The build's verdict was about the old quantity.
    delete row.notAdded;
  }
  return await returnWithPreview(session, preview!, 'preview_full');
}

async function removeRecognizedAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const preview = await readQuickOrderPreview(session);
  const line = Number.parseInt((formData.get('line') as string) ?? '', 10);
  if (!preview) return await localeRedirect('/quick-order?problem=nothing_to_remove');

  preview!.recognized = preview!.recognized.filter((r) => r.line !== line);
  preview!.summary = { ...preview!.summary, recognizedCount: preview!.recognized.length };
  return await returnWithPreview(session, preview!, 'preview_full');
}

async function importAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');

  const csv = ((formData.get('csv') as string) ?? '').trim();
  const filename = ((formData.get('quickOrderFilename') as string) ?? '').trim();
  const fileContent = ((formData.get('quickOrderFileContent') as string) ?? '').trim();

  // A new import replaces the last preview, whether or not it succeeds: a refusal is never shown
  // beside a preview of a different list.
  await clearQuickOrderPreview();
  if (!csv && !fileContent) return await localeRedirect('/quick-order?problem=no_input');

  let preview: QuickOrderImportResponse;
  try {
    preview = fileContent
      ? await importQuickOrderFile(session, filename || 'upload.csv', fileContent)
      : await importQuickOrderCsv(session, csv);
  } catch (err) {
    return await localeRedirect(`/quick-order?problem=${QUICK_ORDER_ERRORS.failureCode(err, 'import_failed')}`);
  }
  return await returnWithPreview(session, preview!, 'preview_too_large');
}

async function confirmAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');

  const target = (formData.get('target') as string) === 'quote_request' ? 'quote_request' : 'cart';
  const preview = await readQuickOrderPreview(session);
  if (!preview || preview.recognized.length === 0) {
    return await localeRedirect('/quick-order?problem=nothing_to_build');
  }

  let rfqId: string | undefined;
  let rejected: unknown[] = [];
  try {
    const result = await buildQuickOrder(
      session,
      target,
      preview!.recognized.map((r) => ({
        productId: r.productId,
        variantId: r.variantId,
        quantity: r.quantity,
      })),
    );
    rfqId = result.quoteRequestId;
    rejected = result.rejected ?? [];
  } catch (err) {
    return await localeRedirect(`/quick-order?problem=${QUICK_ORDER_ERRORS.failureCode(err, 'build_failed')}`);
  }
  if (target === 'quote_request') {
    // Built: the preview has done its work, so it does not wait in its cookie for the next visit.
    // Issue #790 — the request travels by id; the page reads its reference.
    await clearQuickOrderPreview();
    return await localeRedirect(rfqId ? `/quick-order?built=quote&rfqId=${encodeURIComponent(rfqId)}` : '/quick-order?built=quote');
  }
  const notTaken = linesNotTaken(preview!, rejected);
  if (notTaken.recognized.length === 0) {
    await clearQuickOrderPreview();
    return await localeRedirect('/quick-order?built=cart');
  }
  // Feature 155 (FR-011 (b)) — the build added the valid lines. Issue #790: the URL carries the
  // counts only; the preview keeps exactly the lines the cart did not take, each with why, so the
  // buyer can correct them and build again. Should even that not fit, the counts still report.
  if (!(await writeQuickOrderPreview(session, notTaken))) await clearQuickOrderPreview();
  const params = new URLSearchParams({
    built: 'cart',
    sent: String(preview!.recognized.length),
    rejected: String(Math.min(rejected.length, preview!.recognized.length)),
  });
  return await localeRedirect(`/quick-order?${params.toString()}`);
}

/**
 * The preview of the lines a cart build did not take: each preview row the build's `rejected[]`
 * names (by product and variant), with the kind and minimum it missed and the build's product
 * and unit names, cut to `REPORT_NAME_MAX`. Nothing else is kept —
 * not the lines the cart took, not the rows the import had already refused.
 */
function linesNotTaken(preview: PreviewState, rejected: readonly unknown[]): PreviewState {
  const verdicts = new Map<string, NonNullable<PreviewState['recognized'][number]['notAdded']>>();
  for (const line of rejected) {
    if (typeof line !== 'object' || line === null) continue;
    const { productId, variantId, kind, minimum, productName, packagingUnitName } = line as Record<string, unknown>;
    if (typeof productId !== 'string') continue;
    if (kind !== 'pieces' && kind !== 'packaging_unit') continue;
    if (!Number.isSafeInteger(minimum) || (minimum as number) <= 0) continue;
    verdicts.set(`${productId}:${typeof variantId === 'string' ? variantId : ''}`, {
      kind,
      minimum: minimum as number,
      productName: typeof productName === 'string' ? cutReportName(productName) : '',
      ...(typeof packagingUnitName === 'string' && packagingUnitName !== ''
        ? { packagingUnitName: cutReportName(packagingUnitName) }
        : {}),
    });
  }
  const recognized = preview.recognized.flatMap((row) => {
    const verdict = verdicts.get(`${row.productId}:${row.variantId ?? ''}`);
    return verdict ? [{ ...row, notAdded: verdict }] : [];
  });
  return {
    recognized,
    rejected: [],
    summary: { recognizedCount: recognized.length, rejectedCount: 0, mergedCount: 0, truncated: false },
  };
}
