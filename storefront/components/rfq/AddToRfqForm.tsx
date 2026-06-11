import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { createRfq } from '../../lib/api/rfq';
import { getSessionCookie } from '../../lib/session';
import { StorefrontApiError } from '../../lib/api/client';

/**
 * "Add to quote" widget on the PDP (feature 008). One-shot create:
 * the new workflow does not have a server-held draft, so the form
 * immediately creates a Pending Quote Request with the single line
 * the customer is currently viewing. The customer can then add more
 * lines from the RFQ detail page or use Quick Order for bulk inputs.
 *
 * Anonymous shoppers are bounced to /login first because Quote
 * Requests are tied to a (customer, organization).
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
    <form action={addToQuoteAction} className="flex items-center gap-2">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="productSlug" value={productSlug} />
      {variantId ? <input type="hidden" name="variantId" value={variantId} /> : null}
      <label htmlFor={`rfq-qty-${productId}`} className="text-[12px]">
        Ilość
      </label>
      <input
        id={`rfq-qty-${productId}`}
        name="quantity"
        type="number"
        min={1}
        max={9999}
        defaultValue={defaultQuantity}
        className="w-[5rem] rounded-sm border border-line px-[8px] py-[6px]"
      />
      <button type="submit" className="btn btn--outline btn--sm">
        Dodaj do zapytania
      </button>
    </form>
  );
}

export async function addToQuoteAction(formData: FormData): Promise<void> {
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
  let createdId: string;
  try {
    const created = await createRfq(session, {
      items: [
        {
          productId,
          quantity,
          ...(variantId ? { variantId } : {}),
        },
      ],
    });
    createdId = created.id;
  } catch (err) {
    // NB: `redirect()` throws NEXT_REDIRECT, so the success redirect MUST live
    // outside this try — otherwise it is caught here and reported as a failure
    // even though the quote request was created.
    const message = err instanceof StorefrontApiError ? err.message : 'Nie udało się dodać do zapytania.';
    redirect(`/p/${encodeURIComponent(productSlug)}?rfqError=${encodeURIComponent(message)}`);
  }
  redirect(`/quote-requests/${createdId}`);
}
