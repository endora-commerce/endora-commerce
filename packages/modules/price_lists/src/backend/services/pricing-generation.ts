import { randomUUID } from 'node:crypto';
import type { SurfaceChange } from './surface-change.js';

/**
 * Redis pub/sub channel that fans a pricing change across processes (API
 * replicas and workers alike) — D-287 P0, `specs/pricing/decision-record.md`
 * §6 item 3.
 *
 * The same pattern `custom_fields`' definition cache uses
 * (`b2b:custom_fields:definitions-changed`), which is itself the kernel's
 * registry-cache pattern brought down to a module: the write announces after
 * commit, every process's subscriber drops its in-process layer, and the TTL is
 * the degraded-mode bound when the subscription is down.
 */
export const PRICING_GENERATION_CHANNEL = 'b2b:price_lists:pricing-generation';

/** The one call a publisher needs — `ioredis`' `publish`, structurally. */
export interface PricingGenerationPublisher {
  publish(channel: string, message: string): Promise<unknown>;
}

/** The two calls a subscriber needs — `ioredis`' subscriber mode, structurally. */
export interface PricingGenerationSubscriber {
  subscribe(channel: string): Promise<unknown>;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
}

/**
 * The pricing generation: one bump means "every price this process cached may
 * be wrong now".
 *
 * Before this existed a price write cleared the writer's `PricingCache` and no
 * other, and it cleared it from inside the Command Bus callback — before the
 * transaction committed — so another replica served the old price for up to
 * 60 s, and a read racing the write in the writer's own process could re-cache
 * the pre-write value for as long (`read-paths-and-performance.md` §2.4).
 *
 * What it owns is deliberately small: the local layer to clear and the channel
 * to announce on. **When** to bump is the writers' decision — every audited
 * `PriceListService` write after its commit, the display-mode overrides, and
 * the status sweeper when it activates or expires a list.
 *
 * Each process tags its own announcements with an origin id and ignores them
 * coming back, so the writer clears once, locally and synchronously, before it
 * returns to its caller; other processes clear when the message arrives. A
 * message that cannot be read is treated as a bump — the safe direction for a
 * cache.
 *
 * Publishing is best-effort and never throws into the write that triggered it:
 * the write has already committed, and refusing its response would tell the
 * operator it failed. A lost announcement costs the other replicas at most one
 * TTL of staleness, which is exactly the behaviour before this existed.
 *
 * Structural Redis types rather than an `ioredis` import, so this module takes
 * no new dependency for one `publish` and one `subscribe`.
 */
export class PricingGeneration {
  readonly #origin = randomUUID();
  #subscribed = false;

  constructor(
    private readonly local: { invalidateAll(): void },
    private readonly publisher?: PricingGenerationPublisher,
    /**
     * Feature 160 — what the **writer** does once per bump, after clearing its
     * layer: mark on the price surface what the change moved and ask for its
     * refresh (`contracts/price-surface.md` §4). Not run for another process's
     * announcement (one writer, one marking). Best effort, like the
     * announcement: the write has already committed.
     */
    private readonly afterBump?: (change: SurfaceChange) => Promise<void>,
  ) {}

  /**
   * Clear this process's layer and announce the bump to every other process.
   * `change` says what the price surface must refresh; a writer that says
   * nothing gets every profile rebuilt — the safe direction. The cache is
   * cleared whole either way.
   */
  async bump(change: SurfaceChange = { kind: 'all' }): Promise<void> {
    this.local.invalidateAll();
    if (this.afterBump) {
      try {
        await this.afterBump(change);
      } catch {
        // Degraded: the surface stays as it is until the next bump or rebuild.
      }
    }
    if (!this.publisher) return;
    try {
      await this.publisher.publish(
        PRICING_GENERATION_CHANNEL,
        JSON.stringify({ origin: this.#origin }),
      );
    } catch {
      // Degraded: the other replicas fall back to the TTL.
    }
  }

  /**
   * The name `PriceListService` and the status worker call. A method rather
   * than a property so a writer's `{ invalidateAll }` seam takes this object
   * as it is.
   */
  invalidateAll(change?: SurfaceChange): Promise<void> {
    return this.bump(change);
  }

  /** Arm the cross-process subscriber. Idempotent. */
  async start(subscriber: PricingGenerationSubscriber): Promise<void> {
    if (this.#subscribed) return;
    this.#subscribed = true;
    await subscriber.subscribe(PRICING_GENERATION_CHANNEL);
    subscriber.on('message', (channel, message) => {
      if (channel !== PRICING_GENERATION_CHANNEL) return;
      this.handleMessage(message);
    });
  }

  /** Apply one announcement. Exposed for tests. */
  handleMessage(message: string): void {
    try {
      const parsed = JSON.parse(message) as { origin?: unknown };
      if (parsed.origin === this.#origin) return;
    } catch {
      // Unreadable: fall through and clear.
    }
    this.local.invalidateAll();
  }
}
