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
import { Readable, Transform } from 'node:stream';
import { ERROR_CODES } from '@endora-commerce/contracts';

import { Asset } from '../entities/asset.entity.js';
import { HttpError } from '@endora-commerce/platform/http';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { AdapterRegistry } from './storage/adapter-registry.js';
import type { AssetVisibility, StorageAdapter } from './storage/storage-adapter.js';
import { isActiveDocument, isSvg, SVG_MIME } from './content-policy.js';
import { cloudContentDisposition } from './asset-urls.js';


/** The sentence a storage failure answers with: generic, whatever the adapter said. */
export const STORAGE_UNAVAILABLE_MESSAGE = 'The file storage is unavailable. Try again later.';

/**
 * A storage failure as the API answers it (security review): `503` with the
 * generic sentence, never the adapter's own text — which can name an absolute
 * path, a bucket or an endpoint. The adapter error rides along as `cause`, so
 * the platform's 5xx log line carries the detail an operator needs.
 */
export function storageUnavailable(err: unknown): HttpError {
  const error = new HttpError(503, ERROR_CODES.ASSET_STORAGE_UNAVAILABLE, STORAGE_UNAVAILABLE_MESSAGE);
  error.cause = err;
  return error;
}

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
  /** Feature 054 — audits the asset insert co-transactionally when provided. */
  auditLog?: AuditPort;
}

const KIND_BY_MIME_PREFIX: Array<[string, Asset['kind']]> = [
  ['image/', 'image'],
  ['video/', 'video'],
  ['application/pdf', 'pdf'],
];

export function mimeToKind(mime: string): Asset['kind'] {
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

function refuseActiveDocument(): never {
  throw new HttpError(
    415,
    ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED,
    'HTML, XHTML, XML and JavaScript files cannot be uploaded to the media library.',
    // Issue #86 — the token picks the sentence that names the refused types;
    // the base sentence is the one `crm` and `projects` raise without one.
    { code: 'active_content' },
  );
}

/**
 * 415 for a type `assets.allowed_file_types` does not list. `details` carries
 * the refused type and the allowed list as scalars, because only scalar
 * members become the bundle sentence's `{placeholder}` values (issue #86).
 */
function notAllowedByPolicy(message: string, fileType: string, allowedTypes: readonly string[]): HttpError {
  return new HttpError(415, ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED, message, {
    code: 'not_allowed_by_policy',
    fileType,
    allowedTypes: allowedTypes.join(', ') || '(none)',
  });
}

/**
 * The type an upload is stored and later served as.
 *
 * Content `file-type` recognises is stored as what it is. Text formats it
 * cannot recognise fall back to what the request declared — except that a
 * document a browser would run (by declared type or by file name) is refused
 * whatever the configured policy says, and an SVG is always stored as
 * `image/svg+xml`, the one type the file route serves it under.
 */
function storedMimeFor(
  input: { filename: string; declaredMime: string },
  sniffed: string | undefined,
): string {
  if (sniffed) {
    if (isActiveDocument({ filename: '', mimeType: sniffed })) refuseActiveDocument();
    return sniffed;
  }
  const declared = { filename: input.filename, mimeType: input.declaredMime ?? '' };
  if (isActiveDocument(declared)) refuseActiveDocument();
  if (isSvg(declared)) return SVG_MIME;
  return input.declaredMime || 'application/octet-stream';
}

/** One staged write: the file checked against the policy and streamed to `locator`. */
export interface StageInput {
  /** The adapter of the backend the object is written to. */
  adapter: StorageAdapter;
  locator: string;
  filename: string;
  declaredMime: string;
  stream: NodeJS.ReadableStream;
  /** Best-effort byte count from headers; `0` when unknown. */
  declaredSize: number;
  visibility: AssetVisibility;
  /**
   * A hard ceiling on the bytes actually streamed, whatever the configured
   * policy allows — the 5 GiB a single S3 request accepts, for a replace of an
   * S3 asset (specs/156-asset-stable-url/ research R-1).
   */
  sizeCapBytes?: number;
}

export interface StageResult {
  /** The type the object is stored and served as. */
  storedMime: string;
  /** What the bytes were recognised as; `undefined` when nothing was. */
  detectedMime: string | undefined;
  /** The bytes actually streamed (the declared size when none were counted). */
  sizeBytes: number;
}

const MIB = 1024 * 1024;

function tooLarge(maxFileSizeMb: number, message: string): HttpError {
  return new HttpError(
    413,
    ERROR_CODES.ASSET_UPLOAD_TOO_LARGE,
    message,
    // Issue #86 — the figure the bundle sentence names, in megabytes.
    { maxFileSizeMb },
  );
}

/** Raised inside the counting stream; turned into the 413 once `put` has failed on it. */
class SizeCapExceeded extends Error {
  override readonly name = 'SizeCapExceeded';
}

export class UploadPipeline {
  constructor(private readonly deps: UploadPipelineDeps) {}

  /**
   * The checks and the write an upload and a replace share
   * (specs/156-asset-stable-url/ research R-4): the size pre-flight, the
   * declared-type check, the sniff, `storedMimeFor` (documents a browser would
   * run are refused, an SVG is stored as `image/svg+xml`), the sniffed-type
   * re-check, and the counting `put` with the cloud object metadata. Writes no
   * row. On a refusal before the `put`, nothing is written.
   */
  async stage(input: StageInput): Promise<StageResult> {
    const policy = await this.deps.loadPolicy();
    const ext = extensionOf(input.filename);

    // — Pre-flight (cheap rejections before touching the adapter) —
    if (
      policy.maxFileSizeMb > 0 &&
      input.declaredSize > 0 &&
      input.declaredSize > policy.maxFileSizeMb * MIB
    ) {
      throw tooLarge(
        policy.maxFileSizeMb,
        `File exceeds the configured maximum of ${policy.maxFileSizeMb} MB.`,
      );
    }
    const capMb = input.sizeCapBytes !== undefined ? Math.floor(input.sizeCapBytes / MIB) : 0;
    if (input.sizeCapBytes !== undefined && input.declaredSize > input.sizeCapBytes) {
      throw tooLarge(capMb, `File exceeds the ${capMb} MB a single storage request accepts.`);
    }
    if (
      !isAllowed(policy.allowedTypes, input.declaredMime, ext)
    ) {
      const fileType = input.declaredMime || ext || 'unknown';
      throw notAllowedByPolicy(
        `File type "${fileType}" is not allowed by the active policy. Allowed: ${policy.allowedTypes.join(', ') || '(none)'}.`,
        fileType,
        policy.allowedTypes,
      );
    }

    // — MIME sniff via file-type/stream —
    // The library returns a wrapped stream we consume in place of the original;
    // the wrapper replays the head bytes so the adapter still gets the full file.
    const { fileType, stream: sniffedStream } = await sniffMime(input.stream);
    const sniffedMime = storedMimeFor(input, fileType?.mime);

    // Re-check allow-list using the *sniffed* MIME (defends against spoofed
    // Content-Type) — the stricter check decides per spec edge case.
    if (
      sniffedMime !== input.declaredMime &&
      !isAllowed(policy.allowedTypes, sniffedMime, ext)
    ) {
      throw notAllowedByPolicy(
        `File content reports type "${sniffedMime}", which is not allowed by the active policy. Allowed: ${policy.allowedTypes.join(', ') || '(none)'}.`,
        sniffedMime,
        policy.allowedTypes,
      );
    }

    // — Stream into the adapter (storage-first commit) —
    // Multipart parts frequently carry no per-part Content-Length, so
    // `declaredSize` is often 0. Count the bytes as they flow to the adapter so
    // the persisted `sizeBytes` is accurate; the file-serving route sends this
    // value as `Content-Length`, and a wrong 0 makes browsers render an empty
    // image (broken preview in admin and missing placeholder on the storefront).
    //
    // The counted bytes are held to the live policy too: a multipart part
    // declares no size, so the pre-flight above cannot see it, and the parser's
    // own limit is the one read at boot.
    const policyCapBytes = policy.maxFileSizeMb > 0 ? policy.maxFileSizeMb * MIB : undefined;
    const usePolicyCap =
      policyCapBytes !== undefined &&
      (input.sizeCapBytes === undefined || policyCapBytes <= input.sizeCapBytes);
    const cap = usePolicyCap ? policyCapBytes : input.sizeCapBytes;
    let observedSize = 0;
    let capExceeded = false;
    const countingStream = sniffedStream.pipe(
      new Transform({
        transform(chunk: Buffer, _enc, cb): void {
          observedSize += chunk.length;
          if (cap !== undefined && observedSize > cap) {
            capExceeded = true;
            cb(new SizeCapExceeded(`more than ${cap} bytes`));
            return;
          }
          cb(null, chunk);
        },
      }),
    );
    // The cap can trip before the adapter attaches to the stream (the local
    // adapter creates its directory first). The error stays on the stream for
    // the adapter to read; this only keeps it from being reported as uncaught.
    countingStream.on('error', () => undefined);
    try {
      await input.adapter.put({
        locator: input.locator,
        mimeType: sniffedMime,
        visibility: input.visibility,
        stream: countingStream,
        sizeBytes: input.declaredSize,
        cacheControl: 'no-cache',
        contentDisposition: cloudContentDisposition(sniffedMime, input.filename),
      });
    } catch (err) {
      if (capExceeded) {
        throw usePolicyCap
          ? tooLarge(
              policy.maxFileSizeMb,
              `File exceeds the configured maximum of ${policy.maxFileSizeMb} MB.`,
            )
          : tooLarge(capMb, `File exceeds the ${capMb} MB a single storage request accepts.`);
      }
      throw storageUnavailable(err);
    }

    return {
      storedMime: sniffedMime,
      detectedMime: fileType?.mime,
      sizeBytes: observedSize > 0 ? observedSize : input.declaredSize,
    };
  }

  async run(input: UploadInput): Promise<Asset> {
    // — Allocate id, locator —
    const assetId = randomUUID();
    const adapter = await this.deps.adapters.getActive();
    const locator = adapter.newLocator({
      assetId,
      originalFilename: input.filename,
    });

    const staged = await this.stage({
      adapter,
      locator,
      filename: input.filename,
      declaredMime: input.declaredMime,
      stream: input.stream,
      declaredSize: input.declaredSize,
      visibility: input.visibility,
    });
    const sniffedMime = staged.storedMime;

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
        sizeBytes: String(staged.sizeBytes),
        storageUrl: publicForm.url,
        storageLocator: locator,
        storageBackend: adapter.code,
        visibility: input.visibility,
        ...(input.folderId ? { folderId: input.folderId } : {}),
        ...(input.label ? { label: input.label } : {}),
      });
      em.persist(asset);
      if (this.deps.auditLog) {
        recordAuditFromContext(this.deps.auditLog, em, {
          action: 'asset.upload',
          objectType: 'asset',
          objectId: asset.id,
          stateBefore: null,
          stateAfter: { filename: asset.filename, kind: asset.kind, visibility: asset.visibility },
        });
      }
      await em.flush();
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
