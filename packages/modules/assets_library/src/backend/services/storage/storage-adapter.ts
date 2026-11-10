// In-process Storage Adapter SPI — feature 013 / research.md R1.
// Each backend (local FS, S3, GCS) implements this exactly once. Consumers of
// the Library never know which backend is active; they go through
// AdapterRegistry.getActive() (or the per-asset dispatch in AssetsLibraryService
// which routes to the backend that originally stored the bytes).
//
// This is a TypeScript-only contract — the interface is never serialized over
// the wire, so it lives here rather than in @endora-commerce/contracts.

import type { AssetVisibility, StorageBackendCode } from '@endora-commerce/contracts';
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
  /** Written as object metadata on cloud; ignored on local. */
  cacheControl?: string;
  /** Written as object metadata on cloud; ignored on local. */
  contentDisposition?: string;
}

/** A server-side copy of one object over another (specs/156-asset-stable-url/). */
export interface StorageCopyInput {
  from: string;
  to: string;
  /** ACL of the destination on cloud — always sent explicitly; ignored on local. */
  visibility: AssetVisibility;
  mimeType: string;
  cacheControl?: string;
  contentDisposition?: string;
}

export interface StorageResolveUrlInput {
  locator: string;
  visibility: AssetVisibility;
  /** TTL for private signed URLs. Ignored for public assets. */
  ttlSec?: number;
  /**
   * What a cloud signed URL makes the bucket answer with (issue #815): S3's
   * `response-content-type` / `response-content-disposition`, GCS's
   * `responseType` / `responseDisposition`. Signed into the URL, so the
   * bucket's answer follows the serving policy whatever the object's metadata
   * says. Ignored for public assets and on local storage, which serves its own
   * headers.
   */
  responseHeaders?: StorageResponseHeaders;
}

export interface StorageResponseHeaders {
  contentType: string;
  contentDisposition: string;
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
   * Server-side copy, atomic at the destination: a reader of `to` sees the old
   * object or the new one, never a partial one. Overwrites `to`. MUST throw
   * when the copy cannot be confirmed.
   */
  copy(input: StorageCopyInput): Promise<void>;

  /**
   * Optional. Adapters whose visibility is enforced by per-request URL
   * resolution (local FS) MAY no-op; cloud adapters update the object ACL.
   */
  setVisibility?(input: {
    locator: string;
    visibility: AssetVisibility;
  }): Promise<void>;
}
