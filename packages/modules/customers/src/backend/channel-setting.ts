import type { SalesChannelResolutionPort, SettingsReadPort } from '@endora-commerce/platform/kernel';

/** Which channel a setting is read for. */
export type ChannelSettingScope = 'request' | 'system-default';

export interface ChannelSettingReaderDeps {
  settingsReadPort: Pick<SettingsReadPort, 'get'>;
  salesChannelResolutionPort: Pick<SalesChannelResolutionPort, 'getSystemDefault'>;
  /** The sales channel the current request resolved to, if any. */
  currentChannelId: () => string | null | undefined;
}

/**
 * This module's own settings, read against a channel. Each degrades to the
 * manifest default rather than failing the request — the identical try/catch
 * stood in the production root, three times over.
 *
 * `'request'` reads for the sales channel the current request resolved to
 * (Constitution XII); `settings` then applies its own tiers — the channel's
 * row, the all-channels value, the manifest default. Issue #773: the B2C
 * registration gate read the system-default channel's value here, so it
 * applied that one value to every channel. Outside a request scope — no
 * resolved channel — it answers `fallback`, and never borrows the
 * system-default channel's value: a gate with no channel to ask fails closed.
 *
 * `'system-default'` reads the deployment's system-default channel; the
 * admin-side settings use it.
 *
 * D-48 removed an `if (!channel) return fallback;` from the system-default
 * branch: on the impossible no-channel branch it returned the compiled-in
 * constant without reading the setting at all, which is worse than switching
 * tier.
 */
export async function readChannelSetting<T>(
  deps: ChannelSettingReaderDeps,
  code: string,
  schema: Parameters<SettingsReadPort['get']>[2],
  fallback: T,
  scope: ChannelSettingScope = 'system-default',
): Promise<T> {
  try {
    let channelId: string;
    if (scope === 'request') {
      const current = deps.currentChannelId();
      if (!current) return fallback;
      channelId = current;
    } else {
      channelId = (await deps.salesChannelResolutionPort.getSystemDefault()).id;
    }
    return (await deps.settingsReadPort.get(code, channelId, schema)) as T;
  } catch {
    return fallback;
  }
}
