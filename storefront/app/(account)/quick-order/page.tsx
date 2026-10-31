import type { ReactNode } from 'react';
import {
  buildQuickOrder,
  importQuickOrderCsv,
  importQuickOrderFile,
  searchProducts,
  type QuickOrderImportResponse,
  type RejectedQuickOrderItem,
} from '../../../lib/api/quick-order';
import {
  decodeBuildRejections,
  encodeBuildRejections,
  reportMoreText,
  quickOrderBuildOutcome,
  quickOrderBuildRejectionText,
  quickOrderRejectionLabel,
} from '../../../lib/batchReport';
import { tForLocale, type MessageKey } from '../../../lib/i18n/messages';
import { getSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';
import { StorefrontApiError } from '../../../lib/api/client';
import { FileDropzone } from '../../../components/FileDropzone';
import { summarizeQuickOrderPreview } from '../../../lib/quick-order-preview';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../lib/i18n/navigation';
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
 * Quick order (feature 039 / US1). Two-step flow:
 *   1. Paste a CSV with `sku,quantity` headers (plus optional variant
 *      attribute columns) OR drag-drop a CSV / Excel file; the importer
 *      returns recognized + rejected partitions and a summary.
 *   2. The page server-renders the partition; the buyer reviews, then
 *      chooses to build a Cart or a Quote Request from the recognized rows.
 *
 * The preview lives in the URL (base64) on the second step so the page is
 * fully server-rendered; only the dropzone is a small client component.
 */

interface PreviewState {
  recognized: Array<{
    line: number;
    sku: string;
    productId: string;
    variantId: string | null;
    resolvedVariantSku?: string | null;
    quantity: number;
    mergedFromLines?: number[];
  }>;
  rejected: RejectedQuickOrderItem[];
  summary: { recognizedCount: number; rejectedCount: number; mergedCount: number; truncated: boolean };
}

export default async function QuickOrderPage({
  searchParams,
}: {
  searchParams: Promise<{
    preview?: string;
    /** A refusal the backend worded (its `detail`), shown as given. */
    error?: string;
    /** A refusal of this page's own actions, as a code the page words in its language. */
    problem?: string;
    built?: string;
    rfq?: string;
    q?: string;
    /** Feature 155 — how many lines the cart build sent. */
    sent?: string;
    /** Feature 155 — the build's `rejected[]`, carried across the redirect (base64url JSON). */
    notAdded?: string;
  }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/account/quick-order');
  const sp = await searchParams;

  const preview = sp.preview ? decodePreview(sp.preview) : null;
  const searchQuery = sp.q?.trim() ?? '';
  // Issue #174 — the type-ahead is channel-scoped on the backend now, so the
  // page has to say which channel the buyer is shopping. Resolved the same way
  // every other storefront page resolves it.
  const { ctx, locale } = await getServerContext();
  const t = tForLocale(locale);
  const problemKey = quickOrderProblemKey(sp.problem);
  // Feature 155 (FR-011 (b)) — the lines the cart build left out, below a minimum.
  // Carried capped (the first lines plus a count), so the URL stays bounded.
  const notAddedReport = sp.built === 'cart' ? decodeBuildRejections(sp.notAdded) : { lines: [], more: 0 };
  const notAdded = notAddedReport.lines;
  const notAddedCount = notAdded.length + (notAdded.length > 0 ? notAddedReport.more : 0);
  const sentCount = Math.max(Number.parseInt(sp.sent ?? '', 10) || 0, notAddedCount);
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

      {sp.error ? <p className="b2b-auth__error">{sp.error}</p> : null}
      {problemKey ? <p className="b2b-auth__error">{t(problemKey)}</p> : null}
      {sp.built === 'cart' && notAdded.length === 0 ? (
        <p className="b2b-auth__success">
          {t('quickOrder.built.cart')} <LocalizedLink href="/cart">{t('quickOrder.build.openCart')}</LocalizedLink> ·{' '}
          <LocalizedLink href="/checkout">{t('quickOrder.built.goToCheckout')}</LocalizedLink>.
        </p>
      ) : null}
      {notAdded.length > 0 ? (
        // Feature 155 — a partial build is reported as one: what was added, and each line
        // that was not, with the minimum it missed. Checkout is not offered from here — the
        // cart is where the quantities are fixed.
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
            {notAdded.map((line, index) => (
              <li key={index}>{quickOrderBuildRejectionText(line, locale)}</li>
            ))}
            {notAddedReport.more > 0 ? <li>{reportMoreText(notAddedReport.more, locale)}</li> : null}
          </ul>
          {sentCount > notAddedCount ? <LocalizedLink href="/cart">{t('quickOrder.build.openCart')}</LocalizedLink> : null}
        </section>
      ) : null}
      {sp.built === 'quote' ? (
        <p className="b2b-auth__success">
          {t('quickOrder.built.quote')}
          {sp.rfq ? ` (#${sp.rfq})` : ''}.{' '}
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
        {preview ? <input type="hidden" name="preview" value={encodePreview(preview)} /> : null}
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
                      {preview ? (
                        <input type="hidden" name="preview" value={encodePreview(preview)} />
                      ) : null}
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

      {preview ? <PreviewPanel preview={preview} locale={locale} /> : null}

      {/* Feature 044 / US7 — sticky mobile bar: recognised summary + add-all.
          A spacer reserves room so it never covers the rejected-rows table. */}
      {preview && preview.recognized.length > 0 ? (
        <>
          <div className="h-[84px] md:hidden" aria-hidden="true" />
          <form action={confirmAction} className="m-actionbar">
            <input type="hidden" name="preview" value={encodePreview(preview)} />
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

function PreviewPanel({ preview, locale }: { preview: PreviewState; locale: string }): ReactNode {
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
                      <input type="hidden" name="preview" value={encodePreview(preview)} />
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
                      <input type="hidden" name="preview" value={encodePreview(preview)} />
                      <input type="hidden" name="line" value={r.line} />
                      <button type="submit">{t('quickOrder.preview.remove')}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form action={confirmAction}>
            <input type="hidden" name="preview" value={encodePreview(preview)} />
            <div className="b2b-auth__actions">
              <button type="submit" name="target" value="cart">
                {t('quickOrder.preview.addAll')}
              </button>
              <button type="submit" name="target" value="quote_request">
                {t('quickOrder.preview.sendAsQuote')}
              </button>
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
  const previewBlob = (formData.get('preview') as string) ?? '';
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (previewBlob) params.set('preview', previewBlob);
  return await localeRedirect(`/quick-order?${params.toString()}`);
}

async function addSearchResultAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');

  const productId = (formData.get('productId') as string) ?? '';
  const sku = (formData.get('sku') as string) ?? '';
  const q = ((formData.get('q') as string) ?? '').trim();
  const quantity = Math.max(1, Number.parseInt((formData.get('quantity') as string) ?? '1', 10) || 1);

  const preview: PreviewState = decodePreview((formData.get('preview') as string) ?? '') ?? {
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

  const params = new URLSearchParams();
  params.set('preview', encodePreview(preview));
  if (q) params.set('q', q);
  return await localeRedirect(`/quick-order?${params.toString()}`);
}

async function updateQuantityAction(formData: FormData): Promise<void> {
  'use server';
  const preview = decodePreview((formData.get('preview') as string) ?? '');
  const line = Number.parseInt((formData.get('line') as string) ?? '', 10);
  const quantity = Math.max(1, Number.parseInt((formData.get('quantity') as string) ?? '1', 10) || 1);
  if (!preview) return await localeRedirect('/quick-order?problem=nothing_to_update');

  const row = preview!.recognized.find((r) => r.line === line);
  if (row) row.quantity = quantity;
  return await localeRedirect(`/quick-order?preview=${encodePreview(preview!)}`);
}

async function removeRecognizedAction(formData: FormData): Promise<void> {
  'use server';
  const preview = decodePreview((formData.get('preview') as string) ?? '');
  const line = Number.parseInt((formData.get('line') as string) ?? '', 10);
  if (!preview) return await localeRedirect('/quick-order?problem=nothing_to_remove');

  preview!.recognized = preview!.recognized.filter((r) => r.line !== line);
  preview!.summary = { ...preview!.summary, recognizedCount: preview!.recognized.length };
  return await localeRedirect(`/quick-order?preview=${encodePreview(preview!)}`);
}

async function importAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');

  const csv = ((formData.get('csv') as string) ?? '').trim();
  const filename = ((formData.get('quickOrderFilename') as string) ?? '').trim();
  const fileContent = ((formData.get('quickOrderFileContent') as string) ?? '').trim();

  if (!csv && !fileContent) return await localeRedirect('/quick-order?problem=no_input');

  let preview: QuickOrderImportResponse;
  try {
    preview = fileContent
      ? await importQuickOrderFile(session, filename || 'upload.csv', fileContent)
      : await importQuickOrderCsv(session, csv);
  } catch (err) {
    return await localeRedirect(
      err instanceof StorefrontApiError
        ? `/quick-order?error=${encodeURIComponent(err.detail)}`
        : '/quick-order?problem=import_failed',
    );
  }
  return await localeRedirect(`/quick-order?preview=${encodePreview(preview!)}`);
}

async function confirmAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');

  const target = (formData.get('target') as string) === 'quote_request' ? 'quote_request' : 'cart';
  const preview = decodePreview((formData.get('preview') as string) ?? '');
  if (!preview || preview.recognized.length === 0) {
    return await localeRedirect('/quick-order?problem=nothing_to_build');
  }

  let rfqRef: string | undefined;
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
    // Show the customer-facing business ID in the confirmation banner.
    rfqRef = result.quoteRequestBusinessId ?? result.quoteRequestId;
    rejected = result.rejected ?? [];
  } catch (err) {
    return await localeRedirect(
      err instanceof StorefrontApiError
        ? `/quick-order?error=${encodeURIComponent(err.detail)}`
        : '/quick-order?problem=build_failed',
    );
  }
  if (target === 'quote_request') {
    return await localeRedirect(`/quick-order?built=quote${rfqRef ? `&rfq=${encodeURIComponent(rfqRef)}` : ''}`);
  }
  if (rejected.length > 0) {
    // Feature 155 (FR-011 (b)) — the build added the valid lines; the rest travel to the page
    // so it can say which and why.
    const params = new URLSearchParams({
      built: 'cart',
      sent: String(preview!.recognized.length),
      notAdded: encodeBuildRejections(rejected),
    });
    return await localeRedirect(`/quick-order?${params.toString()}`);
  }
  return await localeRedirect('/quick-order?built=cart');
}

/**
 * The page's own refusals travel as a code and are worded here, in the page's language — a
 * sentence carried in the address would be in whatever language the action wrote it in. An
 * unknown code shows nothing: the address is the buyer's to edit.
 */
const PROBLEM_KEYS: Readonly<Record<string, MessageKey>> = {
  no_input: 'quickOrder.problem.no_input',
  nothing_to_update: 'quickOrder.problem.nothing_to_update',
  nothing_to_remove: 'quickOrder.problem.nothing_to_remove',
  nothing_to_build: 'quickOrder.problem.nothing_to_build',
  import_failed: 'quickOrder.problem.import_failed',
  build_failed: 'quickOrder.problem.build_failed',
};

function quickOrderProblemKey(code: string | undefined): MessageKey | null {
  return code && Object.hasOwn(PROBLEM_KEYS, code) ? PROBLEM_KEYS[code]! : null;
}

function encodePreview(preview: PreviewState): string {
  return Buffer.from(JSON.stringify(preview), 'utf8').toString('base64url');
}

function decodePreview(value: string): PreviewState | null {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as PreviewState;
  } catch {
    return null;
  }
}
