import {
  firstLanguageTag,
  scopeLanguageOf,
  type CatalogProductAvailabilityPort,
  type CatalogProductUrlKeyReadPort,
  type ProductAudience,
  withChannelOrderRules,
} from '@endora-commerce/contracts';
import { currentSalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Feature 163 — the basket's questions to `catalogProductAvailabilityPort`
 * (`specs/163-product-data-scopes/contracts/consumers.md` rows 13–14).
 *
 * The availability rule is `catalog`'s; nothing here tests a status, a window
 * or an audience. What this file owns is which (channel, language, audience)
 * a basket asks about.
 */

/**
 * The scope language L of a basket seam: the request's language tag resolved
 * against the request channel's own languages when the basket is on that
 * channel, else `null` — the channel's default language (an operator naming a
 * customer's channel, or a seam outside a request). The channel record is the
 * resolver's (Constitution XII), never the client's.
 */
export function basketScopeLanguage(channelId: string, languageTag: string | undefined): string | null {
  const channel = currentSalesChannel();
  if (!channel || channel.id !== channelId) return null;
  return scopeLanguageOf(channel, languageTag);
}

/**
 * The records among `records` whose product is available at the basket's
 * (channel, L) to `audience` now. A record left out reads as a product with no
 * record — `product_unavailable` to the minimums rule, the unknown-id answer to
 * a buyer — so "switched off", "outside its window", "restricted" and "gone"
 * stay one answer (FR-006).
 *
 * A basket with no channel is not asked about (FR-007: the port never answers
 * for an unresolved channel); its records are returned as they are.
 */
export async function availableRecords<T extends { id: string }>(
  availability: Pick<CatalogProductAvailabilityPort, 'filterAvailable'>,
  records: readonly T[],
  scope: { channelId: string | null | undefined; languageCode: string | null; audience: ProductAudience },
): Promise<T[]> {
  if (records.length === 0 || !scope.channelId) return [...records];
  const available = await availability.filterAvailable(
    records.map((r) => r.id),
    { channelId: scope.channelId, languageCode: scope.languageCode, audience: scope.audience },
  );
  return records.filter((r) => available.has(r.id));
}

/**
 * Feature 163 (FR-100, research R26) — `records` with the basket channel's effective
 * minimum order quantity and returnable flag in place of the global ones, so the
 * minimums the basket judges and the minimum its view reports are the channel's.
 * A basket with no channel is not asked about (FR-007); its records are returned
 * as they are.
 */
export async function withBasketOrderRules<
  T extends { id: string; minOrderQuantity: number | null; returnable: boolean },
>(
  availability: Pick<CatalogProductAvailabilityPort, 'effectiveOrderRules'>,
  records: readonly T[],
  channelId: string | null | undefined,
): Promise<T[]> {
  if (records.length === 0 || !channelId) return [...records];
  return withChannelOrderRules(
    records,
    await availability.effectiveOrderRules(
      records.map((r) => r.id),
      channelId,
    ),
  );
}

/**
 * Feature 163 (T113a, R28) — product id → its effective URL key at the basket's
 * (`channelId`, `languageCode`): the channel × language key, else the language key,
 * else the global key, as `catalog` answers it. A basket with no channel, and a
 * product the channel does not carry, have no entry; the caller keeps the global key.
 */
export async function effectiveKeysAt(
  urlKeys: Pick<CatalogProductUrlKeyReadPort, 'effectiveKeys'>,
  productIds: readonly string[],
  channelId: string | null | undefined,
  /** `null` — no request language resolved against this channel ({@link basketScopeLanguage}): no entry. */
  languageCode: string | null,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (productIds.length === 0 || !channelId || languageCode === null) return out;
  for (const [productId, byLanguage] of await urlKeys.effectiveKeys(productIds, channelId)) {
    const key = byLanguage.get(languageCode);
    if (key !== undefined) out.set(productId, key);
  }
  return out;
}

/**
 * Feature 172 (FR-030, `contracts/readers.md` §1) — product id → its effective name at the
 * basket's (`channelId`, `languageCode`) along C×L → C → Global, as `catalog` answers it.
 * `languageCode` `null` = the channel's default language. A basket with no channel is not
 * asked about (FR-007): no entry, the caller keeps the Global name.
 */
export async function basketNamesAt(
  availability: Pick<CatalogProductAvailabilityPort, 'effectiveTexts'>,
  productIds: readonly string[],
  channelId: string | null | undefined,
  languageCode: string | null,
): Promise<Map<string, string>> {
  if (productIds.length === 0 || !channelId) return new Map();
  const texts = await availability.effectiveTexts([...new Set(productIds)], { channelId, languageCode });
  return new Map([...texts].map(([id, text]) => [id, text.name]));
}

/** The first `Accept-Language` tag without its quality parameter — the one home is `@endora-commerce/contracts`. */
export { firstLanguageTag };
