import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  buildQuickOrder,
  importQuickOrderCsv,
  importQuickOrderFile,
  type QuickOrderImportResponse,
} from '../../../lib/api/quick-order';
import { getSessionCookie } from '../../../lib/session';
import { StorefrontApiError } from '../../../lib/api/client';
import { FileDropzone } from '../../../components/FileDropzone';

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
  }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/account/quick-order');
  const sp = await searchParams;

  const preview = sp.preview ? decodePreview(sp.preview) : null;

  return (
    <>
      <h2>Quick order</h2>
      <p className="b2b-auth__hint">
        Paste a CSV with <code>sku,quantity</code> headers (extra columns set variant attributes),
        or drag-drop a CSV / Excel file. We&apos;ll show you which rows match a real product before
        anything is added.
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
          <Link href="/account/quote-requests">View quote requests</Link>.
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

      {preview ? <PreviewPanel preview={preview} /> : null}
    </>
  );
}

function PreviewPanel({ preview }: { preview: PreviewState }): ReactNode {
  return (
    <>
      <h3>Preview</h3>
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
              </tr>
            </thead>
            <tbody>
              {preview.recognized.map((r) => (
                <tr key={r.line}>
                  <td>{r.line}</td>
                  <td>{r.sku}</td>
                  <td>{r.resolvedVariantSku ?? '—'}</td>
                  <td>{r.quantity}</td>
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

  let rfqId: string | undefined;
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
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Build failed.';
    redirect(`/quick-order?error=${encodeURIComponent(message)}`);
  }
  if (target === 'quote_request') {
    redirect(`/quick-order?built=quote${rfqId ? `&rfq=${encodeURIComponent(rfqId)}` : ''}`);
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
