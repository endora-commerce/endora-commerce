import type { Redis } from 'ioredis';
import { subscribeWhenReady } from '@endora-commerce/platform/kernel';

/** Redis pub/sub channel that fans a buyer's link change across processes (research R-9). */
export const RELATED_PAYERS_LINKS_CHANGED_CHANNEL = 'b2b:related_payers:links-changed';
/** The degraded bound: an entry is reloaded after this age even with no drop announced. */
export const RELATED_PAYERS_LINK_CACHE_TTL_MS = 60_000;

interface Entry<T> {
  readonly value: readonly T[];
  readonly loadedAt: number;
}

/**
 * Per-process cache of a buyer Organization's links (research R-9), the 154
 * per-Organization cache shape (`specs/154-sales-channel-access/research.md` R-16).
 *
 * Dropped for one buyer on every link Command's commit — locally and, through
 * {@link RELATED_PAYERS_LINKS_CHANGED_CHANNEL}, in every other process — and wholly on
 * `organization.status_changed.v1`, because the Organization may be the payer in any
 * entry. A TTL bounds staleness when the subscription is down. Readers that decide
 * anything final (placement) re-read the link inside their own transaction and never
 * trust this cache.
 */
export class RelatedPayerLinkCache<T> {
  readonly #entries = new Map<string, Entry<T>>();
  #subscriber: Redis | null = null;
  /** Bumped by every drop: a load that began before it is answered and not stored. */
  #generation = 0;

  constructor(
    private readonly publisher?: Pick<Redis, 'publish'>,
    private readonly now: () => number = () => Date.now(),
    /**
     * The composition's shared subscriber connection, armed on first use rather than
     * at boot: the module ships off, and a cache nobody reads needs no subscription.
     * Every reader is behind the module's presence gate, so arming here never starts
     * work for a module that is off (check:entry-presence).
     */
    private readonly subscriber?: () => Redis,
  ) {}

  async get(buyerOrganizationId: string, loader: () => Promise<readonly T[]>): Promise<readonly T[]> {
    this.#arm();
    const hit = this.#entries.get(buyerOrganizationId);
    if (hit && this.now() - hit.loadedAt < RELATED_PAYERS_LINK_CACHE_TTL_MS) return hit.value;
    const generation = this.#generation;
    const value = await loader();
    if (generation === this.#generation) {
      this.#entries.set(buyerOrganizationId, { value, loadedAt: this.now() });
    }
    return value;
  }

  /** Drop one buyer here, or every entry when omitted. */
  drop(buyerOrganizationId?: string): void {
    this.#generation += 1;
    if (buyerOrganizationId === undefined) this.#entries.clear();
    else this.#entries.delete(buyerOrganizationId);
  }

  /**
   * Drop locally and announce it to every other process. Called after a link Command
   * committed. A failed publish is tolerated on purpose: the TTL keeps the other
   * processes eventually consistent, and the write itself already committed.
   */
  async publishDrop(buyerOrganizationId: string): Promise<void> {
    this.drop(buyerOrganizationId);
    if (!this.publisher) return;
    try {
      await this.publisher.publish(RELATED_PAYERS_LINKS_CHANGED_CHANNEL, JSON.stringify({ buyerOrganizationId }));
    } catch {
      // Degraded: the TTL is the bound.
    }
  }

  /** `organization.status_changed.v1` — either party of any entry may have changed. */
  onOrganizationStatusChanged(): void {
    this.drop();
  }

  #arming: Promise<void> | null = null;

  #arm(): void {
    if (this.#arming || !this.subscriber) return;
    // A failed SUBSCRIBE leaves the TTL as the bound, which is the degraded mode.
    this.#arming = this.start(this.subscriber()).catch(() => undefined);
  }

  /** Arm the cross-process subscriber on the composition's shared connection. Idempotent. */
  async start(redisSubscriber: Redis): Promise<void> {
    if (this.#subscriber) return;
    this.#subscriber = redisSubscriber;
    await subscribeWhenReady(redisSubscriber, RELATED_PAYERS_LINKS_CHANGED_CHANNEL);
    redisSubscriber.on('message', (channel, message) => {
      if (channel === RELATED_PAYERS_LINKS_CHANGED_CHANNEL) this.handleMessage(message);
    });
  }

  /** Apply an announced drop; a message that does not parse drops everything. */
  handleMessage(message: string): void {
    try {
      const parsed = JSON.parse(message) as { buyerOrganizationId?: unknown };
      this.drop(typeof parsed.buyerOrganizationId === 'string' ? parsed.buyerOrganizationId : undefined);
    } catch {
      this.drop();
    }
  }
}
