import type { NewsletterSubscribeResponse, SelfNewsletterStatus } from '@b2b/contracts';
import { apiMutate, apiGetAuthed } from './mutations';

/**
 * Newsletter storefront API (feature 048). Public subscribe/unsubscribe plus the
 * authenticated account panel (`/me/newsletter`).
 */

export async function subscribeNewsletter(input: {
  email: string;
  channelCode: string;
  tags?: string[];
  source?: string;
}): Promise<NewsletterSubscribeResponse> {
  const res = await apiMutate<NewsletterSubscribeResponse>({
    method: 'POST',
    path: '/api/v1/newsletter/subscribe',
    body: input,
  });
  return res.data ?? { status: 'pending' };
}

export async function publicUnsubscribe(token: string, reason?: string): Promise<void> {
  await apiMutate({
    method: 'POST',
    path: '/api/v1/newsletter/unsubscribe',
    body: { token, reason },
  });
}

export async function getSelfNewsletter(sessionCookie: string): Promise<SelfNewsletterStatus> {
  return apiGetAuthed<SelfNewsletterStatus>({ path: '/api/v1/me/newsletter', sessionCookie });
}

export async function selfSubscribeNewsletter(sessionCookie: string): Promise<void> {
  await apiMutate({ method: 'POST', path: '/api/v1/me/newsletter/subscribe', body: {}, sessionCookie });
}

export async function selfUnsubscribeNewsletter(sessionCookie: string, reason?: string): Promise<void> {
  await apiMutate({ method: 'POST', path: '/api/v1/me/newsletter/unsubscribe', body: { reason }, sessionCookie });
}
