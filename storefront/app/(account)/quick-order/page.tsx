import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  buildQuickOrder,
  importQuickOrderCsv,
  importQuickOrderFile,
  searchProducts,
  type QuickOrderImportResponse,
} from '../../../lib/api/quick-order';
import { getSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';
import { StorefrontApiError } from '../../../lib/api/client';
import { FileDropzone } from '../../../components/FileDropzone';
import { summarizeQuickOrderPreview } from '../../../lib/quick-order-preview';

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
  rejected: Array<{ line: number; raw: string; reason: string }>;
  summary: { recognizedCount: number; rejectedCount: number; mergedCount: number; truncated: boolean };
}

export default async function QuickOrderPage({
  searchParams,
}: {
  searchParams: Promise<{
    preview?: string;
    error?: string;
    built?: string;
    rfq?: string;
    q?: string;
  }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/account/quick-order');
  const sp = await searchParams;

  const preview = sp.preview ? decodePreview(sp.preview) : null;
  const searchQuery = sp.q?.trim() ?? '';
  // Issue #174 — the type-ahead is channel-scoped on the backend now, so the
  // page has to say which channel the buyer is shopping. Resolved the same way
  // every other storefront page resolves it.
  const { ctx } = await getServerContext();
  const searchResults = searchQuery
    ? await searchProducts(session, searchQuery, ctx).catch(() => [])
    : [];

  return (
    <>
      <h2>Quick order</h2>
      <p className="b2b-auth__hint">
        Paste a CSV with <code>sku,quantity</code> headers (extra columns set variant attributes),
        or drag-drop a CSV / Excel file. We&apos;ll show you which rows match a real product before
        anything is added.{' '}
        <a href="/quick-order-template.csv" download>
          Download CSV template
        </a>
        .
      </p>

      {sp.error ? <p className="b2b-auth__error">{sp.error}</p> : null}
      {sp.built === 'cart' ? (
        <p className="b2b-auth__success">
          Cart built from your import. <Link href="/cart">Open cart</Link> ·{' '}
          <Link href="/checkout">Go to checkout</Link>.
        </p>
      ) : null}
      {sp.built === 'quote' ? (
        <p className="b2b-auth__success">
          Quote request created{sp.rfq ? ` (#${sp.rfq})` : ''}.{' '}
          <Link href="/quote-requests">View quote requests</Link>.
        </p>
      ) : null}

      <form action={importAction} className="b2b-auth__form">
        <FileDropzone filenameField="quickOrderFilename" contentField="quickOrderFileContent" />
      </form>

      <form action={importAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="csv">…or paste CSV</label>
          <textarea
            id="csv"
            name="csv"
            rows={8}
            placeholder={'sku,quantity\nEXAMPLE-SIMPLE-001,10\nEXAMPLE-BLUE-002,5'}
            style={{ fontFamily: 'monospace' }}
          />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">Preview</button>
        </div>
      </form>

      <h3>Find products</h3>
      <p className="b2b-auth__hint">
        Search by SKU, name, or a quick-searchable attribute and add items to your order.
      </p>
      <form action={searchAction} className="b2b-auth__form">
        {preview ? <input type="hidden" name="preview" value={encodePreview(preview)} /> : null}
        <div className="b2b-auth__field">
          <input type="search" name="q" defaultValue={searchQuery} placeholder="Search products…" />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">Search</button>
        </div>
      </form>

      {searchQuery ? (
        <table className="b2b-account__table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Qty</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {searchResults.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No products matched &quot;{searchQuery}&quot;.
                </td>
              </tr>
            ) : (
              searchResults.map((r) => (
                <tr key={r.productId}>
                  <td>{r.sku}</td>
                  <td>{r.name}</td>
                  <td>
                    <form action={addSearchResultAction} id={`add-${r.productId}`}>
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
                      />
                    </form>
                  </td>
                  <td>
                    <button type="submit" form={`add-${r.productId}`}>
                      Add
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      ) : null}

      {preview ? <PreviewPanel preview={preview} /> : null}

      {/* Feature 044 / US7 — sticky mobile bar: recognised summary + add-all.
          A spacer reserves room so it never covers the rejected-rows table. */}
      {preview && preview.recognized.length > 0 ? (
        <>
          <div className="h-[84px] md:hidden" aria-hidden="true" />
          <form action={confirmAction} className="m-actionbar">
            <input type="hidden" name="preview" value={encodePreview(preview)} />
            <div className="mr-auto flex flex-col leading-tight">
              <span className="text-[11px] text-muted">Recognised</span>
              <span className="font-mono text-[15px] font-semibold text-fg">
                {summarizeQuickOrderPreview(preview).recognised} ·{' '}
                {summarizeQuickOrderPreview(preview).units} units
              </span>
            </div>
            <button
              type="submit"
              name="target"
              value="cart"
              className="btn btn--dark"
              style={{ flex: '0 0 auto', height: 44 }}
            >
              Add {preview.recognized.length} to cart
            </button>
          </form>
        </>
      ) : null}
    </>
  );
}

function PreviewPanel({ preview }: { preview: PreviewState }): ReactNode {
  const totals = summarizeQuickOrderPreview(preview);
  return (
    <>
      <h3>Preview</h3>
      {/* Feature 044 / US7 — at-a-glance recognised / invalid / units pills. */}
      <div className="mb-3 flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-ok-soft bg-ok-soft px-[10px] py-[4px] text-[12px] font-medium text-ok">
          <strong className="font-mono">{totals.recognised}</strong> recognised
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-bad-soft bg-bad-soft px-[10px] py-[4px] text-[12px] font-medium text-bad">
          <strong className="font-mono">{totals.invalid}</strong> invalid
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-alt px-[10px] py-[4px] text-[12px] font-medium text-fg-soft">
          <strong className="font-mono">{totals.units}</strong> units
        </span>
      </div>
      {preview.summary.truncated ? (
        <p className="b2b-auth__error">
          The file exceeded the import row limit — extra rows were rejected.
        </p>
      ) : null}
      {preview.summary.mergedCount > 0 ? (
        <p className="muted">{preview.summary.mergedCount} duplicate row(s) merged (quantities summed).</p>
      ) : null}

      {preview.recognized.length > 0 ? (
        <>
          <p className="b2b-auth__success">
            {preview.recognized.length} row(s) recognised — choose how to proceed.
          </p>
          <table className="b2b-account__table">
            <thead>
              <tr>
                <th>Line</th>
                <th>SKU</th>
                <th>Variant</th>
                <th>Quantity</th>
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
                    <form action={updateQuantityAction} id={`qty-${r.line}`}>
                      <input type="hidden" name="preview" value={encodePreview(preview)} />
                      <input type="hidden" name="line" value={r.line} />
                      <input
                        type="number"
                        name="quantity"
                        min={1}
                        defaultValue={r.quantity}
                        style={{ width: 72 }}
                        aria-label={`Quantity for ${r.sku}`}
                      />
                      <button type="submit">
                        Update
                      </button>
                    </form>
                  </td>
                  <td>
                    <form action={removeRecognizedAction}>
                      <input type="hidden" name="preview" value={encodePreview(preview)} />
                      <input type="hidden" name="line" value={r.line} />
                      <button type="submit">
                        Remove
                      </button>
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
                Add all to cart
              </button>
              <button type="submit" name="target" value="quote_request">
                Send as quote request
              </button>
            </div>
          </form>
        </>
      ) : (
        <p className="muted">No rows matched the catalog.</p>
      )}

      {preview.rejected.length > 0 ? (
        <>
          <h4>Rejected rows</h4>
          <table className="b2b-account__table">
            <thead>
              <tr>
                <th>Line</th>
                <th>Reason</th>
                <th>Raw</th>
              </tr>
            </thead>
            <tbody>
              {preview.rejected.map((r) => (
                <tr key={r.line}>
                  <td>{r.line}</td>
                  <td>{r.reason}</td>
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
  redirect(`/quick-order?${params.toString()}`);
}

async function addSearchResultAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');

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
  redirect(`/quick-order?${params.toString()}`);
}

async function updateQuantityAction(formData: FormData): Promise<void> {
  'use server';
  const preview = decodePreview((formData.get('preview') as string) ?? '');
  const line = Number.parseInt((formData.get('line') as string) ?? '', 10);
  const quantity = Math.max(1, Number.parseInt((formData.get('quantity') as string) ?? '1', 10) || 1);
  if (!preview) redirect('/quick-order?error=Nothing+to+update.');

  const row = preview!.recognized.find((r) => r.line === line);
  if (row) row.quantity = quantity;
  redirect(`/quick-order?preview=${encodePreview(preview!)}`);
}

async function removeRecognizedAction(formData: FormData): Promise<void> {
  'use server';
  const preview = decodePreview((formData.get('preview') as string) ?? '');
  const line = Number.parseInt((formData.get('line') as string) ?? '', 10);
  if (!preview) redirect('/quick-order?error=Nothing+to+remove.');

  preview!.recognized = preview!.recognized.filter((r) => r.line !== line);
  preview!.summary = { ...preview!.summary, recognizedCount: preview!.recognized.length };
  redirect(`/quick-order?preview=${encodePreview(preview!)}`);
}

async function importAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');

  const csv = ((formData.get('csv') as string) ?? '').trim();
  const filename = ((formData.get('quickOrderFilename') as string) ?? '').trim();
  const fileContent = ((formData.get('quickOrderFileContent') as string) ?? '').trim();

  if (!csv && !fileContent) redirect('/quick-order?error=Provide+a+file+or+paste+CSV.');

  let preview: QuickOrderImportResponse;
  try {
    preview = fileContent
      ? await importQuickOrderFile(session, filename || 'upload.csv', fileContent)
      : await importQuickOrderCsv(session, csv);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Import failed.';
    redirect(`/quick-order?error=${encodeURIComponent(message)}`);
  }
  redirect(`/quick-order?preview=${encodePreview(preview!)}`);
}

async function confirmAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');

  const target = (formData.get('target') as string) === 'quote_request' ? 'quote_request' : 'cart';
  const preview = decodePreview((formData.get('preview') as string) ?? '');
  if (!preview || preview.recognized.length === 0) {
    redirect('/quick-order?error=Nothing+to+build.');
  }

  let rfqRef: string | undefined;
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
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Build failed.';
    redirect(`/quick-order?error=${encodeURIComponent(message)}`);
  }
  if (target === 'quote_request') {
    redirect(`/quick-order?built=quote${rfqRef ? `&rfq=${encodeURIComponent(rfqRef)}` : ''}`);
  }
  redirect('/quick-order?built=cart');
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
