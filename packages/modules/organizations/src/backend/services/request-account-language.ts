import { requestScopeLanguage } from '@endora-commerce/contracts';
import { currentSalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Issue #652 (D-292) — the language an account created or signed in by this
 * request should record: its `Accept-Language` header resolved against the
 * request's sales channel by the shared resolver (`requestScopeLanguage` — the
 * tags in descending `q`, each matched exactly, else by base language; the
 * first the channel serves wins, else the channel's default), so always a tag
 * the channel spells. `null` outside a request, where no channel is resolved.
 */
export function requestAccountLanguage(acceptLanguage: string | readonly string[] | undefined): string | null {
  const channel = currentSalesChannel();
  return channel ? requestScopeLanguage(channel, acceptLanguage) : null;
}
