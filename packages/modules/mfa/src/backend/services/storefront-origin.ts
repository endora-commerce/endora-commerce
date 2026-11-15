import { SettingNotRegistered, SettingOutOfScopeForChannel } from '@endora-commerce/platform/kernel';

/**
 * Issue #1279 — the storefront origin a customer's federated sign-in returns
 * to: the started-on channel's `sales_channels.storefront_url`, else the
 * fallback (`STOREFRONT_BASE_URL`), as `sales_channels` defines the setting.
 *
 * Only operator configuration is read, never anything a request carries, so
 * no redirect built on it can be pointed at a host the operator did not name.
 * A value that is not an absolute `http(s)` URL is treated as unset rather than
 * redirected to. A trailing slash is dropped, because every caller appends a
 * root-relative path.
 *
 * `readSetting` throws `SettingNotRegistered` where `sales_channels` is absent
 * and `SettingOutOfScopeForChannel` where the setting is not channel-scoped;
 * both mean "not configured here". Anything else is a failure and propagates.
 */
export function createStorefrontOriginResolver(
  readSetting: (salesChannelId: string) => Promise<string | null>,
  fallback: string,
): (salesChannelId: string | null) => Promise<string> {
  const fallbackOrigin = withoutTrailingSlash(fallback);
  return async (salesChannelId) => {
    if (!salesChannelId) return fallbackOrigin;
    let configured: string | null = null;
    try {
      configured = await readSetting(salesChannelId);
    } catch (error) {
      if (!(error instanceof SettingNotRegistered || error instanceof SettingOutOfScopeForChannel)) throw error;
    }
    const value = configured?.trim() ?? '';
    return isHttpUrl(value) ? withoutTrailingSlash(value) : fallbackOrigin;
  };
}

function isHttpUrl(value: string): boolean {
  if (value === '') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
