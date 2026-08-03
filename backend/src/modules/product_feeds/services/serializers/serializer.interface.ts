/**
 * Feed serializer SPI — feature 067 / FR-011, FR-034.
 *
 * The contract is deliberately *chunk-returning* rather than
 * document-returning: `begin()` / `item()` / `end()` each produce a string that
 * the caller writes straight into a stream and forgets. No implementation may
 * accumulate — a 100k-item GMC feed is 60–120 MB of UTF-8, and three concurrent
 * runs of a buffering serializer exhaust a small VPS (research §R2, §R4).
 *
 * The corollary that keeps this honest: `item()` must be a pure function of its
 * argument. `test/unit/product_feeds/xml-feed-serializer.test.ts` asserts that
 * the chunk for the thousandth item is byte-identical to the chunk for the
 * first, which no buffering implementation can satisfy.
 *
 * This file is also the overlay seam (Principle XV): a deployment that must
 * emit a provider dialect the core does not know ships its own implementation
 * of this interface and satisfies `tsc`.
 */

/** One resolved output field of one item, in template order. */
export interface FeedItemField {
  /** The output name written verbatim into the file (`g:price`, `availability`). */
  readonly name: string;
  /** Already-resolved, already-transformed value. Never null — an absent field is simply omitted. */
  readonly value: string;
}

export type FeedFileExtension = 'xml' | 'csv' | 'tsv';

export interface FeedSerializer {
  /** `Content-Type` for both the admin download and the public route. */
  readonly contentType: string;
  /** Extension used in `Content-Disposition` and in the storage locator. */
  readonly fileExtension: FeedFileExtension;

  /** Everything preceding the first item (XML prologue, or the CSV header row). */
  begin(): string;
  /** Exactly one item's worth of output. MUST NOT depend on previous calls. */
  item(fields: readonly FeedItemField[]): string;
  /** Everything following the last item. Empty for a delimited file. */
  end(): string;
}
