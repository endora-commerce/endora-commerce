import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { importQuickOrderCsv } from '../../../lib/api/quick-order';
import { addCartItem } from '../../../lib/api/cart';
import { getAnonCartCookie, getSessionCookie, setAnonCartCookie } from '../../../lib/session';
import { StorefrontApiError } from '../../../lib/api/client';

/**
 * Quick order (T205 / FR-031). Two-step flow:
 *   1. Paste CSV with `sku,quantity` headers; the importer returns
 *      recognized + rejected partitions.
 *   2. The page server-renders the partition; the buyer reviews,
 *      then clicks "Add all to cart" which loops the recognized rows
 *      through the cart endpoint.
 *
 * The CSV preview lives in the URL (base64) on the second step so the
 * page is fully server-rendered without client state.
 */

interface PreviewState {
  recognized: Array<{
    line: number;
    sku: string;
    productId: string;
    variantId: string | null;
    quantity: number;
  }>;
  rejected: Array<{ line: number; raw: string; reason: string }>;
}

export default async function QuickOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string; error?: string; cartAdded?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/account/quick-order');
  const sp = await searchParams;

  const preview = sp.preview ? decodePreview(sp.preview) : null;

  return (
    <>
      <h2>Quick order</h2>
      <p className="b2b-auth__hint">
        Paste a CSV with <code>sku,quantity</code> headers. We&apos;ll show you which rows match
        a real product before anything is added to your cart.
      </p>

      {sp.error ? <p className="b2b-auth__error">{sp.error}</p> : null}
      {sp.cartAdded ? (
        <p className="b2b-auth__success">
          Added {sp.cartAdded} item(s) to your cart.{' '}
          <Link href="/cart">Open cart</Link>.
        </p>
      ) : null}

      <form action={importAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="csv">CSV</label>
          <textarea
            id="csv"
            name="csv"
            rows={8}
            required
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
      {preview.recognized.length > 0 ? (
        <>
          <p className="b2b-auth__success">
            {preview.recognized.length} row(s) recognised — ready to add to cart.
          </p>
          <table className="b2b-account__table">
            <thead>
              <tr>
                <th>Line</th>
                <th>SKU</th>
                <th>Quantity</th>
              </tr>
            </thead>
            <tbody>
              {preview.recognized.map((r) => (
                <tr key={r.line}>
                  <td>{r.line}</td>
                  <td>{r.sku}</td>
                  <td>{r.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <form action={confirmAction}>
            <input type="hidden" name="preview" value={encodePreview(preview)} />
            <div className="b2b-auth__actions">
              <button type="submit">Add all to cart</button>
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
  if (!csv) redirect('/quick-order?error=CSV+is+empty.');
  let preview: PreviewState;
  try {
    preview = await importQuickOrderCsv(session, csv);
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
  const previewBlob = (formData.get('preview') as string) ?? '';
  const preview = decodePreview(previewBlob);
  if (!preview || preview.recognized.length === 0) {
    redirect('/quick-order?error=Nothing+to+add.');
  }
  let added = 0;
  try {
    const anon = await getAnonCartCookie();
    for (const row of preview!.recognized) {
      const result = await addCartItem(
        { session, ...(anon ? { anon } : {}) },
        {
          productId: row.productId,
          ...(row.variantId ? { variantId: row.variantId } : {}),
          quantity: row.quantity,
        },
      );
      if (result.newAnonCookie) await setAnonCartCookie(result.newAnonCookie);
      added += 1;
    }
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Add to cart failed.';
    redirect(`/quick-order?error=${encodeURIComponent(message)}`);
  }
  redirect(`/quick-order?cartAdded=${added}`);
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
