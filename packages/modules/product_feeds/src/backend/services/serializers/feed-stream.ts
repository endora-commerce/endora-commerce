import { createHash } from 'node:crypto';
import { PassThrough, Readable, Transform } from 'node:stream';
import {
  isStreamingSerializer,
  type AnyFeedSerializer,
  type FeedItemField,
} from './serializer.interface.js';

/**
 * The streaming core of feed generation — feature 067 / FR-034, research §R4.
 *
 * `createFeedReadable` turns an async item source into a `Readable` that the
 * storage adapter consumes directly. Nothing between the database cursor and
 * the storage object ever holds the whole document: `Readable.from` pulls the
 * source lazily and honours back-pressure, so peak memory is
 * `O(batch × fields)` regardless of catalogue size.
 *
 * The deterministic proof lives in
 * `test/unit/product_feeds/xml-feed-serializer.test.ts`: it records how many
 * items the source had yielded at the moment the consumer received the first
 * chunk. A buffering implementation drains the source completely before
 * emitting a byte, so that number would equal the item count.
 */
export function createFeedReadable(
  serializer: AnyFeedSerializer,
  source: AsyncIterable<readonly FeedItemField[]>,
): Readable {
  if (isStreamingSerializer(serializer)) {
    // A container format writes itself. `PassThrough` is what turns its sink
    // back into the `Readable` the storage adapter expects, and it is also what
    // carries back-pressure the other way: the writer stalls when the consumer
    // stops reading, so the document never accumulates here either.
    const sink = new PassThrough();
    void serializer
      .writeTo(sink, source)
      .catch((err: unknown) => sink.destroy(err instanceof Error ? err : new Error(String(err))));
    return sink;
  }
  // Bound to a const so the narrowing above survives into the generator: a
  // parameter is mutable, so TypeScript discards its narrowed type inside a
  // nested function.
  const chunked = serializer;
  async function* generate(): AsyncGenerator<string> {
    yield chunked.begin();
    for await (const fields of source) {
      yield chunked.item(fields);
    }
    yield chunked.end();
  }
  return Readable.from(generate());
}

/** What the pass-through counter observed once the stream was fully consumed. */
export interface StreamMeasurement {
  /** Exact byte length written — the `product_feed_artefacts.byte_size` value. */
  byteSize: number;
  /** Lower-case sha256 hex — the strong `ETag` for the public route. */
  checksumSha256: string;
}

/**
 * Wraps a stream in a pass-through that measures it *as it flows*.
 *
 * The size and checksum of an artefact are needed on the row, but reading the
 * object back to compute them would double the I/O and defeat the streaming.
 * The adapter also accepts `sizeBytes: 0` for "length unknown", which is why
 * the real count has to come from here.
 *
 * `measurement` is only complete once the returned stream has been fully
 * consumed — i.e. after `artefactStore.put()` resolves.
 */
export function measureStream(input: Readable): {
  stream: Readable;
  measurement: StreamMeasurement;
} {
  const measurement: StreamMeasurement = { byteSize: 0, checksumSha256: '' };
  const hash = createHash('sha256');
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      measurement.byteSize += buffer.length;
      hash.update(buffer);
      callback(null, buffer);
    },
    flush(callback) {
      measurement.checksumSha256 = hash.digest('hex');
      callback();
    },
  });
  // Propagate a source failure so a half-written object is never published.
  input.on('error', (err) => counter.destroy(err));
  return { stream: input.pipe(counter) as unknown as Readable, measurement };
}
