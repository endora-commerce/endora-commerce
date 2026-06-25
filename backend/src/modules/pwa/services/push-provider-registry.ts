import type { PushProvider, PushProviderRegistryPort } from '@b2b/contracts';

/**
 * Provider-agnostic push registry (FR-019). Mirrors the payment/shipping adapter
 * registries: providers register at composition time; the default ('web_push')
 * is resolved per channel. Swapping the default backend is a server-side change
 * that leaves the storefront subscription flow untouched.
 */
export class PushProviderRegistry implements PushProviderRegistryPort {
  private readonly providers = new Map<string, PushProvider>();
  private defaultKey = 'web_push';

  register(provider: PushProvider): void {
    if (this.providers.has(provider.key)) {
      // Last-writer-wins, with a visible signal (same posture as the adapter registries).
      console.warn(`[pwa] push provider "${provider.key}" re-registered; overriding.`);
    }
    this.providers.set(provider.key, provider);
  }

  /** Set which provider key is used as the default for new sends. */
  setDefaultKey(key: string): void {
    this.defaultKey = key;
  }

  get(key: string): PushProvider | undefined {
    return this.providers.get(key);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async resolveDefault(_salesChannelId: string): Promise<PushProvider> {
    const provider = this.providers.get(this.defaultKey);
    if (!provider) {
      throw new Error(`[pwa] no push provider registered for default key "${this.defaultKey}".`);
    }
    return provider;
  }
}
