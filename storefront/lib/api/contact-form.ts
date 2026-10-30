import type { ContactFormSubmission } from '@endora-commerce/contracts';
import { apiMutate } from './mutations';
import { StorefrontApiError } from './client';

/**
 * Feature 169 — the storefront's call to the `cms` module's contact-form endpoint
 * (`specs/169-page-builder-contact-form/` contracts/contact-form-api.md §2–3).
 *
 * Every answer is mapped to one of three outcomes the block can speak: `sent`; `invalid` for a
 * submission the backend refused (400); `unavailable` for everything else — no recipients
 * (409), the rate limit (429), a failed send (5xx) or no backend at all. The shopper's own
 * forwarded address goes with the call, so the backend's per-IP limit counts the shopper and
 * not the storefront (effective only where the deployment trusts the storefront as a proxy).
 */
export type ContactFormOutcome = 'sent' | 'invalid' | 'unavailable';

export const CONTACT_FORM_BACKEND_PATH = '/api/v1/storefront/cms/contact-form';

export async function submitContactForm(input: {
  submission: ContactFormSubmission;
  channelCode: string;
  forwardedFor?: string | null;
}): Promise<ContactFormOutcome> {
  try {
    await apiMutate<{ status: 'sent' }>({
      method: 'POST',
      path: CONTACT_FORM_BACKEND_PATH,
      body: input.submission,
      ctx: { salesChannelCode: input.channelCode },
      ...(input.forwardedFor ? { headers: { 'x-forwarded-for': input.forwardedFor } } : {}),
    });
    return 'sent';
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 400) return 'invalid';
    return 'unavailable';
  }
}
