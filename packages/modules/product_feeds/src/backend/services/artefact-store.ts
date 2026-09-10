import { Readable } from 'node:stream';
import type { ObjectStorageBackendCode, ObjectStoragePort } from '@endora-commerce/contracts';

/**
 * ArtefactStore — feature 067 / FR-043, FR-052, research §R6.
 *
 * The module's locator policy over `assets_library`' published object store. It
 * exists so `product_feeds` never imports another module's internals
 * (Principle I) and so an overlay can substitute a different backing store
 * under `tsc` as the contract gate (Principle XV).
 *
 * Three rules this store encodes, none of which the object store enforces on
 * its own:
 *
 *  1. **Objects are private.** Feed artefacts carry prices; the anonymous
 *     public route serves them by streaming `open()`, never by handing out a
 *     store URL — otherwise rotating a feed token would not actually revoke
 *     access.
 *  2. **No `Asset` row is ever created.** These bytes are this module's data,
 *     not library media: they must not appear in the asset browser, be counted
 *     in library quotas, or be reachable through the assets routes.
 *  3. **Locators live under this module's own prefix**, so a storage bucket
 *     stays readable and a bulk purge of feed artefacts can never touch an
 *     operator's uploads.
 *
 * **The adapter shapes this file used to declare are gone**
 * (`specs/110-instance-repository/` T118c). `ArtefactStorageAdapter` and
 * `ArtefactStorageAdapterProvider` were a structural transcription of an
 * interface the owner could not publish, and a composition root stood between
 * the two converting one into the other — including a `getForBackend` branch
 * that threw, because the owner's union carried a second arm that cannot stream
 * bytes at all. `assets_library` publishes {@link ObjectStoragePort} now, whose
 * `getForBackend` is total, and this module resolves it directly.
 */

/**
 * The backend that physically owns an artefact's bytes, recorded per row.
 *
 * The published code, not a private copy of the same three strings: a value
 * read back off a `feed_artefacts` row is handed straight to
 * `ObjectStoragePort.getForBackend`, and two spellings of one union is how the
 * two come to disagree.
 */
export type ArtefactStorageBackend = ObjectStorageBackendCode;

export interface ArtefactPutInput {
  locator: string;
  contentType: string;
  /** Consumed exactly once. Length is unknown up front — feeds are streamed. */
  stream: Readable;
}

export interface ArtefactPutResult {
  backend: ArtefactStorageBackend;
  locator: string;
}

export interface ArtefactStorePort {
  /** Compute a fresh, never-colliding locator under this module's prefix. */
  newLocator(input: { artefactId: string; extension: string }): string;
  /** Stream bytes into the active backend. Returns the backend that took them. */
  put(input: ArtefactPutInput): Promise<ArtefactPutResult>;
  /** Stream an existing artefact's bytes back out. */
  open(input: { backend: ArtefactStorageBackend; locator: string }): Promise<Readable>;
  /** Remove an artefact's bytes. Retention tolerates an already-missing object. */
  delete(input: { backend: ArtefactStorageBackend; locator: string }): Promise<void>;
}

/** Every locator this module produces starts here — see rule 3 above. */
export const ARTEFACT_LOCATOR_PREFIX = 'product-feeds';

export class ArtefactStore implements ArtefactStorePort {
  constructor(private readonly objectStorage: ObjectStoragePort) {}

  newLocator(input: { artefactId: string; extension: string }): string {
    const id = input.artefactId.toLowerCase();
    if (id.length < 4) {
      throw new Error(`ArtefactStore.newLocator: artefactId too short ("${input.artefactId}")`);
    }
    // Shard on the first two byte-pairs so neither a local-FS leaf directory
    // nor a bucket key space bunches up (the assets-library locator idiom).
    const extension = input.extension.replace(/^\./, '') || 'bin';
    return `${ARTEFACT_LOCATOR_PREFIX}/${id.slice(0, 2)}/${id.slice(2, 4)}/${id}.${extension}`;
  }

  async put(input: ArtefactPutInput): Promise<ArtefactPutResult> {
    const store = await this.objectStorage.getActive();
    await store.put({
      locator: input.locator,
      mimeType: input.contentType,
      visibility: 'private',
      stream: input.stream,
      // The length of a streamed feed is unknown until it is written; the
      // adapters accept 0 for "unknown" and the real size is measured by the
      // generation pipeline's pass-through byte counter.
      sizeBytes: 0,
    });
    // `code` is the store's own answer, typed. It used to be
    // `adapter.code as ArtefactStorageBackend` over a `readonly code: string`,
    // which is a cast that could have written anything into the row that
    // `getForBackend` is later handed.
    return { backend: store.code, locator: input.locator };
  }

  async open(input: { backend: ArtefactStorageBackend; locator: string }): Promise<Readable> {
    const store = await this.objectStorage.getForBackend(input.backend);
    // `AssetByteStream` is a structural async iterable, deliberately — the
    // published contract cannot name `NodeJS.ReadableStream` (see the port).
    // Fastify streams a reply by looking for `.pipe`, so the one wrap belongs
    // here, in a backend layer where `node:stream` is legal, rather than at the
    // two route handlers that send it.
    return Readable.from(await store.open({ locator: input.locator }));
  }

  async delete(input: { backend: ArtefactStorageBackend; locator: string }): Promise<void> {
    const store = await this.objectStorage.getForBackend(input.backend);
    await store.delete({ locator: input.locator });
  }
}
