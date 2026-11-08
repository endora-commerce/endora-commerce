import type { EntityManager } from '@mikro-orm/postgresql';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * The currency of a quote request's lines (issue #303, architect ruling 7 of
 * 2026-11-07).
 *
 * **Decided once, at create.** The customer's create and the operator's
 * `createOnBehalf` stamp the default currency of the channel the request is
 * raised on. Every later line write — the buyer's draft edit, the operator's
 * `modify`, a resubmit — copies the currency the request already has
 * ({@link requestLineCurrency}), so one request never mixes currencies, even if
 * the channel's default currency changes in between.
 *
 * **`PLN` is the legacy answer, not a default.** It is what every line was
 * stored with before this rule, and it is left only for a request recorded on
 * no channel (`sales_channel_id` is nullable, see the module's *Data model*)
 * or on a channel that no longer exists. Existing rows are not backfilled.
 */
export const LEGACY_LINE_CURRENCY = 'PLN';

/** The default currency of `salesChannelId`; {@link LEGACY_LINE_CURRENCY} for none. */
export async function channelCurrency(
  em: EntityManager,
  salesChannelId: string | null | undefined,
): Promise<string> {
  if (!salesChannelId) return LEGACY_LINE_CURRENCY;
  const channel = await em.findOne(SalesChannel, { id: salesChannelId }, { fields: ['id', 'defaultCurrency'] });
  return channel?.defaultCurrency ?? LEGACY_LINE_CURRENCY;
}

/** {@link channelCurrency} for many channels at once, keyed by channel id; a missing key is legacy. */
export async function channelCurrencies(
  em: EntityManager,
  salesChannelIds: ReadonlyArray<string | null | undefined>,
): Promise<ReadonlyMap<string, string>> {
  const ids = [...new Set(salesChannelIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const channels = await em.find(SalesChannel, { id: { $in: ids } }, { fields: ['id', 'defaultCurrency'] });
  return new Map(channels.map((channel) => [channel.id, channel.defaultCurrency]));
}

/**
 * The currency a later line write copies: the one the request's stored lines
 * already carry. A request with no stored line falls back to its channel's.
 */
export async function requestLineCurrency(
  em: EntityManager,
  rfq: { salesChannelId?: string | null },
  storedLines: ReadonlyArray<{ lineCurrency: string }>,
): Promise<string> {
  return storedLines[0]?.lineCurrency ?? (await channelCurrency(em, rfq.salesChannelId));
}

/** A list summary's currency: its first line's, else its channel's, else legacy. */
export function summaryCurrency(
  rfq: { salesChannelId?: string | null },
  lines: ReadonlyArray<{ lineCurrency: string }>,
  currencyByChannel: ReadonlyMap<string, string>,
): string {
  return (
    lines[0]?.lineCurrency ??
    (rfq.salesChannelId ? currencyByChannel.get(rfq.salesChannelId) : undefined) ??
    LEGACY_LINE_CURRENCY
  );
}
