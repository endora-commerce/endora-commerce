import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type {
  ObjectStorageBackendCode,
  ObjectStoragePort,
  ObjectStoragePutInput,
  ObjectStore,
} from '@endora-commerce/contracts';
import { ARTEFACT_LOCATOR_PREFIX, ArtefactStore } from './artefact-store.js';

/**
 * `ArtefactStore` over a stub {@link ObjectStoragePort} — the three rules this
 * module encodes on top of the store, and the one Fastify needs
 * (`specs/110-instance-repository/` T118c).
 *
 * It composes nothing on purpose. The wiring half of the proof is
 * `backend/test/integration/product_feeds/`, which drives a real generation
 * against a real storage adapter; what belongs here is the policy, which is a
 * function of the port and of nothing else.
 */

interface Call {
  store: ObjectStorageBackendCode;
  method: 'put' | 'open' | 'delete';
  input: unknown;
}

function stubStorage(active: ObjectStorageBackendCode = 'local'): {
  port: ObjectStoragePort;
  calls: Call[];
  resolvedBy: Array<'getActive' | 'getForBackend'>;
} {
  const calls: Call[] = [];
  const resolvedBy: Array<'getActive' | 'getForBackend'> = [];

  const store = (code: ObjectStorageBackendCode): ObjectStore => ({
    code,
    async put(input: ObjectStoragePutInput) {
      calls.push({ store: code, method: 'put', input });
    },
    async open(input) {
      calls.push({ store: code, method: 'open', input });
      // A structural async iterable and deliberately **not** a `Readable`: it is
      // what the published contract promises, and it is what the store's own
      // adapters may legally return.
      return {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from('<rss/>');
        },
      };
    },
    async delete(input) {
      calls.push({ store: code, method: 'delete', input });
    },
  });

  return {
    calls,
    resolvedBy,
    port: {
      async getActive() {
        resolvedBy.push('getActive');
        return store(active);
      },
      async getForBackend(backend) {
        resolvedBy.push('getForBackend');
        return store(backend);
      },
    },
  };
}

describe('ArtefactStore.newLocator', () => {
  it('shards under this module’s own prefix and never anywhere else', () => {
    const { port } = stubStorage();
    const locator = new ArtefactStore(port).newLocator({
      artefactId: 'AB12CDEF-3456',
      extension: '.xml',
    });

    expect(locator).toBe(`${ARTEFACT_LOCATOR_PREFIX}/ab/12/ab12cdef-3456.xml`);
    // Rule 3: a bulk purge of feed artefacts must never be able to reach an
    // operator's uploads, which is a property of the prefix and not of a
    // convention somebody remembers.
    expect(locator.startsWith(`${ARTEFACT_LOCATOR_PREFIX}/`)).toBe(true);
  });

  it('refuses an id too short to shard rather than colliding quietly', () => {
    const { port } = stubStorage();
    expect(() => new ArtefactStore(port).newLocator({ artefactId: 'ab', extension: 'xml' })).toThrow(
      /artefactId too short/,
    );
  });
});

describe('ArtefactStore.put', () => {
  it('writes private, declares an unknown length, and records the store that took the bytes', async () => {
    const { port, calls, resolvedBy } = stubStorage('s3');
    const result = await new ArtefactStore(port).put({
      locator: 'product-feeds/ab/12/ab12.xml',
      contentType: 'application/xml',
      stream: Readable.from(['<rss/>']),
    });

    // Rule 1: a feed artefact carries prices and is served by this module's own
    // tokenised route, so it is never a public object — otherwise rotating the
    // token would not revoke anything.
    expect(calls[0]?.input).toMatchObject({ visibility: 'private', sizeBytes: 0 });
    // The backend on the row is the store's **own** answer. It used to be
    // `adapter.code as ArtefactStorageBackend` over a `readonly code: string`,
    // a cast that could have written anything into the value `getForBackend` is
    // handed on the way back out.
    expect(result.backend).toBe('s3');
    expect(resolvedBy).toEqual(['getActive']);
  });
});

describe('ArtefactStore reads and deletes', () => {
  it('goes to the store that owns the bytes, never to the active one (FR-017)', async () => {
    const { port, calls, resolvedBy } = stubStorage('gcs');
    const store = new ArtefactStore(port);

    await store.open({ backend: 'local', locator: 'product-feeds/ab/12/ab12.xml' });
    await store.delete({ backend: 'local', locator: 'product-feeds/ab/12/ab12.xml' });

    // The active store is `gcs` and both calls went to `local`, which is the
    // whole rule: after a backend switch, resolving an existing artefact through
    // the active store looks in a bucket its bytes were never written to. No
    // integration test in the tree can see this — the harness configures one
    // backend, so both answers agree there.
    expect(resolvedBy).toEqual(['getForBackend', 'getForBackend']);
    expect(calls.map((c) => [c.method, c.store])).toEqual([
      ['open', 'local'],
      ['delete', 'local'],
    ]);
  });

  it('hands back a stream Fastify can send', async () => {
    const { port } = stubStorage();
    const stream = await new ArtefactStore(port).open({
      backend: 'local',
      locator: 'product-feeds/ab/12/ab12.xml',
    });

    // `reply.send(stream)` streams by looking for `.pipe`, and the published
    // `AssetByteStream` is a bare async iterable, so the one `Readable.from`
    // belongs here rather than at the two route handlers. Without it the reply
    // serialises the object instead of streaming the file, which is a 200 with
    // the wrong body — the shape a test that only checked the status would miss.
    expect(typeof (stream as unknown as { pipe?: unknown }).pipe).toBe('function');

    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('<rss/>');
  });
});
