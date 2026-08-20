import type { Writable } from 'node:stream';

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

export type FeedFileExtension = 'xml' | 'csv' | 'tsv' | 'txt' | 'xlsx';

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

/**
 * The second shape of serializer: one that owns its own sink.
 *
 * A text format can be cut into independent chunks, which is why `FeedSerializer`
 * above is the better contract wherever it applies — it makes buffering
 * structurally impossible. A container format cannot: an `.xlsx` is a ZIP whose
 * central directory depends on every entry written before it, so no `item()`
 * can be a pure function of its argument.
 *
 * Rather than weaken the chunk contract for everyone, such a format implements
 * this instead. The obligation the chunk contract enforced by construction
 * becomes an explicit one here: **`writeTo` must pull `source` lazily and honour
 * back-pressure on `sink`**, so peak memory stays independent of catalogue size
 * (research §R2, §R4). `createFeedReadable` accepts either shape and both reach
 * storage as a `Readable`.
 */
export interface StreamingFeedSerializer {
  readonly contentType: string;
  readonly fileExtension: FeedFileExtension;
  /** Resolves once the last byte has been handed to `sink`. */
  writeTo(sink: Writable, source: AsyncIterable<readonly FeedItemField[]>): Promise<void>;
}

export type AnyFeedSerializer = FeedSerializer | StreamingFeedSerializer;

export function isStreamingSerializer(
  serializer: AnyFeedSerializer,
): serializer is StreamingFeedSerializer {
  return typeof (serializer as StreamingFeedSerializer).writeTo === 'function';
}
