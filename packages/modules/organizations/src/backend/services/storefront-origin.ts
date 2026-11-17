// Issue #1371 — the storefront a customer e-mail started from the storefront
// links back to: the request's channel's `sales_channels.storefront_url`, else
// the deployment's `storefrontBaseUrl`.
//
// The same two rungs `mfa` and `quote_requests` read, kept here rather than
// imported because each module owns its own copy of an outside read
// (Constitution I).

import { SettingNotRegistered, SettingOutOfScopeForChannel } from '@endora-commerce/platform/kernel';

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
      // "Not configured here" — `sales_channels` absent, or the setting not
      // readable for this channel — and no other failure.
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
