// Local filesystem storage adapter. Files live under a configurable base
// directory (settings: `assets.local.baseDir`, default `var/assets`) using
// the sharded path scheme from research.md R5.
//
// Public URLs are stable (`/assets/file/<assetId>`), served by routes.public.ts.
// Private URLs append `?token=<hmac>&exp=<unix>` validated by the same route.

import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rename, stat, unlink, access, constants as fsConstants } from 'node:fs/promises';
import { dirname, join, isAbsolute } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

import type {
  StorageAdapter,
  StorageAdapterSelfCheck,
  StorageNewLocatorInput,
  StoragePutInput,
  StorageResolveUrlInput,
  StorageResolveUrlOutput,
} from './storage-adapter.js';
import { computeLocator } from './locator.js';
import { HmacSigner } from '../hmac.js';
import {
  BackendUnavailableError,
  ConfigurationError,
  LocatorMissingError,
} from './errors.js';

export interface LocalFsAdapterOptions {
  /** Filesystem root that holds every asset. */
  baseDir: string;
  /** Public-facing URL prefix (no trailing slash). Used for public asset URLs. */
  publicUrlBase: string;
  /** TTL for private URL signatures, in seconds. */
  privateUrlTtlSec: number;
  /** HMAC signer for private URLs. */
  signer: HmacSigner;
  /** Now-source — injectable for tests. */
  now?: () => Date;
}

export class LocalFsStorageAdapter implements StorageAdapter {
  readonly code = 'local' as const;

  constructor(private readonly opts: LocalFsAdapterOptions) {
    if (!isAbsolute(opts.baseDir)) {
      // Resolve relative to process cwd at construction time so we never
      // accidentally write outside the configured tree.
      this.opts = { ...opts, baseDir: join(process.cwd(), opts.baseDir) };
    }
  }

  async selfCheck(): Promise<StorageAdapterSelfCheck> {
    try {
      await access(this.opts.baseDir, fsConstants.W_OK | fsConstants.R_OK);
      const s = await stat(this.opts.baseDir);
      if (!s.isDirectory()) {
        return { ok: false, reason: `Base path is not a directory: ${this.opts.baseDir}` };
      }
      return { ok: true };
    } catch (e) {
      // ENOENT → try to create it; that's a recoverable misconfig.
      const reason = e instanceof Error ? e.message : String(e);
      return { ok: false, reason };
    }
  }

  newLocator(input: StorageNewLocatorInput): string {
    return computeLocator(input);
  }

  async put(input: StoragePutInput): Promise<void> {
    if (!input.locator) throw new LocatorMissingError('LocalFsStorageAdapter.put: empty locator');
    const abs = this.toAbsolute(input.locator);
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    try {
      await pipeline(input.stream, createWriteStream(tmp));
    } catch (e) {
      // Best-effort cleanup of the temp file.
      try { await unlink(tmp); } catch { /* ignore */ }
      throw new BackendUnavailableError(
        `LocalFsStorageAdapter.put: failed writing ${input.locator}`,
        e,
      );
    }
    try {
      await rename(tmp, abs);
    } catch (e) {
      try { await unlink(tmp); } catch { /* ignore */ }
      throw new BackendUnavailableError(
        `LocalFsStorageAdapter.put: failed renaming temp into place at ${input.locator}`,
        e,
      );
    }
  }

  async resolveUrl(input: StorageResolveUrlInput): Promise<StorageResolveUrlOutput> {
    const assetId = parseAssetIdFromLocator(input.locator);
    const base = this.opts.publicUrlBase.replace(/\/+$/, '');
    if (input.visibility === 'public') {
      return { url: `${base}/assets/file/${assetId}`, expiresAt: null };
    }
    const ttl = input.ttlSec ?? this.opts.privateUrlTtlSec;
    if (!Number.isInteger(ttl) || ttl <= 0) {
      throw new ConfigurationError(`LocalFsStorageAdapter.resolveUrl: invalid TTL ${ttl}`);
    }
    const now = this.opts.now ?? (() => new Date());
    const exp = Math.floor(now().getTime() / 1000) + ttl;
    const token = this.opts.signer.sign({ assetId, exp });
    return {
      url: `${base}/assets/file/${assetId}?token=${token}&exp=${exp}`,
      expiresAt: new Date(exp * 1000),
    };
  }

  async open(input: { locator: string }): Promise<ReadStream> {
    const abs = this.toAbsolute(input.locator);
    try {
      // stat first so a missing file produces a recognizable error path.
      await stat(abs);
    } catch (e) {
      throw new BackendUnavailableError(`LocalFsStorageAdapter.open: missing file ${abs}`, e);
    }
    return createReadStream(abs);
  }

  async delete(input: { locator: string }): Promise<void> {
    const abs = this.toAbsolute(input.locator);
    try {
      await unlink(abs);
    } catch (e) {
      // ENOENT is treated as failure here — the worker (FR-031) needs the
      // backend to confirm removal; if the file is already gone we still
      // need an explicit signal. Caller decides whether that's recoverable.
      throw new BackendUnavailableError(
        `LocalFsStorageAdapter.delete: cannot remove ${abs}`,
        e,
      );
    }
  }

  /**
   * Visibility on local-FS is enforced per-request by routes.public.ts (it
   * reads the asset's current visibility live and demands a token for
   * private). No server-side state to flip — no-op.
   */
  async setVisibility(): Promise<void> {
    /* no-op */
  }

  private toAbsolute(locator: string): string {
    if (locator.startsWith('/')) {
      throw new LocatorMissingError(
        `LocalFsStorageAdapter: locator must be relative, got "${locator}"`,
      );
    }
    return join(this.opts.baseDir, locator);
  }
}

export function parseAssetIdFromLocator(locator: string): string {
  // Locators produced by computeLocator look like `aa/bb/<uuid>.<ext>`.
  // We extract the basename's UUID portion (everything before the first dot).
  const last = locator.split('/').pop() ?? '';
  const dotIdx = last.indexOf('.');
  const id = dotIdx >= 0 ? last.slice(0, dotIdx) : last;
  if (id.length < 4) {
    throw new LocatorMissingError(
      `parseAssetIdFromLocator: cannot extract asset id from "${locator}"`,
    );
  }
  return id;
}
