import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { addRfqItem } from '../../lib/api/rfq';
import { getSessionCookie } from '../../lib/session';
import { StorefrontApiError } from '../../lib/api/client';

/**
 * "Request a quote" form (T086 / FR-016, FR-018). Lives on the PDP and
 * inside any drawer a theme builds. Adds the current product to the
 * caller's active draft RFQ; on success redirects to
 * `/quote-requests/current` so the buyer sees the running draft.
 *
 * Anonymous shoppers are bounced to /login first because RFQs are tied
 * to a (customer, organization).
 */

export interface AddToRfqFormProps {
  productId: string;
  productSlug: string;
  variantId?: string;
  defaultQuantity?: number;
}

export function AddToRfqForm({
  productId,
  productSlug,
  variantId,
  defaultQuantity = 1,
}: AddToRfqFormProps): ReactNode {
  return (
    <form action={addToRfqAction} className="b2b-rfq-widget">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="productSlug" value={productSlug} />
      {variantId ? <input type="hidden" name="variantId" value={variantId} /> : null}
      <label htmlFor={`rfq-qty-${productId}`} className="b2b-rfq-widget__label">
        Qty
      </label>
      <input
        id={`rfq-qty-${productId}`}
        name="quantity"
        type="number"
        min={1}
        max={9999}
        defaultValue={defaultQuantity}
        style={{ width: '4rem' }}
      />
      <button type="submit">Request a quote</button>
    </form>
  );
}

async function addToRfqAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  const productSlug = (formData.get('productSlug') as string) ?? '';
  if (!session) redirect(`/login?next=/p/${encodeURIComponent(productSlug)}`);

  const productId = (formData.get('productId') as string) ?? '';
  const variantId = (formData.get('variantId') as string | null) || undefined;
  const quantity = Number(formData.get('quantity') ?? '1');
  if (!Number.isFinite(quantity) || quantity < 1) {
    redirect(`/p/${encodeURIComponent(productSlug)}?rfqError=invalid-quantity`);
  }
  try {
    await addRfqItem(session, {
      productId,
      ...(variantId ? { variantId } : {}),
      quantity,
    });
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Could not add to RFQ.';
    redirect(`/p/${encodeURIComponent(productSlug)}?rfqError=${encodeURIComponent(message)}`);
  }
  redirect('/quote-requests/current');
}
