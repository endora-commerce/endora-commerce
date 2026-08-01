/**
 * Triggers on-demand revalidation of the storefront's tagged fetch caches
 * (feature 049; promoted to shared HTTP infrastructure in feature 066). It has
 * no module-specific content — it POSTs cache tags to the storefront's
 * revalidate endpoint — and four modules need it, so it lives here rather than
 * inside one of them (Principle I).
 *
 * Best-effort: a failed call is logged and swallowed so a config/custom-event
 * write never fails because the storefront is unreachable. Disabled (no-op)
 * when the base URL or secret is not configured.
 */
export interface StorefrontRevalidatorOptions {
  baseUrl: string | undefined;
  secret: string | undefined;
  fetchFn?: typeof fetch;
  logger?: { warn: (obj: unknown, msg: string) => void };
}

export class StorefrontRevalidator {
  private logger: StorefrontRevalidatorOptions['logger'];

  constructor(private readonly options: StorefrontRevalidatorOptions) {
    this.logger = options.logger;
  }

  /** Attach a logger once the Fastify app (and its `log`) exists. */
  setLogger(logger: NonNullable<StorefrontRevalidatorOptions['logger']>): void {
    this.logger = logger;
  }

  get enabled(): boolean {
    return !!this.options.baseUrl && !!this.options.secret;
  }

  async revalidate(tags: string[]): Promise<void> {
    if (!this.enabled || tags.length === 0) return;
    const fetchFn = this.options.fetchFn ?? globalThis.fetch;
    try {
      await fetchFn(`${this.options.baseUrl}/api/revalidate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-revalidate-secret': this.options.secret as string,
        },
        body: JSON.stringify({ tags }),
      });
    } catch (err) {
      this.logger?.warn({ err }, '[storefront-revalidate] failed');
    }
  }
}
