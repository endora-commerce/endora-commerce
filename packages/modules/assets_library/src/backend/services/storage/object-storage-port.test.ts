import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { ObjectStorageAdapter } from './object-storage-port.js';
import type { StorageAdapter, StoragePutInput } from './storage-adapter.js';

/**
 * `objectStoragePort` — the mapping from this module's in-process
 * `StorageAdapter` SPI onto the published {@link ObjectStoragePort}
 * (`specs/110-instance-repository/` T118c).
 *
 * The three things the mapping is for, one case each, plus the property that
 * makes the port safe to publish at all: what it does **not** carry.
 */

function fakeAdapter(code: 'local' | 's3' | 'gcs'): {
  adapter: StorageAdapter;
  puts: StoragePutInput[];
  deletes: string[];
} {
  const puts: StoragePutInput[] = [];
  const deletes: string[] = [];
  const adapter = {
    code,
    selfCheck: async () => ({ ok: true }),
    newLocator: () => 'unused',
    put: async (input: StoragePutInput) => {
      puts.push(input);
    },
    resolveUrl: async () => ({ url: 'unused', expiresAt: null }),
    open: async () => Readable.from([Buffer.from('bytes')]),
    delete: async (input: { locator: string }) => {
      deletes.push(input.locator);
    },
    setVisibility: async () => undefined,
  } as unknown as StorageAdapter;
  return { adapter, puts, deletes };
}

describe('ObjectStorageAdapter', () => {
  it('carries the store’s code as a value a caller may hand back to getForBackend', async () => {
    const { adapter } = fakeAdapter('s3');
    const port = new ObjectStorageAdapter({
      getActive: async () => adapter,
      getForBackend: async () => adapter,
    });

    const store = await port.getActive();

    // `StorageAdapter.code` is the full `StorageBackendCode`, `legacy` included.
    // Here it is the object-store subset, which is what makes a value recorded
    // on a consumer's row safe to pass straight back in.
    expect(store.code).toBe('s3');
  });

  it('turns a structural upload stream into one the adapter can consume', async () => {
    const { adapter, puts } = fakeAdapter('local');
    const port = new ObjectStorageAdapter({
      getActive: async () => adapter,
      getForBackend: async () => adapter,
    });

    // The published input names `AssetUploadStream`, a bare async iterable,
    // because `@endora-commerce/contracts` is compiled by consumers with no
    // `@types/node`. The adapter wants a Node stream, and this is the one line
    // that bridges the two.
    await (
      await port.getActive()
    ).put({
      locator: 'product-feeds/ab/12/ab12.xml',
      mimeType: 'application/xml',
      visibility: 'private',
      stream: {
        async *[Symbol.asyncIterator]() {
          yield '<rss/>';
        },
      },
      sizeBytes: 0,
    });

    expect(puts).toHaveLength(1);
    expect(typeof (puts[0]?.stream as unknown as { pipe?: unknown }).pipe).toBe('function');
    const chunks: Buffer[] = [];
    for await (const chunk of puts[0]!.stream) chunks.push(Buffer.from(chunk as Buffer));
    expect(Buffer.concat(chunks).toString()).toBe('<rss/>');
  });

  it('routes a read and a delete to the store that was named', async () => {
    const { adapter, deletes } = fakeAdapter('gcs');
    const asked: string[] = [];
    const port = new ObjectStorageAdapter({
      getActive: async () => adapter,
      getForBackend: async (backend) => {
        asked.push(backend);
        return adapter;
      },
    });

    const stream = await (await port.getForBackend('local')).open({ locator: 'x/y.xml' });
    await (await port.getForBackend('local')).delete({ locator: 'x/y.xml' });

    expect(asked).toEqual(['local', 'local']);
    expect(deletes).toEqual(['x/y.xml']);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('bytes');
  });

  it('publishes only the four members a byte store has', async () => {
    const { adapter } = fakeAdapter('local');
    const port = new ObjectStorageAdapter({
      getActive: async () => adapter,
      getForBackend: async () => adapter,
    });

    const store = (await port.getActive()) as unknown as Record<string, unknown>;

    // The library's own questions stay the library's. `newLocator` and
    // `resolveUrl` are the *asset* surface; `selfCheck` reports a backend's
    // health on an administrative screen no consumer of this port has; and
    // `setVisibility` is the **optional** member D-97.3 refuses outright,
    // because feature detection through `lazyPort`'s proxy is impossible by
    // construction — every property of it answers with a function.
    expect(Object.keys(store).sort()).toEqual(['code', 'delete', 'open', 'put']);
    for (const absent of ['newLocator', 'resolveUrl', 'selfCheck', 'setVisibility']) {
      expect(store[absent]).toBeUndefined();
    }
  });
});
