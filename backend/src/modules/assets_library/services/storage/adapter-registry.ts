// AdapterRegistry — chooses the active StorageAdapter from settings and
// caches it for the process lifetime. Per-asset reads dispatch to the
// adapter that owns that asset's bytes (recorded in `Asset.storageBackend`),
// not to the active adapter. The active adapter is consulted only at upload
// time and for self-check.
//
// Cloud adapters (S3, GCS) are stub-imported here; their concrete classes
// land in Phase 5 (US3) — until then, attempting to switch the active
// adapter to s3/gcs raises a clear error.

import type { StorageAdapter, StorageBackendCode } from './storage-adapter.js';
import { LocalFsStorageAdapter } from './local-fs-adapter.js';
import { legacyAssetResolver } from './legacy-resolver.js';
import { ConfigurationError } from './errors.js';
import { HmacSigner } from '../hmac.js';

/**
 * The minimum settings surface AdapterRegistry needs. The composition root
 * supplies an implementation backed by SettingsService (real) or by a static
 * map (tests).
 */
export interface AdapterSettingsView {
  /** Active adapter code: 'local' | 's3' | 'gcs'. */
  activeAdapter(): Promise<'local' | 's3' | 'gcs'>;
  /** Local-FS base directory (`assets.local.base_dir`). */
  localBaseDir(): Promise<string>;
  /** Public URL prefix for local-FS public assets. May be empty in dev. */
  localPublicUrlBase(): Promise<string>;
  /** Default TTL for private signed URLs (seconds). */
  privateUrlTtlSec(): Promise<number>;
}

export interface AdapterRegistryOptions {
  settings: AdapterSettingsView;
  /** Provider; invoked on first need so tests that never sign a URL can skip env setup. */
  signer: () => HmacSigner;
}

export class AdapterRegistry {
  private cached: { code: StorageBackendCode; adapter: StorageAdapter } | null = null;

  constructor(private readonly opts: AdapterRegistryOptions) {}

  /** Drop the cached active adapter. Called when settings change. */
  invalidate(): void {
    this.cached = null;
  }

  /** Return the adapter currently selected by settings. */
  async getActive(): Promise<StorageAdapter> {
    if (this.cached) return this.cached.adapter;
    const code = await this.opts.settings.activeAdapter();
    const adapter = await this.build(code);
    this.cached = { code, adapter };
    return adapter;
  }

  /**
   * Return the adapter that owns the given asset's bytes. Use this for read /
   * delete / setVisibility — never `getActive()`, which would silently route
   * a previously-uploaded asset to the wrong backend after a switch (FR-017).
   */
  async getForBackend(
    backend: StorageBackendCode,
  ): Promise<StorageAdapter | typeof legacyAssetResolver> {
    if (backend === 'legacy') return legacyAssetResolver;
    if (this.cached && this.cached.code === backend) return this.cached.adapter;
    return this.build(backend);
  }

  private async build(code: StorageBackendCode): Promise<StorageAdapter> {
    if (code === 'local') {
      const baseDir = await this.opts.settings.localBaseDir();
      const rawBase = (await this.opts.settings.localPublicUrlBase()).trim();
      const publicUrlBase = rawBase.length > 0 ? rawBase : '';
      const privateUrlTtlSec = await this.opts.settings.privateUrlTtlSec();
      return new LocalFsStorageAdapter({
        baseDir,
        publicUrlBase,
        privateUrlTtlSec,
        signer: this.opts.signer(),
      });
    }
    // S3 / GCS land in Phase 5 (US3 / T075–T076). Until then surface a
    // clear admin-facing error rather than booting into a non-functional state.
    if (code === 's3' || code === 'gcs') {
      throw new ConfigurationError(
        `StorageAdapter "${code}" is not yet implemented in this build (Phase 5 / US3 deliverable).`,
      );
    }
    throw new ConfigurationError(`Unknown storage backend: "${code}"`);
  }
}
