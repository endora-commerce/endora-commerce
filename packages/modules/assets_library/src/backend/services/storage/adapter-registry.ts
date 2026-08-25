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
import { S3StorageAdapter } from './s3-adapter.js';
import { GcsStorageAdapter } from './gcs-adapter.js';
import { legacyAssetResolver } from './legacy-resolver.js';
import { ConfigurationError } from './errors.js';
import type { HmacSigner } from '../hmac.js';

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
  /** S3-adapter configuration. */
  s3Config(): Promise<{
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint?: string;
    prefix?: string;
    publicBaseUrl?: string;
  }>;
  /** GCS-adapter configuration. */
  gcsConfig(): Promise<{
    bucket: string;
    serviceAccountJson?: string;
    prefix?: string;
    publicBaseUrl?: string;
  }>;
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
    if (code === 's3') {
      const cfg = await this.opts.settings.s3Config();
      const ttl = await this.opts.settings.privateUrlTtlSec();
      return new S3StorageAdapter({
        bucket: cfg.bucket,
        region: cfg.region,
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        ...(cfg.endpoint !== undefined && cfg.endpoint.length > 0
          ? { endpoint: cfg.endpoint }
          : {}),
        ...(cfg.prefix !== undefined && cfg.prefix.length > 0 ? { prefix: cfg.prefix } : {}),
        ...(cfg.publicBaseUrl !== undefined && cfg.publicBaseUrl.length > 0
          ? { publicBaseUrl: cfg.publicBaseUrl }
          : {}),
        privateUrlTtlSec: ttl,
      });
    }
    if (code === 'gcs') {
      const cfg = await this.opts.settings.gcsConfig();
      const ttl = await this.opts.settings.privateUrlTtlSec();
      return new GcsStorageAdapter({
        bucket: cfg.bucket,
        ...(cfg.serviceAccountJson !== undefined && cfg.serviceAccountJson.length > 0
          ? { serviceAccountJson: cfg.serviceAccountJson }
          : {}),
        ...(cfg.prefix !== undefined && cfg.prefix.length > 0 ? { prefix: cfg.prefix } : {}),
        ...(cfg.publicBaseUrl !== undefined && cfg.publicBaseUrl.length > 0
          ? { publicBaseUrl: cfg.publicBaseUrl }
          : {}),
        privateUrlTtlSec: ttl,
      });
    }
    throw new ConfigurationError(`Unknown storage backend: "${code}"`);
  }
}
