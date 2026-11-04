import { CATALOG_PRODUCT_STOREFRONT_CACHE_TAGS as TAGS } from '@endora-commerce/contracts';

/** At most this many tags in one call to the storefront's revalidate endpoint. */
const TAGS_PER_CALL = 200;

/** The quiet period after the last announcement before a batch is sent. */
export const REVALIDATION_DEBOUNCE_MS = 150;

/** The longest an announcement waits while announcements keep arriving. */
const REVALIDATION_MAX_WAIT_MS = 1_000;

/**
 * The most products one batch names. Past it the batch drops the shared tag once —
 * every product-page read — rather than reading and posting thousands of keys.
 */
export const REVALIDATION_MAX_PENDING = 500;

export interface ProductPageRevalidationDeps {
  /** The storefront revalidator (`StorefrontRevalidator`): a no-op while it is not configured. */
  revalidator: { readonly enabled: boolean; revalidate(tags: string[]): Promise<void> };
  /** Every key a product page may have been asked by besides the id: slug, URL keys, former keys. */
  keysOf: (productIds: readonly string[]) => Promise<string[]>;
  log?: { warn: (obj: unknown, msg: string) => void };
}

/**
 * Feature 163 (T155 finding CACHE-1) — drops the storefront's cached product-page
 * reads of a product after a committed write that can change whether or where it is
 * available: status at any scope, publication window, audience, archive and restore,
 * URL keys, channel membership, and every bulk path that does one of those. Every
 * `product.updated.v1` counts, so a gallery, attachment or name change drops the
 * product's page too — the event does not say which writes are availability writes.
 *
 * The storefront tags each product-page read with the key it was asked by
 * (`CATALOG_PRODUCT_STOREFRONT_CACHE_TAGS.productKey`): the URL key or slug of the
 * resolve, the product id of the detail. So a product's tags are its id, its slug, its
 * URL keys and its former keys (a changed key's old spelling stays as a redirect row;
 * a deleted product's former keys arrive with its announcement, the rows being gone).
 *
 * Bounded (security review M2): a trailing debounce gathers a bulk operation into one
 * batch; past {@link REVALIDATION_MAX_PENDING} products the batch drops the shared tag
 * once; and one batch is in flight at a time — announcements made meanwhile wait in the
 * capped pending set, so a hung storefront grows nothing. Best-effort: a failed key
 * read or call is logged, and never reaches the write that announced it.
 */
/**
 * The events after which one product's cached storefront pages are dropped
 * (`productChanged`): the availability-changing writes of feature 163 (T155
 * finding CACHE-1), and a saved content attribute value (feature 172, FR-035) —
 * which has an event of its own precisely so it re-indexes nothing.
 */
export const PRODUCT_PAGE_CHANGE_EVENTS = [
  'product.updated.v1',
  'product.archived.v1',
  'product.content.updated.v1',
] as const;

/** The subscriber for {@link PRODUCT_PAGE_CHANGE_EVENTS}: the payload's `productId`, if it names one. */
export function productPageChangeHandler(
  revalidation: () => Pick<ProductPageRevalidation, 'productChanged'>,
): (payload: unknown) => void {
  return (payload) => {
    const productId = (payload as { productId?: unknown } | null)?.productId;
    if (typeof productId === 'string') revalidation().productChanged(productId);
  };
}

export class ProductPageRevalidation {
  readonly #pending = new Set<string>();
  /** Keys that cannot be read from the database any more (a deleted product's former keys). */
  readonly #extraKeys = new Set<string>();
  /** Deleted products: their batch falls back to the shared tag when the keys cannot be read. */
  #removed = false;
  #overflow = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #firstPendingAt: number | null = null;
  #inFlight: Promise<void> | null = null;

  constructor(private readonly deps: ProductPageRevalidationDeps) {}

  /** A committed write changed what the product's page may answer. */
  productChanged(productId: string): void {
    if (!this.deps.revalidator.enabled) return;
    this.#add(productId);
    this.#schedule();
  }

  /** A product was deleted; `formerKeys` are the keys its write removed. */
  productRemoved(productId: string, formerKeys: readonly string[]): void {
    if (!this.deps.revalidator.enabled) return;
    this.#add(productId);
    if (!this.#overflow) for (const key of formerKeys) this.#extraKeys.add(key);
    this.#removed = true;
    this.#schedule();
  }

  /** Resolves once nothing is in flight. */
  async idle(): Promise<void> {
    while (this.#inFlight) await this.#inFlight;
  }

  #add(productId: string): void {
    if (this.#overflow) return;
    this.#pending.add(productId);
    if (this.#pending.size > REVALIDATION_MAX_PENDING) {
      this.#overflow = true;
      this.#pending.clear();
      this.#extraKeys.clear();
    }
  }

  #schedule(): void {
    const now = Date.now();
    this.#firstPendingAt ??= now;
    if (this.#timer) clearTimeout(this.#timer);
    const wait = Math.min(REVALIDATION_DEBOUNCE_MS, this.#firstPendingAt + REVALIDATION_MAX_WAIT_MS - now);
    this.#timer = setTimeout(() => this.#flush(), Math.max(0, wait));
    // Best-effort: a pending batch never keeps the process alive on shutdown.
    this.#timer.unref?.();
  }

  #flush(): void {
    this.#timer = null;
    // One batch at a time: what arrives meanwhile is sent once this one settles.
    if (this.#inFlight) return;
    const ids = [...this.#pending];
    const extraKeys = [...this.#extraKeys];
    const removed = this.#removed;
    const overflow = this.#overflow;
    this.#pending.clear();
    this.#extraKeys.clear();
    this.#removed = false;
    this.#overflow = false;
    this.#firstPendingAt = null;
    if (ids.length === 0 && !overflow) return;
    this.#inFlight = this.#send(ids, extraKeys, removed, overflow).finally(() => {
      this.#inFlight = null;
      if (this.#pending.size > 0 || this.#overflow) this.#schedule();
    });
  }

  async #send(ids: string[], extraKeys: string[], removed: boolean, overflow: boolean): Promise<void> {
    if (overflow) {
      await this.#post([TAGS.product]);
      return;
    }
    const keys = new Set<string>([...ids, ...extraKeys]);
    let keysRead = true;
    try {
      for (const key of await this.deps.keysOf(ids)) keys.add(key);
    } catch (err) {
      keysRead = false;
      this.deps.log?.warn({ err, products: ids.length }, '[catalog] product page revalidation: the keys could not be read');
    }
    const tags = [...keys].map(TAGS.productKey).filter((tag) => tag.length <= TAGS.maxLength);
    // A deleted product whose remaining keys are unknown: only the shared tag reaches them.
    if (removed && !keysRead) tags.push(TAGS.product);
    for (let i = 0; i < tags.length; i += TAGS_PER_CALL) {
      await this.#post(tags.slice(i, i + TAGS_PER_CALL));
    }
  }

  async #post(tags: string[]): Promise<void> {
    try {
      await this.deps.revalidator.revalidate(tags);
    } catch (err) {
      // `StorefrontRevalidator` logs and swallows its own failures; this guards a
      // revalidator that does not, so nothing ever reaches the announcing write.
      this.deps.log?.warn({ err }, '[catalog] product page revalidation failed');
    }
  }
}
