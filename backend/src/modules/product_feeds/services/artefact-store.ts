import type { Readable } from 'node:stream';

/**
 * ArtefactStore — feature 067 / FR-043, FR-052, research §R6.
 *
 * The module's narrow port over the Assets Library storage adapter SPI. It
 * exists so `product_feeds` never imports another module's internals
 * (Principle I) and so an overlay can substitute a different backing store
 * under `tsc` as the contract gate (Principle XV).
 *
 * Three rules this port encodes, none of which the adapter enforces on its own:
 *
 *  1. **Objects are private.** Feed artefacts carry prices; the anonymous
 *     public route serves them by streaming `open()`, never by handing out the
 *     adapter's own public/signed URL — otherwise rotating a feed token would
 *     not actually revoke access.
 *  2. **No `Asset` row is ever created.** These bytes are this module's data,
 *     not library media: they must not appear in the asset browser, be counted
 *     in library quotas, or be reachable through the assets routes.
 *  3. **Locators live under this module's own prefix**, so a storage bucket
 *     stays readable and a bulk purge of feed artefacts can never touch an
 *     operator's uploads.
 */

/** The backend that physically owns an artefact's bytes, recorded per row. */
export type ArtefactStorageBackend = 'local' | 's3' | 'gcs';

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

/**
 * The subset of the Assets Library adapter registry this module needs. Declared
 * structurally so the module depends on a shape, not on the other module's
 * class.
 */
export interface ArtefactStorageAdapter {
  readonly code: string;
  put(input: {
    locator: string;
    mimeType: string;
    visibility: 'public' | 'private';
    stream: NodeJS.ReadableStream;
    sizeBytes: number;
  }): Promise<void>;
  open(input: { locator: string }): Promise<NodeJS.ReadableStream>;
  delete(input: { locator: string }): Promise<void>;
}

export interface ArtefactStorageAdapterProvider {
  /** The adapter new artefacts are written to. */
  getActive(): Promise<ArtefactStorageAdapter>;
  /**
   * The adapter that owns an existing artefact's bytes. Reads and deletes MUST
   * go through this, never through `getActive()` — after a backend switch the
   * active adapter would resolve an old artefact to the wrong store.
   */
  getForBackend(backend: ArtefactStorageBackend): Promise<ArtefactStorageAdapter>;
}

export interface ArtefactStorePort {
  /** Compute a fresh, never-colliding locator under this module's prefix. */
  newLocator(input: { artefactId: string; extension: string }): string;
  /** Stream bytes into the active backend. Returns the backend that took them. */
  put(input: ArtefactPutInput): Promise<ArtefactPutResult>;
  /** Stream an existing artefact's bytes back out. */
  open(input: { backend: ArtefactStorageBackend; locator: string }): Promise<NodeJS.ReadableStream>;
  /** Remove an artefact's bytes. Retention tolerates an already-missing object. */
  delete(input: { backend: ArtefactStorageBackend; locator: string }): Promise<void>;
}

/** Every locator this module produces starts here — see rule 3 above. */
export const ARTEFACT_LOCATOR_PREFIX = 'product-feeds';

export class ArtefactStore implements ArtefactStorePort {
  constructor(private readonly adapters: ArtefactStorageAdapterProvider) {}

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
    const adapter = await this.adapters.getActive();
    await adapter.put({
      locator: input.locator,
      mimeType: input.contentType,
      visibility: 'private',
      stream: input.stream,
      // The length of a streamed feed is unknown until it is written; the
      // adapters accept 0 for "unknown" and the real size is measured by the
      // generation pipeline's pass-through byte counter.
      sizeBytes: 0,
    });
    return { backend: adapter.code as ArtefactStorageBackend, locator: input.locator };
  }

  async open(input: {
    backend: ArtefactStorageBackend;
    locator: string;
  }): Promise<NodeJS.ReadableStream> {
    const adapter = await this.adapters.getForBackend(input.backend);
    return adapter.open({ locator: input.locator });
  }

  async delete(input: { backend: ArtefactStorageBackend; locator: string }): Promise<void> {
    const adapter = await this.adapters.getForBackend(input.backend);
    await adapter.delete({ locator: input.locator });
  }
}
