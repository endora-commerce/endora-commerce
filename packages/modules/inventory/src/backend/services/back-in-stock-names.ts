import type { CatalogProductAvailabilityPort } from '@endora-commerce/contracts';

/** The scope a back-in-stock subscription was taken in (issue #696). */
export interface BackInStockSubscriptionScope {
  id: string;
  /** `null` on a subscription written before #696, or whose channel was since deleted. */
  salesChannelId?: string | null | undefined;
  /** The scope language resolved at subscribe time; `null` = the channel's default language. */
  languageCode?: string | null | undefined;
}

/**
 * The product name each back-in-stock subscriber is told, by subscription id (issue #696,
 * `specs/174-product-editor-scope-switcher/contracts/readers.md` §1 — the buyer e-mail reads
 * `effectiveTexts` at the subscription's channel and language).
 *
 * A subscription with no channel keeps the **Global** name, which is what every subscriber was
 * told before the scope was stored. So does one catalog answers nothing for, or an empty name:
 * an e-mail never names a product by nothing. The port is asked once per distinct scope, never
 * per subscriber. `catalog` is non-deactivatable, so the port is always present; a failure is
 * the caller's to surface — it propagates before anything is sent or flushed.
 */
export async function backInStockNames(
  subscriptions: readonly BackInStockSubscriptionScope[],
  product: { id: string; name: string; sku: string },
  texts: Pick<CatalogProductAvailabilityPort, 'effectiveTexts'>,
): Promise<Map<string, string>> {
  const globalName = product.name || product.sku;
  const scopes = new Map<string, { channelId: string; languageCode: string | null }>();
  for (const sub of subscriptions) {
    if (!sub.salesChannelId) continue;
    const languageCode = sub.languageCode ?? null;
    scopes.set(scopeKey(sub.salesChannelId, languageCode), { channelId: sub.salesChannelId, languageCode });
  }
  const nameByScope = new Map<string, string>();
  for (const [key, scope] of scopes) {
    const name = (await texts.effectiveTexts([product.id], scope)).get(product.id)?.name;
    if (name) nameByScope.set(key, name);
  }
  const out = new Map<string, string>();
  for (const sub of subscriptions) {
    const scoped = sub.salesChannelId
      ? nameByScope.get(scopeKey(sub.salesChannelId, sub.languageCode ?? null))
      : undefined;
    out.set(sub.id, scoped ?? globalName);
  }
  return out;
}

function scopeKey(channelId: string, languageCode: string | null): string {
  return `${channelId}\u0000${languageCode ?? ''}`;
}
