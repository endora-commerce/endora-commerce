// GCS storage adapter — feature 013 / US3 / T076.
// Wraps @google-cloud/storage. Storage layout matches the local-FS / S3
// sharded scheme; private URLs use V4 signed URLs.

import { Storage, type Bucket } from '@google-cloud/storage';
import type {
  StorageAdapter,
  StorageAdapterSelfCheck,
  StorageNewLocatorInput,
  StoragePutInput,
  StorageResolveUrlInput,
  StorageResolveUrlOutput,
} from './storage-adapter.js';
import { computeLocator } from './locator.js';
import { resolvePublicUrlBase } from './public-url-base.js';
import {
  BackendUnavailableError,
  ConfigurationError,
  LocatorMissingError,
} from './errors.js';

export interface GcsAdapterConfig {
  bucket: string;
  serviceAccountJson?: string;
  prefix?: string;
  /**
   * `assets.gcs.public_base_url` — a CDN or custom domain in front of the
   * bucket. Blank means the bucket's own origin, which is already absolute.
   */
  publicBaseUrl?: string;
  /**
   * This deployment's resolved public API origin — D-223's fallback base, with
   * the same bound as the S3 adapter's: it rescues a `publicBaseUrl` written as
   * a path, and a blank one keeps resolving to the bucket, which serves the
   * bytes this API does not.
   */
  publicApiBaseUrl: string;
  privateUrlTtlSec: number;
}

export class GcsStorageAdapter implements StorageAdapter {
  readonly code = 'gcs' as const;
  private readonly bucket: Bucket;
  /** The absolute base public object URLs are built on — decided once (D-223). */
  private readonly publicBase: string;

  constructor(private readonly cfg: GcsAdapterConfig) {
    if (!cfg.bucket) throw new ConfigurationError('GcsStorageAdapter: bucket is required');
    const configuredBase = (cfg.publicBaseUrl ?? '').trim();
    this.publicBase = resolvePublicUrlBase(
      configuredBase.length > 0
        ? configuredBase
        : `https://storage.googleapis.com/${cfg.bucket}`,
      cfg.publicApiBaseUrl,
    );
    let credentials: Record<string, unknown> | undefined;
    if (cfg.serviceAccountJson && cfg.serviceAccountJson.trim().length > 0) {
      try {
        credentials = JSON.parse(cfg.serviceAccountJson) as Record<string, unknown>;
      } catch (e) {
        throw new ConfigurationError(
          `GcsStorageAdapter: serviceAccountJson is not valid JSON (${(e as Error).message})`,
        );
      }
    }
    const storage = new Storage({
      ...(credentials ? { credentials } : {}),
    });
    this.bucket = storage.bucket(cfg.bucket);
  }

  async selfCheck(): Promise<StorageAdapterSelfCheck> {
    try {
      const [exists] = await this.bucket.exists();
      return exists ? { ok: true } : { ok: false, reason: `bucket "${this.cfg.bucket}" not found` };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  newLocator(input: StorageNewLocatorInput): string {
    const tail = computeLocator(input);
    const prefix = (this.cfg.prefix ?? '').replace(/^\/+|\/+$/g, '');
    return prefix.length > 0 ? `${prefix}/${tail}` : tail;
  }

  async put(input: StoragePutInput): Promise<void> {
    if (!input.locator) throw new LocatorMissingError('GcsStorageAdapter.put: empty locator');
    return new Promise<void>((resolve, reject) => {
      const writeStream = this.bucket.file(input.locator).createWriteStream({
        metadata: { contentType: input.mimeType },
        ...(input.visibility === 'public' ? { predefinedAcl: 'publicRead' } : { predefinedAcl: 'private' }),
        resumable: false,
      });
      input.stream.pipe(writeStream);
      writeStream.on('finish', () => resolve());
      writeStream.on('error', (err) =>
        reject(
          new BackendUnavailableError(
            `GcsStorageAdapter.put: failed to persist ${input.locator}`,
            err,
          ),
        ),
      );
    });
  }

  async resolveUrl(input: StorageResolveUrlInput): Promise<StorageResolveUrlOutput> {
    if (input.visibility === 'public') {
      return { url: `${this.publicBase}/${input.locator}`, expiresAt: null };
    }
    const ttl = input.ttlSec ?? this.cfg.privateUrlTtlSec;
    if (!Number.isInteger(ttl) || ttl <= 0) {
      throw new ConfigurationError(`GcsStorageAdapter.resolveUrl: invalid TTL ${ttl}`);
    }
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const [url] = await this.bucket.file(input.locator).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expiresAt.getTime(),
    });
    return { url, expiresAt };
  }

  async open(input: { locator: string }): Promise<NodeJS.ReadableStream> {
    return this.bucket.file(input.locator).createReadStream();
  }

  async delete(input: { locator: string }): Promise<void> {
    try {
      await this.bucket.file(input.locator).delete({ ignoreNotFound: false });
    } catch (e) {
      throw new BackendUnavailableError(
        `GcsStorageAdapter.delete: failed to remove ${input.locator}`,
        e,
      );
    }
  }

  async setVisibility(input: {
    locator: string;
    visibility: 'public' | 'private';
  }): Promise<void> {
    const acl = this.bucket.file(input.locator).acl;
    try {
      if (input.visibility === 'public') {
        await acl.add({ entity: 'allUsers', role: 'READER' });
      } else {
        await acl.delete({ entity: 'allUsers' });
      }
    } catch (e) {
      throw new BackendUnavailableError(
        `GcsStorageAdapter.setVisibility: failed on ${input.locator}`,
        e,
      );
    }
  }
}
