// S3 storage adapter — feature 013 / US3 / T075.
// Wraps @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner. Storage layout
// matches the local-FS adapter (sharded path scheme); private URLs use V4
// pre-signed GetObject.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  DeleteObjectCommand,
  PutObjectAclCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

export interface S3AdapterConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  prefix?: string;
  /**
   * `assets.s3.public_base_url` — a CDN or a custom domain in front of the
   * bucket. Blank means "serve from the bucket's own origin", which is already
   * absolute; see {@link S3AdapterConfig.publicApiBaseUrl}.
   */
  publicBaseUrl?: string;
  /**
   * This deployment's resolved public API origin — D-223's fallback base.
   *
   * It is consulted here for one case: a `publicBaseUrl` the operator wrote as
   * a **path** (`/media`), which would otherwise make this adapter produce a
   * host-relative URL. A *blank* one keeps resolving to the bucket, because
   * pointing an S3 object at this API's origin would name a host that does not
   * serve those bytes — D-223's invariant is that the URL is absolute, and the
   * bucket URL already is.
   */
  publicApiBaseUrl: string;
  privateUrlTtlSec: number;
}

export class S3StorageAdapter implements StorageAdapter {
  readonly code = 's3' as const;
  private readonly client: S3Client;
  /** The absolute base public object URLs are built on — decided once (D-223). */
  private readonly publicBase: string;

  constructor(private readonly cfg: S3AdapterConfig) {
    if (!cfg.bucket) throw new ConfigurationError('S3StorageAdapter: bucket is required');
    if (!cfg.region) throw new ConfigurationError('S3StorageAdapter: region is required');
    const configured = (cfg.publicBaseUrl ?? '').trim();
    this.publicBase = resolvePublicUrlBase(
      configured.length > 0
        ? configured
        : `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com`,
      cfg.publicApiBaseUrl,
    );
    this.client = new S3Client({
      region: cfg.region,
      ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
      ...(cfg.accessKeyId
        ? {
            credentials: {
              accessKeyId: cfg.accessKeyId,
              secretAccessKey: cfg.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async selfCheck(): Promise<StorageAdapterSelfCheck> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
      return { ok: true };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      return { ok: false, reason };
    }
  }

  newLocator(input: StorageNewLocatorInput): string {
    const tail = computeLocator(input);
    const prefix = (this.cfg.prefix ?? '').replace(/^\/+|\/+$/g, '');
    return prefix.length > 0 ? `${prefix}/${tail}` : tail;
  }

  async put(input: StoragePutInput): Promise<void> {
    if (!input.locator) throw new LocatorMissingError('S3StorageAdapter.put: empty locator');
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.cfg.bucket,
          Key: input.locator,
          Body: input.stream as never,
          ContentType: input.mimeType,
          ContentLength: input.sizeBytes > 0 ? input.sizeBytes : undefined,
          ACL: input.visibility === 'public' ? 'public-read' : 'private',
        }),
      );
    } catch (e) {
      throw new BackendUnavailableError(
        `S3StorageAdapter.put: failed to persist ${input.locator}`,
        e,
      );
    }
  }

  async resolveUrl(input: StorageResolveUrlInput): Promise<StorageResolveUrlOutput> {
    if (input.visibility === 'public') {
      return { url: `${this.publicBase}/${input.locator}`, expiresAt: null };
    }
    const ttl = input.ttlSec ?? this.cfg.privateUrlTtlSec;
    if (!Number.isInteger(ttl) || ttl <= 0) {
      throw new ConfigurationError(`S3StorageAdapter.resolveUrl: invalid TTL ${ttl}`);
    }
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: input.locator }),
      { expiresIn: ttl },
    );
    return { url, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  async open(input: { locator: string }): Promise<NodeJS.ReadableStream> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: input.locator }),
    );
    if (!out.Body) {
      throw new BackendUnavailableError(`S3StorageAdapter.open: no body for ${input.locator}`);
    }
    return out.Body as NodeJS.ReadableStream;
  }

  async delete(input: { locator: string }): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: input.locator }),
      );
    } catch (e) {
      throw new BackendUnavailableError(
        `S3StorageAdapter.delete: failed to remove ${input.locator}`,
        e,
      );
    }
  }

  async setVisibility(input: {
    locator: string;
    visibility: 'public' | 'private';
  }): Promise<void> {
    try {
      await this.client.send(
        new PutObjectAclCommand({
          Bucket: this.cfg.bucket,
          Key: input.locator,
          ACL: input.visibility === 'public' ? 'public-read' : 'private',
        }),
      );
    } catch (e) {
      throw new BackendUnavailableError(
        `S3StorageAdapter.setVisibility: failed on ${input.locator}`,
        e,
      );
    }
  }
}
