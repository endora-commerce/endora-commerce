import { SettingNotRegistered, SettingOutOfScopeForChannel } from '@endora-commerce/platform/kernel';

const STOREFRONT_BASE_URL_ENV = 'STOREFRONT_BASE_URL';

/**
 * The storefront address a customer e-mail links to, for one sales channel.
 *
 * Two rungs, as `sales_channels.storefront_url` defines itself
 * (`sales_channels/src/manifest.ts`: "Empty value falls back to
 * STOREFRONT_BASE_URL env") and as `seo` and `product_feeds` already read it:
 *
 *  1. the channel's `sales_channels.storefront_url`, when set and not blank;
 *  2. `STOREFRONT_BASE_URL`, when set and not blank.
 *
 * There is deliberately no third rung: `seo`'s local development storefront is
 * an address nobody configured, and an e-mail must not carry it. Neither rung
 * set answers `null` — no link. A setting that is not registered, or not
 * readable for a channel, means "not configured here" and falls through to the
 * env; any other failure of the read is rethrown.
 *
 * Both rungs are trimmed; the trailing slash is the caller's to strip.
 */
export async function resolveCustomerStorefrontUrl(
  readSetting: (salesChannelId: string) => Promise<string | null>,
  salesChannelId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string | null> {
  let fromSetting: string | null = null;
  try {
    fromSetting = await readSetting(salesChannelId);
  } catch (error) {
    // The two conditions that mean "not configured here", and no others.
    if (!(error instanceof SettingNotRegistered || error instanceof SettingOutOfScopeForChannel)) throw error;
  }
  const setting = fromSetting?.trim() ?? '';
  if (setting !== '') return setting;
  const fromEnv = env[STOREFRONT_BASE_URL_ENV]?.trim() ?? '';
  return fromEnv !== '' ? fromEnv : null;
}
