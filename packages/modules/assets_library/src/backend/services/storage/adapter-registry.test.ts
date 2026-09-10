import { describe, expect, it } from 'vitest';

import { AdapterRegistry } from './adapter-registry.js';
import { HmacSigner } from '../hmac.js';
import { ConfigurationError } from './errors.js';
import { LocalFsStorageAdapter } from './local-fs-adapter.js';
import { S3StorageAdapter } from './s3-adapter.js';

const KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const API_ORIGIN = 'https://api.example.test';
const LOCATOR = 'aa/bb/aabbccdd-1111-2222-3333-444455556666.jpg';

function makeRegistry(
  active: 'local' | 's3' | 'gcs',
  overrides: Partial<{ localPublicUrlBase: string; s3PublicBaseUrl: string }> = {},
) {
  return new AdapterRegistry({
    settings: {
      activeAdapter: async () => active,
      localBaseDir: async () => '/tmp/assets',
      localPublicUrlBase: async () => overrides.localPublicUrlBase ?? 'http://localhost:3001',
      privateUrlTtlSec: async () => 300,
      s3Config: async () => ({
        bucket: '',
        region: '',
        accessKeyId: '',
        secretAccessKey: '',
      }),
      gcsConfig: async () => ({ bucket: '' }),
    },
    signer: () => HmacSigner.fromEnv(KEY_HEX),
    publicApiBaseUrl: API_ORIGIN,
  });
}

/** A registry whose S3 configuration is complete enough to build an adapter. */
function makeS3Registry(publicBaseUrl: string) {
  return new AdapterRegistry({
    settings: {
      activeAdapter: async () => 's3',
      localBaseDir: async () => '/tmp/assets',
      localPublicUrlBase: async () => '',
      privateUrlTtlSec: async () => 300,
      s3Config: async () => ({
        bucket: 'shop-media',
        region: 'eu-central-1',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        publicBaseUrl,
      }),
      gcsConfig: async () => ({ bucket: '' }),
    },
    signer: () => HmacSigner.fromEnv(KEY_HEX),
    publicApiBaseUrl: API_ORIGIN,
  });
}

describe('AdapterRegistry', () => {
  it('returns a LocalFsStorageAdapter when active = local', async () => {
    const registry = makeRegistry('local');
    const a = await registry.getActive();
    expect(a).toBeInstanceOf(LocalFsStorageAdapter);
    expect(a.code).toBe('local');
  });

  it('caches the active adapter across calls', async () => {
    const registry = makeRegistry('local');
    const a = await registry.getActive();
    const b = await registry.getActive();
    expect(a).toBe(b);
  });

  it('invalidate() forces a fresh build on next getActive()', async () => {
    const registry = makeRegistry('local');
    const a = await registry.getActive();
    registry.invalidate();
    const b = await registry.getActive();
    expect(a).not.toBe(b);
  });

  it('throws ConfigurationError when active = s3 with empty bucket', async () => {
    const registry = makeRegistry('s3');
    await expect(registry.getActive()).rejects.toBeInstanceOf(ConfigurationError);
  });

  it('throws ConfigurationError when active = gcs with empty bucket', async () => {
    const registry = makeRegistry('gcs');
    await expect(registry.getActive()).rejects.toBeInstanceOf(ConfigurationError);
  });

  it('getForBackend("legacy") returns the legacy resolver, on this origin', async () => {
    const registry = makeRegistry('local');
    const a = await registry.getForBackend('legacy');
    // Behaviour rather than identity: the resolver is built per call now,
    // because D-223 gave it the deployment's origin to rebase onto. A legacy
    // row whose `storage_url` is a full URL is still served verbatim.
    expect(a.resolveUrl({ locator: '/uploads/legacy.png', visibility: 'public' }).url).toBe(
      `${API_ORIGIN}/uploads/legacy.png`,
    );
    expect(
      a.resolveUrl({ locator: 'https://old.example.test/legacy.png', visibility: 'public' }).url,
    ).toBe('https://old.example.test/legacy.png');
  });

  /**
   * D-223 — the registry is what hands each backend the deployment's origin, so
   * every adapter it builds produces absolute URLs. A blank
   * `assets.local.public_url_base` is the configuration the shipped defaults
   * ship with, and it used to produce `/assets/file/<id>`.
   */
  it('builds a local adapter that falls back to the API origin', async () => {
    const registry = makeRegistry('local', { localPublicUrlBase: '' });
    const adapter = await registry.getActive();
    const out = await adapter.resolveUrl({ locator: LOCATOR, visibility: 'public' });
    expect(out.url).toBe(`${API_ORIGIN}/assets/file/aabbccdd-1111-2222-3333-444455556666`);
  });

  it('keeps an explicitly configured local base ahead of the API origin', async () => {
    const registry = makeRegistry('local', { localPublicUrlBase: 'https://cdn.example.test' });
    const adapter = await registry.getActive();
    const out = await adapter.resolveUrl({ locator: LOCATOR, visibility: 'public' });
    expect(out.url).toBe('https://cdn.example.test/assets/file/aabbccdd-1111-2222-3333-444455556666');
  });

  /**
   * The bound the S3 and GCS adapters carry, asserted so it cannot be "fixed"
   * into a defect: a **blank** cloud public base keeps resolving to the bucket.
   * Substituting this API's origin there would name a host that does not serve
   * those bytes, and D-223's invariant is that the URL is absolute — which the
   * bucket URL already is.
   */
  it('leaves a blank S3 public base resolving to the bucket, not to the API', async () => {
    const registry = makeS3Registry('');
    const adapter = await registry.getActive();
    expect(adapter).toBeInstanceOf(S3StorageAdapter);
    const out = await adapter.resolveUrl({ locator: 'media/hero.jpg', visibility: 'public' });
    expect(out.url).toBe('https://shop-media.s3.eu-central-1.amazonaws.com/media/hero.jpg');
  });

  it('rebases an S3 public base an operator wrote as a path', async () => {
    const registry = makeS3Registry('/media');
    const adapter = await registry.getActive();
    const out = await adapter.resolveUrl({ locator: 'hero.jpg', visibility: 'public' });
    expect(out.url).toBe(`${API_ORIGIN}/media/hero.jpg`);
  });

  it('getForBackend("local") returns a local adapter even when active is s3', async () => {
    const registry = makeRegistry('s3');
    // active is s3 (would throw on getActive), but getForBackend('local') uses
    // the asset's own backend code. This protects FR-017: previously-uploaded
    // local assets keep resolving after the operator switches to s3.
    const a = await registry.getForBackend('local');
    expect(a).toBeInstanceOf(LocalFsStorageAdapter);
  });
});
