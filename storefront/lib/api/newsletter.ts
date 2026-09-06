import type {
  NewsletterStatusResponse,
  NewsletterSubscribeResponse,
  SelfNewsletterStatus,
} from '@endora-commerce/contracts';
import { apiMutate, apiGetAuthed } from './mutations';
import { backendBaseUrl } from '../env.mjs';

/**
 * The backend's origin, read per call.
 *
 * **Not a module-scope constant, and that is measured rather than stylistic.**
 * `BACKEND_BASE_URL` is a *run-time* value — `deploy/compose.prod.yml` sets it
 * on the container and `storefront/Dockerfile` deliberately does not pass it as
 * a build arg — but `next build`'s collect-page-data phase evaluates every
 * route's module scope, so a `const baseUrl = backendBaseUrl()` here made the
 * image build fail on `/sitemap.xml` and `/manifest.webmanifest` for a variable
 * that is correctly absent at that moment. Reading it inside the call is also
 * what `lib/api/backend-reachability.ts` does, for its own half of the same
 * reason: a container configured at start-up is only honoured by a read that
 * happens then.
 */


/**
 * Newsletter storefront API (feature 048). Public subscribe/unsubscribe plus the
 * authenticated account panel (`/me/newsletter`).
 */

/**
 * Public module status for a channel: whether the newsletter module is enabled
 * and its opt-in mode. Returns `enabled: false` on any error so callers can hide
 * newsletter UI when the module is disabled or unreachable.
 */
export async function getNewsletterStatus(channelCode: string): Promise<NewsletterStatusResponse> {
  try {
    const res = await fetch(
      `${backendBaseUrl()}/api/v1/newsletter/status?channel=${encodeURIComponent(channelCode)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return { enabled: false, optInMode: 'double' };
    const body = (await res.json()) as { data: NewsletterStatusResponse };
    return body.data;
  } catch {
    return { enabled: false, optInMode: 'double' };
  }
}

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
