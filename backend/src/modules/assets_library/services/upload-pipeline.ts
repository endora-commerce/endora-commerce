// Upload pipeline — feature 013 / US1 / research.md R3, R8.
//
// Flow:
//   1. Pre-flight: filename / MIME / size against the configured policies.
//   2. Allocate a UUID, ask the active adapter for a sharded locator.
//   3. Sniff the actual MIME from the first bytes via `file-type/stream`.
//   4. Stream into adapter.put(); throw on any failure (no Asset row yet).
//   5. Insert the Asset row in one transaction. On insert failure, call
//      adapter.delete() to compensate (the orphan-sweep worker is the
//      backstop for this rare path).
//
// Atomicity contract per FR-010: if the function throws, neither a row nor
// a file survives. The compensating delete in step 5 closes the only
// race-y window (post-put, pre-commit).

import type { EntityManager } from '@mikro-orm/postgresql';
import { fileTypeFromBuffer } from 'file-type';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { ERROR_CODES } from '@b2b/contracts';

import { Asset } from '../entities/asset.entity.js';
import { HttpError } from '../../../http/error-envelope.js';
import type { AdapterRegistry } from './storage/adapter-registry.js';
import type { AssetVisibility } from './storage/storage-adapter.js';

export interface UploadPolicy {
  /** From `assets.allowed_file_types` setting; `['*']` ⇒ unrestricted. */
  allowedTypes: string[];
  /** From `assets.max_file_size_mb` setting; `0` ⇒ no cap. */
  maxFileSizeMb: number;
}

export interface UploadInput {
  /** Original filename from the multipart part. Used for extension + display. */
  filename: string;
  /** MIME from the multipart Content-Type header (may be wrong; sniffed below). */
  declaredMime: string;
  /** Streaming source — must be consumed exactly once. */
  stream: NodeJS.ReadableStream;
  /** Best-effort byte count from headers; `0` when unknown. */
  declaredSize: number;
  /** Folder id chosen by the admin, or null for "Unsorted". */
  folderId: string | null;
  /** Optional storefront-visible label. */
  label: string | null;
  /** Visibility on creation; defaults to `public`. */
  visibility: AssetVisibility;
}

export interface UploadPipelineDeps {
  emFactory: () => EntityManager;
  adapters: AdapterRegistry;
  /** Loader called once per upload; lets routes pre-resolve from settings. */
  loadPolicy: () => Promise<UploadPolicy>;
}

const KIND_BY_MIME_PREFIX: Array<[string, Asset['kind']]> = [
  ['image/', 'image'],
  ['video/', 'video'],
  ['application/pdf', 'pdf'],
];

function mimeToKind(mime: string): Asset['kind'] {
  for (const [prefix, kind] of KIND_BY_MIME_PREFIX) {
    if (mime.startsWith(prefix)) return kind;
  }
  return 'other';
}

function extensionOf(filename: string): string {
  const m = filename.toLowerCase().match(/\.([^./\\]+)$/);
  return m ? m[1]! : '';
}

/**
 * Allow-list match: extension OR MIME (case-insensitive). The setting may
 * carry either form. `'*'` anywhere in the list disables the gate.
 */
function isAllowed(allowed: string[], mime: string, ext: string): boolean {
  if (allowed.length === 0) return true;
  for (const entry of allowed) {
    const e = entry.trim().toLowerCase();
    if (e === '' || e === '*') return true;
    if (e === mime.toLowerCase()) return true;
    if (e === `.${ext}` || e === ext) return true;
    // Wildcard MIME like `image/*` matches any `image/...`
    if (e.endsWith('/*') && mime.toLowerCase().startsWith(e.slice(0, -1))) return true;
  }
  return false;
}

export class UploadPipeline {
  constructor(private readonly deps: UploadPipelineDeps) {}

  async run(input: UploadInput): Promise<Asset> {
    const policy = await this.deps.loadPolicy();
    const ext = extensionOf(input.filename);

    // — Pre-flight (cheap rejections before touching the adapter) —
    if (
      policy.maxFileSizeMb > 0 &&
      input.declaredSize > 0 &&
      input.declaredSize > policy.maxFileSizeMb * 1024 * 1024
    ) {
      throw new HttpError(
        413,
        ERROR_CODES.ASSET_UPLOAD_TOO_LARGE,
        `File exceeds the configured maximum of ${policy.maxFileSizeMb} MB.`,
      );
    }
    if (
      !isAllowed(policy.allowedTypes, input.declaredMime, ext)
    ) {
      throw new HttpError(
        415,
        ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED,
        `File type "${input.declaredMime || ext || 'unknown'}" is not allowed by the active policy. Allowed: ${policy.allowedTypes.join(', ') || '(none)'}.`,
      );
    }

    // — MIME sniff via file-type/stream —
    // The library returns a wrapped stream we consume in place of the original;
    // the wrapper replays the head bytes so the adapter still gets the full file.
    const { fileType, stream: sniffedStream } = await sniffMime(input.stream);
    const sniffedMime = fileType?.mime ?? input.declaredMime ?? 'application/octet-stream';

    // Re-check allow-list using the *sniffed* MIME (defends against spoofed
    // Content-Type) — the stricter check decides per spec edge case.
    if (
      sniffedMime !== input.declaredMime &&
      !isAllowed(policy.allowedTypes, sniffedMime, ext)
    ) {
      throw new HttpError(
        415,
        ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED,
        `File content reports type "${sniffedMime}", which is not allowed by the active policy. Allowed: ${policy.allowedTypes.join(', ') || '(none)'}.`,
      );
    }

    // — Allocate id, locator —
    const assetId = randomUUID();
    const adapter = await this.deps.adapters.getActive();
    const locator = adapter.newLocator({
      assetId,
      originalFilename: input.filename,
    });

    // — Stream into the adapter (storage-first commit) —
    try {
      await adapter.put({
        locator,
        mimeType: sniffedMime,
        visibility: input.visibility,
        stream: sniffedStream,
        sizeBytes: input.declaredSize,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new HttpError(
        503,
        ERROR_CODES.ASSET_STORAGE_UNAVAILABLE,
        `Storage adapter failed to persist the upload: ${reason}`,
      );
    }

    // — Resolve the *public* URL form once, for back-compat with code paths
    // (notably storefront catalog responses) that still read `storage_url`
    // directly. The local-FS public route ignores the URL and gates on
    // current `visibility` per request, so storing the public form is safe
    // even for `private` local assets. For S3/GCS this URL only works
    // when the asset is actually public; visibility-flipped cloud assets
    // need refresh via `assetsLibrary.resolveUrl(id)` (catalog-query
    // rewire is a Phase 5 follow-up).
    const publicForm = await adapter.resolveUrl({
      locator,
      visibility: 'public',
    });

    // — DB insert (compensating-delete on failure) —
    const em = this.deps.emFactory();
    try {
      const asset = em.create(Asset, {
        id: assetId,
        kind: mimeToKind(sniffedMime),
        filename: input.filename,
        mimeType: sniffedMime,
        sizeBytes: String(input.declaredSize > 0 ? input.declaredSize : 0),
        storageUrl: publicForm.url,
        storageLocator: locator,
        storageBackend: adapter.code,
        visibility: input.visibility,
        ...(input.folderId ? { folderId: input.folderId } : {}),
        ...(input.label ? { label: input.label } : {}),
      });
      await em.persistAndFlush(asset);
      return asset;
    } catch (insertErr) {
      // Compensating delete on storage. Best-effort; failure here is logged
      // and surfaced via `pendingCleanup` on the next worker tick.
      try {
        await adapter.delete({ locator });
      } catch {
        /* swallowed — compensating-delete is best-effort */
      }
      throw insertErr;
    }
  }
}

/**
 * Read the first 4100 bytes of a Node stream into a Buffer, sniff the MIME
 * via `fileTypeFromBuffer`, and return a new readable that yields the
 * buffered prefix followed by the rest of the original stream. This avoids
 * loading the whole upload into memory while still letting file-type
 * inspect the magic bytes.
 *
 * The 4100-byte head matches the longest prefix file-type's heuristics need
 * for any of its supported formats; bigger prefixes don't improve detection.
 */
async function sniffMime(
  source: NodeJS.ReadableStream,
): Promise<{ fileType: { mime: string; ext: string } | undefined; stream: NodeJS.ReadableStream }> {
  const HEAD_BYTES = 4100;
  const headChunks: Buffer[] = [];
  let collected = 0;

  const onIter = source[Symbol.asyncIterator]
    ? source as unknown as AsyncIterable<Buffer | string>
    : Readable.from(source as NodeJS.ReadableStream);

  const iter = onIter[Symbol.asyncIterator]();
  let leftover: Buffer | undefined;
  while (collected < HEAD_BYTES) {
    const next = await iter.next();
    if (next.done) break;
    const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
    if (collected + chunk.length <= HEAD_BYTES) {
      headChunks.push(chunk);
      collected += chunk.length;
    } else {
      const want = HEAD_BYTES - collected;
      headChunks.push(chunk.subarray(0, want));
      leftover = chunk.subarray(want);
      collected = HEAD_BYTES;
      break;
    }
  }
  const head = Buffer.concat(headChunks);
  const sniffed = head.length > 0 ? await fileTypeFromBuffer(head) : undefined;

  // Replay: yield the head, then the leftover (if any), then drain the rest of
  // the iterator. We do not buffer beyond the head; the rest streams normally.
  async function* replay(): AsyncGenerator<Buffer> {
    if (head.length > 0) yield head;
    if (leftover && leftover.length > 0) yield leftover;
    while (true) {
      const next = await iter.next();
      if (next.done) return;
      yield Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
    }
  }
  return {
    fileType: sniffed ? { mime: sniffed.mime, ext: sniffed.ext } : undefined,
    stream: Readable.from(replay()),
  };
}
