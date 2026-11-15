import { firstLanguageTag, scopeLanguageOf } from '@endora-commerce/contracts';
import { currentSalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Issue #652 (D-292) — the language an account created or signed in by this
 * request should record: the request's first `Accept-Language` tag resolved
 * against the request's sales channel (`scopeLanguageOf` — exact, else the same
 * base language, else the channel's default), so always a tag the channel
 * spells. `null` outside a request, where no channel is resolved.
 */
export function requestAccountLanguage(acceptLanguage: string | readonly string[] | undefined): string | null {
  const channel = currentSalesChannel();
  return channel ? scopeLanguageOf(channel, firstLanguageTag(acceptLanguage)) : null;
}
