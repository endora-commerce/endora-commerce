import { Readable } from 'node:stream';
import type {
  AssetByteStream,
  ObjectStorageBackendCode,
  ObjectStoragePort,
  ObjectStoragePutInput,
  ObjectStore,
} from '@endora-commerce/contracts';
import type { StorageAdapter } from './storage-adapter.js';

/**
 * `objectStoragePort` — the byte store this module's storage configuration
 * already describes, published for the modules that store their own objects in
 * it (`specs/110-instance-repository/` T118c).
 *
 * It is a **mapping and nothing else**: the in-process `StorageAdapter` SPI
 * cannot be published as it stands, three ways, and each of the three is what
 * one line of this file answers.
 *
 *  1. `put` and `open` name `NodeJS.ReadableStream`, and `@endora-commerce/contracts`
 *     is compiled by `@endora-commerce/admin-kit` with `types: ["vite/client"]`
 *     — no `@types/node`, so naming that namespace fails a consumer's build.
 *     {@link AssetUploadStream} and {@link AssetByteStream} are the structural
 *     shapes that survive it, and `Readable.from` is the one line that bridges
 *     the write direction. The read direction needs no bridge: a Node stream
 *     already satisfies the structural shape.
 *  2. `setVisibility?` is **optional**, which D-97.3 refuses outright on a
 *     published port — `lazyPort`'s proxy answers every property with a
 *     function, so feature detection through one is impossible by construction.
 *     It is absent here, and not by omission: an object a consumer stores under
 *     its own prefix is written `private` and served by that consumer's own
 *     route, so there is no visibility to flip.
 *  3. `getForBackend` answered `StorageAdapter | LegacyAssetResolver`, and both
 *     consumers of the byte surface probed for `open` at the call site to find
 *     out which they had. Here it is **total**: `legacy` is not an object store
 *     — it is a resolver for pre-013 rows whose URL this platform did not issue
 *     — so it is not in {@link ObjectStorageBackendCode} and there is no branch
 *     left to probe for.
 *
 * `newLocator`, `resolveUrl` and `selfCheck` are absent for the same reason:
 * they are the *library's* questions. A consumer of this port computes its own
 * locator under its own prefix, serves its objects itself, and has no
 * administrative screen to report a backend's health on.
 */
export class ObjectStorageAdapter implements ObjectStoragePort {
  constructor(
    private readonly registry: {
      getActive(): Promise<StorageAdapter>;
      getForBackend(backend: ObjectStorageBackendCode): Promise<StorageAdapter>;
    },
  ) {}

  async getActive(): Promise<ObjectStore> {
    return wrap(await this.registry.getActive());
  }

  async getForBackend(backend: ObjectStorageBackendCode): Promise<ObjectStore> {
    return wrap(await this.registry.getForBackend(backend));
  }
}

function wrap(adapter: StorageAdapter): ObjectStore {
  // `code` is `StorageBackendCode` on the SPI and `legacy` is unrepresentable
  // here: `getActive` builds one of the three real backends and throws on
  // anything else, and `getForBackend` is overloaded so that the legacy arm is
  // reachable only for the literal `'legacy'`, which this port cannot name.
  const code = adapter.code as ObjectStorageBackendCode;
  return {
    code,
    async put(input: ObjectStoragePutInput): Promise<void> {
      await adapter.put({
        locator: input.locator,
        mimeType: input.mimeType,
        visibility: input.visibility,
        // The one bridge, and it is here rather than in the caller because the
        // caller is the one that must not name `node:stream`'s types across a
        // package boundary. A Node `Readable` passed in comes back out of
        // `Readable.from` as itself in every practical sense — it is iterated,
        // not copied.
        stream: Readable.from(input.stream),
        sizeBytes: input.sizeBytes,
      });
    },
    async open(input: { locator: string }): Promise<AssetByteStream> {
      return adapter.open(input);
    },
    async delete(input: { locator: string }): Promise<void> {
      await adapter.delete(input);
    },
  };
}
