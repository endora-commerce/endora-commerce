import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { EntityManager } from '@mikro-orm/postgresql';

import { registerAssetsLibraryPublicRoutes } from './routes.public.js';
import { HmacSigner } from './services/hmac.js';
import { LocalFsStorageAdapter } from './services/storage/local-fs-adapter.js';
import type { AdapterRegistry } from './services/storage/adapter-registry.js';
import type { AssetsLibraryService } from './services/assets-library.service.js';

const KEY_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const signer = HmacSigner.fromEnv(KEY_HEX);

interface FakeAsset {
  id: string;
  filename: string;
  mimeType: string;
  visibility: 'public' | 'private';
  storageBackend: 'local' | 's3' | 'gcs' | 'legacy';
  storageLocator: string;
  storageUrl: string;
  sizeBytes: string;
  updatedAt: Date;
  deletedAt: Date | null;
  contentVersion: string;
  permalink: string | null;
}

const SANDBOX_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

let app: FastifyInstance;
let baseDir: string;
const assets = new Map<string, FakeAsset>();
const resolveUrl = vi.fn(async (id: string, _opts?: { download?: boolean }) => ({
  url: `https://bucket.example.test/${id}?X-Signature=abc`,
  expiresAt: null,
}));

let seq = 0;
async function addAsset(
  filename: string,
  mimeType: string,
  over: Partial<FakeAsset> = {},
): Promise<FakeAsset> {
  seq += 1;
  const id = `aabbccdd-0000-0000-0000-${String(seq).padStart(12, '0')}`;
  const locator = `aa/bb/${id}.bin`;
  await mkdir(dirname(join(baseDir, locator)), { recursive: true });
  await writeFile(join(baseDir, locator), 'abc');
  const a: FakeAsset = {
    id,
    filename,
    mimeType,
    visibility: 'public',
    storageBackend: 'local',
    storageLocator: locator,
    storageUrl: '',
    sizeBytes: '3',
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    contentVersion: `cv${String(seq).padStart(10, '0')}`,
    permalink: null,
    ...over,
  };
  assets.set(id, a);
  return a;
}

function signedQuery(id: string): string {
  const exp = Math.floor(Date.now() / 1000) + 300;
  return `token=${signer.sign({ assetId: id, exp })}&exp=${exp}`;
}

beforeAll(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'assets-library-route-'));
  const local = new LocalFsStorageAdapter({
    baseDir,
    publicUrlBase: 'http://localhost:3001',
    publicApiBaseUrl: 'https://api.example.test',
    privateUrlTtlSec: 300,
    signer,
  });
  const em = {
    findOne: async (_entity: unknown, where: { id: string }) => assets.get(where.id) ?? null,
    // The permalink lookup the route makes: `lower(permalink) = lower(?)`.
    execute: async (_sql: string, params: unknown[]) => {
      const wanted = String(params[0]).toLowerCase();
      return [...assets.values()]
        .filter((a) => a.permalink !== null && a.permalink.toLowerCase() === wanted)
        .map((a) => ({ id: a.id }));
    },
  } as unknown as EntityManager;

  app = Fastify();
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    void reply.status(err.statusCode ?? 500).send({ error: { code: err.code } });
  });
  await registerAssetsLibraryPublicRoutes(app, {
    service: { resolveUrl } as unknown as AssetsLibraryService,
    adapters: { getForBackend: async () => local } as unknown as AdapterRegistry,
    emFactory: () => em,
    signer: () => signer,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(baseDir, { recursive: true, force: true });
});

describe('GET /assets/file/:assetId — response headers by stored type', () => {
  it.each([
    ['photo.png', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.webp', 'image/webp'],
    ['clip.mp4', 'video/mp4'],
    ['track.mp3', 'audio/mpeg'],
    ['notes.txt', 'text/plain'],
  ])('serves %s (%s) inline under a sandboxing policy', async (filename, mime) => {
    const a = await addAsset(filename, mime);
    const r = await app.inject({ method: 'GET', url: `/assets/file/${a.id}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain(mime);
    expect(r.headers['content-disposition']).toMatch(/^inline;/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toBe(SANDBOX_CSP);
  });

  it('serves an SVG inline as an image under a policy that runs no script', async () => {
    const a = await addAsset('logo.svg', 'image/svg+xml');
    const r = await app.inject({ method: 'GET', url: `/assets/file/${a.id}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/svg+xml');
    expect(r.headers['content-disposition']).toMatch(/^inline;/);
    expect(r.headers['content-security-policy']).toBe(SANDBOX_CSP);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves a PDF inline with a policy that keeps the built-in viewer working', async () => {
    const a = await addAsset('sheet.pdf', 'application/pdf');
    const r = await app.inject({ method: 'GET', url: `/assets/file/${a.id}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/^inline;/);
    expect(r.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it.each([
    ['page.html', 'text/html'],
    ['page.xhtml', 'application/xhtml+xml'],
    ['feed.xml', 'application/xml'],
    ['feed.xml', 'text/xml'],
    ['app.js', 'text/javascript'],
    ['data.json', 'application/json'],
    ['archive.zip', 'application/zip'],
    ['blob', 'application/octet-stream'],
  ])('serves %s (%s) only as a download', async (filename, mime) => {
    const a = await addAsset(filename, mime);
    const r = await app.inject({ method: 'GET', url: `/assets/file/${a.id}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/^attachment;/);
    expect(r.headers['content-security-policy']).toBe(SANDBOX_CSP);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('treats a stored type with parameters by its essence', async () => {
    const a = await addAsset('page.txt', 'Text/HTML; charset=utf-8');
    const r = await app.inject({ method: 'GET', url: `/assets/file/${a.id}` });
    expect(r.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('still answers a download when one is asked for an inline-safe type', async () => {
    const a = await addAsset('photo.png', 'image/png');
    const r = await app.inject({ method: 'GET', url: `/assets/file/${a.id}?download=1` });
    expect(r.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('sends the same policy on a conditional 304', async () => {
    const a = await addAsset('photo.png', 'image/png');
    const first = await app.inject({ method: 'GET', url: `/assets/file/${a.id}` });
    const r = await app.inject({
      method: 'GET',
      url: `/assets/file/${a.id}`,
      headers: { 'if-none-match': first.headers['etag'] as string },
    });
    expect(r.statusCode).toBe(304);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    // The browser merges a 304's headers into the cached response: without this
    // the host's default `same-origin` replaces the 200's and blocks the embed.
    expect(r.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});

describe('GET /assets/file/:assetId — private assets on every storage backend', () => {
  it.each(['s3', 'gcs'] as const)(
    'refuses a private %s asset without a token, before resolving any storage URL',
    async (backend) => {
      resolveUrl.mockClear();
      const a = await addAsset('secret.pdf', 'application/pdf', {
        visibility: 'private',
        storageBackend: backend,
      });
      const r = await app.inject({ method: 'GET', url: `/assets/file/${a.id}` });
      expect(r.statusCode).toBe(404);
      expect(r.json()).toMatchObject({ error: { code: 'ASSET_NOT_FOUND' } });
      expect(resolveUrl).not.toHaveBeenCalled();
    },
  );

  it('refuses a private s3 asset whose token does not verify', async () => {
    resolveUrl.mockClear();
    const a = await addAsset('secret.pdf', 'application/pdf', {
      visibility: 'private',
      storageBackend: 's3',
    });
    const exp = Math.floor(Date.now() / 1000) + 300;
    const r = await app.inject({
      method: 'GET',
      url: `/assets/file/${a.id}?token=${'0'.repeat(64)}&exp=${exp}`,
    });
    expect(r.statusCode).toBe(404);
    expect(resolveUrl).not.toHaveBeenCalled();
  });

  it('redirects a private s3 asset carrying a valid token to its storage URL', async () => {
    resolveUrl.mockClear();
    const a = await addAsset('secret.pdf', 'application/pdf', {
      visibility: 'private',
      storageBackend: 's3',
    });
    const r = await app.inject({ method: 'GET', url: `/assets/file/${a.id}?${signedQuery(a.id)}` });
    expect(r.statusCode).toBe(302);
    expect(r.headers['location']).toBe(`https://bucket.example.test/${a.id}?X-Signature=abc`);
    expect(resolveUrl).toHaveBeenCalledWith(a.id, { download: false });
  });

  // Issue #815: the signed URL pins the bucket's answer to the asset's type and
  // disposition, and `?download=1` asks for an attachment as it does locally.
  it('asks for an attachment-signed URL when a private s3 asset is requested with download=1', async () => {
    resolveUrl.mockClear();
    const a = await addAsset('secret.pdf', 'application/pdf', {
      visibility: 'private',
      storageBackend: 's3',
    });
    const r = await app.inject({
      method: 'GET',
      url: `/assets/file/${a.id}?${signedQuery(a.id)}&download=1`,
    });
    expect(r.statusCode).toBe(302);
    expect(resolveUrl).toHaveBeenCalledWith(a.id, { download: true });
  });

  it('redirects a public s3 asset without a token', async () => {
    const a = await addAsset('photo.png', 'image/png', { storageBackend: 's3' });
    const r = await app.inject({ method: 'GET', url: `/assets/file/${a.id}` });
    expect(r.statusCode).toBe(302);
  });

  it('refuses a private local asset without a token and serves it with one', async () => {
    const a = await addAsset('secret.pdf', 'application/pdf', { visibility: 'private' });
    const denied = await app.inject({ method: 'GET', url: `/assets/file/${a.id}` });
    expect(denied.statusCode).toBe(404);
    const ok = await app.inject({ method: 'GET', url: `/assets/file/${a.id}?${signedQuery(a.id)}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toContain('no-store');
  });
});

// specs/156-asset-stable-url/ T055a — permalinks, the per-form private answer
// and the refusal headers (contracts/file-serving.md §2, owner ruling P2).
describe('GET /assets/file — permalinks and the private answer by form (feature 156)', () => {
  function sameRefusal(a: { statusCode: number; body: string; headers: Record<string, unknown> }, b: typeof a) {
    expect(a.statusCode).toBe(b.statusCode);
    expect(a.body).toBe(b.body);
    for (const h of ['x-content-type-options', 'content-security-policy', 'cache-control']) {
      expect(a.headers[h]).toBe(b.headers[h]);
    }
  }

  it.each(['local', 's3'] as const)(
    'a private %s asset by permalink without a token answers exactly like an unknown permalink',
    async (backend) => {
      resolveUrl.mockClear();
      await addAsset('secret.pdf', 'application/pdf', {
        visibility: 'private',
        storageBackend: backend,
        permalink: `docs/secret-${backend}.pdf`,
      });
      const hidden = await app.inject({ method: 'GET', url: `/assets/file/docs/secret-${backend}.pdf` });
      const unknown = await app.inject({ method: 'GET', url: '/assets/file/docs/nothing-here.pdf' });
      expect(hidden.statusCode).toBe(404);
      expect(hidden.json()).toMatchObject({ error: { code: 'ASSET_NOT_FOUND' } });
      sameRefusal(hidden, unknown);
      expect(hidden.headers['location']).toBeUndefined();
      expect(resolveUrl).not.toHaveBeenCalled();
    },
  );

  // Issue #542: by id as by permalink, a private asset without a valid
  // signature answers byte-for-byte what an id that names nothing answers.
  it.each(['local', 's3', 'gcs'] as const)(
    'a private %s asset by id without a token, or with a forged one, answers exactly like an unknown id',
    async (backend) => {
      resolveUrl.mockClear();
      const a = await addAsset('secret.pdf', 'application/pdf', {
        visibility: 'private',
        storageBackend: backend,
      });
      const unknown = await app.inject({
        method: 'GET',
        url: '/assets/file/aabbccdd-ffff-ffff-ffff-ffffffffffff',
      });
      expect(unknown.statusCode).toBe(404);
      const exp = Math.floor(Date.now() / 1000) + 300;
      for (const url of [
        `/assets/file/${a.id}`,
        `/assets/file/${a.id}?token=${'0'.repeat(64)}&exp=${exp}`,
        `/assets/file/${a.id}?v=${a.contentVersion}`,
      ]) {
        const hidden = await app.inject({ method: 'GET', url });
        sameRefusal(hidden, unknown);
        expect(hidden.headers['location']).toBeUndefined();
        expect(hidden.headers['etag']).toBeUndefined();
      }
      expect(resolveUrl).not.toHaveBeenCalled();
    },
  );

  it('a soft-deleted private asset by id answers 404 without a token and 410 with one', async () => {
    const a = await addAsset('secret.pdf', 'application/pdf', { visibility: 'private', deletedAt: new Date() });
    const without = await app.inject({ method: 'GET', url: `/assets/file/${a.id}` });
    expect(without.statusCode).toBe(404);
    const withToken = await app.inject({ method: 'GET', url: `/assets/file/${a.id}?${signedQuery(a.id)}` });
    expect(withToken.statusCode).toBe(410);
  });

  it('302, 404 (unknown and hidden) and 410 all carry nosniff, the sandbox policy and no-store', async () => {
    const pub = await addAsset('photo.png', 'image/png');
    const priv = await addAsset('secret.pdf', 'application/pdf', { visibility: 'private' });
    const gone = await addAsset('gone.pdf', 'application/pdf', { deletedAt: new Date() });
    const answers = [
      await app.inject({ method: 'GET', url: `/assets/file/${pub.id}?v=stale` }),
      await app.inject({ method: 'GET', url: `/assets/file/${priv.id}` }),
      await app.inject({ method: 'GET', url: '/assets/file/no-such-name.pdf' }),
      await app.inject({ method: 'GET', url: `/assets/file/${gone.id}` }),
    ];
    expect(answers.map((r) => r.statusCode)).toEqual([302, 404, 404, 410]);
    for (const r of answers) {
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['content-security-policy']).toBe(SANDBOX_CSP);
      expect(r.headers['cache-control']).toBe('no-store');
    }
  });

  it('serves a PNG by permalink with the same nosniff and policy as by id, on 200 and 304', async () => {
    const a = await addAsset('photo.png', 'image/png', { permalink: 'img/Logo.png' });
    const byId = await app.inject({ method: 'GET', url: `/assets/file/${a.id}` });
    const byName = await app.inject({ method: 'GET', url: '/assets/file/IMG/logo.PNG' });
    expect(byName.statusCode).toBe(200);
    for (const h of ['x-content-type-options', 'content-security-policy', 'etag', 'content-type']) {
      expect(byName.headers[h]).toBe(byId.headers[h]);
    }
    const conditional = await app.inject({
      method: 'GET',
      url: '/assets/file/img/Logo.png',
      headers: { 'if-none-match': byName.headers['etag'] as string },
    });
    expect(conditional.statusCode).toBe(304);
    expect(conditional.headers['content-security-policy']).toBe(byId.headers['content-security-policy']);
    expect(conditional.headers['x-content-type-options']).toBe('nosniff');
    expect(conditional.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});
