/**
 * Per-request asset-byte fetcher used by the PDF renderer
 * (research.md R-8 / feature 007 / T054).
 *
 * pdfmake accepts inline base64 image data — but the bytes have to come
 * from somewhere. The renderer asks this fetcher for each base-image
 * URL it found on the comparison's products. We:
 *
 *   - fetch the bytes (HTTP for remote URLs, file-system read for
 *     `file://` URLs and any path-shaped string the assets module
 *     emits for local storage),
 *   - cache the result in a per-request `Map<key, Buffer>` so the same
 *     image is never fetched twice within one PDF render,
 *   - fall back to {@link IMAGE_FALLBACK_BYTES} (a 1×1 transparent PNG)
 *     on any failure — fetch error, non-2xx, network timeout — so the
 *     PDF still renders rather than 503'ing the whole export
 *     (spec FR-018).
 *
 * Construct one fetcher per request; do not reuse across renders.
 */

import { readFile } from 'node:fs/promises';

/** 1×1 transparent PNG. Used when an image is unavailable. */
export const IMAGE_FALLBACK_BYTES: Buffer = Buffer.from(
  // 67-byte minimal transparent PNG.
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=',
  'base64',
);

export class AssetByteFetcher {
  private readonly cache = new Map<string, Buffer>();
  /** Per-fetch timeout — short; we'd rather fall back than block the PDF response. */
  private readonly timeoutMs: number;

  constructor(opts: { timeoutMs?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 3_000;
  }

  /**
   * Fetch the bytes at `url`. Returns {@link IMAGE_FALLBACK_BYTES} on any
   * failure. Cached per-instance.
   */
  async fetch(url: string): Promise<Buffer> {
    const cached = this.cache.get(url);
    if (cached) return cached;
    const bytes = await this.#read(url).catch(() => IMAGE_FALLBACK_BYTES);
    this.cache.set(url, bytes);
    return bytes;
  }

  async #read(url: string): Promise<Buffer> {
    if (url.startsWith('file://')) {
      return readFile(new URL(url));
    }
    if (url.startsWith('/') || url.startsWith('./')) {
      // Bare filesystem path the assets module sometimes emits.
      return readFile(url);
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arr = new Uint8Array(await res.arrayBuffer());
        return Buffer.from(arr);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`unsupported URL scheme: ${url}`);
  }
}
