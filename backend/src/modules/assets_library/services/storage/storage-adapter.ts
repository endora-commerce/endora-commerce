// In-process Storage Adapter SPI — feature 013 / research.md R1.
// Each backend (local FS, S3, GCS) implements this exactly once. Consumers of
// the Library never know which backend is active; they go through
// AdapterRegistry.getActive() (or the per-asset dispatch in AssetsLibraryService
// which routes to the backend that originally stored the bytes).
//
// This is a TypeScript-only contract — the interface is never serialized over
// the wire, so it lives here rather than in @b2b/contracts.

import type { AssetVisibility, StorageBackendCode } from '@b2b/contracts';
export type { AssetVisibility, StorageBackendCode };

export interface StorageAdapterSelfCheck {
  ok: boolean;
  /** Admin-displayable when ok=false; left undefined on ok=true. */
  reason?: string;
}

export interface StoragePutInput {
  /** Locator the adapter must use; produced by the adapter via `newLocator(...)`. */
  locator: string;
  mimeType: string;
  visibility: AssetVisibility;
  /** Streaming source — must be consumed exactly once. */
  stream: NodeJS.ReadableStream;
  sizeBytes: number;
}

export interface StorageResolveUrlInput {
  locator: string;
  visibility: AssetVisibility;
  /** TTL for private signed URLs. Ignored for public assets. */
  ttlSec?: number;
}

export interface StorageResolveUrlOutput {
  url: string;
  /** Absolute expiry for signed URLs; null when the URL is stable (public). */
  expiresAt: Date | null;
}

export interface StorageNewLocatorInput {
  assetId: string;
  originalFilename: string;
}

export interface StorageAdapter {
  readonly code: StorageBackendCode;

  /** Cheap probe (HEAD bucket / stat dir / ListBuckets). Returns ok+reason. */
  selfCheck(): Promise<StorageAdapterSelfCheck>;

  /** Compute a fresh, never-colliding locator for an upload of the given asset. */
  newLocator(input: StorageNewLocatorInput): string;

  /** Atomically persist the byte stream at `locator`. Throws on any failure. */
  put(input: StoragePutInput): Promise<void>;

  /** Resolve a URL for serving. See research R6 for per-backend semantics. */
  resolveUrl(input: StorageResolveUrlInput): Promise<StorageResolveUrlOutput>;

  /** Stream the bytes for backend-proxied private serving (used by local-FS public route). */
  open(input: { locator: string }): Promise<NodeJS.ReadableStream>;

  /**
   * Remove the underlying object. MUST throw if the backend cannot confirm
   * removal — the worker relies on this for FR-031 block-then-retry.
   */
  delete(input: { locator: string }): Promise<void>;

  /**
   * Optional. Adapters whose visibility is enforced by per-request URL
   * resolution (local FS) MAY no-op; cloud adapters update the object ACL.
   */
  setVisibility?(input: {
    locator: string;
    visibility: AssetVisibility;
  }): Promise<void>;
}
