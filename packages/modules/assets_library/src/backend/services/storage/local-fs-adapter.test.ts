import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { LocalFsStorageAdapter } from './local-fs-adapter.js';
import { HmacSigner } from '../hmac.js';

const KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const ASSET_ID = 'aabbccdd-1111-2222-3333-444455556666';
const API_ORIGIN = 'https://api.example.test';

let baseDir: string;
let adapter: LocalFsStorageAdapter;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'assets-library-fs-'));
  adapter = new LocalFsStorageAdapter({
    baseDir,
    publicUrlBase: 'http://localhost:3001',
    publicApiBaseUrl: API_ORIGIN,
    privateUrlTtlSec: 300,
    signer: HmacSigner.fromEnv(KEY_HEX),
  });
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe('LocalFsStorageAdapter.selfCheck', () => {
  it('returns ok=true on a writable, existing directory', async () => {
    await expect(adapter.selfCheck()).resolves.toEqual({ ok: true });
  });

  it('returns ok=false when the base directory does not exist', async () => {
    const missing = new LocalFsStorageAdapter({
      baseDir: join(baseDir, 'does-not-exist'),
      publicUrlBase: 'http://localhost:3001',
      publicApiBaseUrl: API_ORIGIN,
      privateUrlTtlSec: 300,
      signer: HmacSigner.fromEnv(KEY_HEX),
    });
    const r = await missing.selfCheck();
    expect(r.ok).toBe(false);
    expect(r.reason).toBeDefined();
  });
});

describe('LocalFsStorageAdapter.newLocator', () => {
  it('produces a sharded path matching computeLocator', () => {
    expect(adapter.newLocator({ assetId: ASSET_ID, originalFilename: 'hero.JPG' })).toBe(
      `aa/bb/${ASSET_ID}.JPG`,
    );
  });
});

describe('LocalFsStorageAdapter.put + open', () => {
  it('writes the stream atomically (no temp file lingers)', async () => {
    const locator = `aa/bb/${ASSET_ID}.txt`;
    await adapter.put({
      locator,
      mimeType: 'text/plain',
      visibility: 'public',
      stream: Readable.from(['hello world']),
      sizeBytes: 11,
    });
    const onDisk = await readFile(join(baseDir, locator), 'utf8');
    expect(onDisk).toBe('hello world');
    // No leftover .tmp-*
    const open = await adapter.open({ locator });
    const chunks: Buffer[] = [];
    for await (const c of open) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString('utf8')).toBe('hello world');
  });
});

describe('LocalFsStorageAdapter.resolveUrl', () => {
  it('returns a stable public URL for visibility=public', async () => {
    const out = await adapter.resolveUrl({
      locator: `aa/bb/${ASSET_ID}.jpg`,
      visibility: 'public',
    });
    expect(out.url).toBe(`http://localhost:3001/assets/file/${ASSET_ID}`);
    expect(out.expiresAt).toBeNull();
  });

  it('returns a token-suffixed URL for visibility=private with the configured TTL', async () => {
    const out = await adapter.resolveUrl({
      locator: `aa/bb/${ASSET_ID}.jpg`,
      visibility: 'private',
    });
    expect(out.url).toMatch(/^http:\/\/localhost:3001\/assets\/file\/aabbccdd-/);
    expect(out.url).toMatch(/[?&]token=[0-9a-f]{64}/);
    expect(out.url).toMatch(/[?&]exp=\d+/);
    expect(out.expiresAt).toBeInstanceOf(Date);
    const exp = Math.floor((out.expiresAt as Date).getTime() / 1000);
    expect(exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 300 + 5);
  });
});

describe('LocalFsStorageAdapter.resolveUrl — the D-223 fallback', () => {
  /**
   * The whole point of the ruling, at the one adapter whose blank base produced
   * a host-relative URL: `assets.local.public_url_base` is empty on every
   * deployment that never set it, and what came back was `/assets/file/<id>` —
   * correct only for a browser on the API host, and wrong for an e-mail, a push
   * payload and a partner's feed reader.
   */
  it('builds on the resolved API origin when the configured base is blank', async () => {
    const withoutBase = new LocalFsStorageAdapter({
      baseDir,
      publicUrlBase: '',
      publicApiBaseUrl: API_ORIGIN,
      privateUrlTtlSec: 300,
      signer: HmacSigner.fromEnv(KEY_HEX),
    });
    const out = await withoutBase.resolveUrl({
      locator: `aa/bb/${ASSET_ID}.jpg`,
      visibility: 'public',
    });
    expect(out.url).toBe(`${API_ORIGIN}/assets/file/${ASSET_ID}`);
  });

  /** The signed form is absolute too, and its signature survives the rebase. */
  it('signs a private URL on the same origin, query intact', async () => {
    const withoutBase = new LocalFsStorageAdapter({
      baseDir,
      publicUrlBase: '   ',
      publicApiBaseUrl: API_ORIGIN,
      privateUrlTtlSec: 300,
      signer: HmacSigner.fromEnv(KEY_HEX),
    });
    const out = await withoutBase.resolveUrl({
      locator: `aa/bb/${ASSET_ID}.jpg`,
      visibility: 'private',
    });
    expect(out.url.startsWith(`${API_ORIGIN}/assets/file/${ASSET_ID}?`)).toBe(true);
    expect(out.url).toMatch(/[?&]token=[0-9a-f]{64}/);
    expect(out.url).toMatch(/[?&]exp=\d+/);
  });

  /**
   * D-223, stated as an assertion rather than as a note: an operator who set
   * `assets.local.public_url_base` explicitly keeps winning over the fallback.
   * A CDN in front of the API is exactly why that setting exists.
   */
  it('keeps an explicitly configured base ahead of the API origin', async () => {
    const withCdn = new LocalFsStorageAdapter({
      baseDir,
      publicUrlBase: 'https://cdn.example.test/',
      publicApiBaseUrl: API_ORIGIN,
      privateUrlTtlSec: 300,
      signer: HmacSigner.fromEnv(KEY_HEX),
    });
    const out = await withCdn.resolveUrl({
      locator: `aa/bb/${ASSET_ID}.jpg`,
      visibility: 'public',
    });
    expect(out.url).toBe(`https://cdn.example.test/assets/file/${ASSET_ID}`);
  });
});

describe('LocalFsStorageAdapter.delete', () => {
  it('removes a previously-put file', async () => {
    const locator = `aa/bb/${ASSET_ID}.txt`;
    await adapter.put({
      locator,
      mimeType: 'text/plain',
      visibility: 'public',
      stream: Readable.from(['x']),
      sizeBytes: 1,
    });
    await adapter.delete({ locator });
    await expect(stat(join(baseDir, locator))).rejects.toThrow();
  });

  it('throws when the file is already missing (signal for FR-031 retry)', async () => {
    await expect(adapter.delete({ locator: `aa/bb/${ASSET_ID}.txt` })).rejects.toThrow();
  });
});
