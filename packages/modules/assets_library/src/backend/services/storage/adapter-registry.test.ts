import { describe, expect, it } from 'vitest';

import { AdapterRegistry } from './adapter-registry.js';
import { HmacSigner } from '../hmac.js';
import { ConfigurationError } from './errors.js';
import { LocalFsStorageAdapter } from './local-fs-adapter.js';
import { legacyAssetResolver } from './legacy-resolver.js';

const KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

function makeRegistry(active: 'local' | 's3' | 'gcs') {
  return new AdapterRegistry({
    settings: {
      activeAdapter: async () => active,
      localBaseDir: async () => '/tmp/assets',
      localPublicUrlBase: async () => 'http://localhost:3001',
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

  it('getForBackend("legacy") returns the legacy resolver', async () => {
    const registry = makeRegistry('local');
    const a = await registry.getForBackend('legacy');
    expect(a).toBe(legacyAssetResolver);
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
