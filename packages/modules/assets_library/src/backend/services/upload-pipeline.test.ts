import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import type { EntityManager } from '@mikro-orm/postgresql';

import { mimeToKind, UploadPipeline, type UploadPolicy } from './upload-pipeline.js';
import type { AdapterRegistry } from './storage/adapter-registry.js';
import type { StorageAdapter } from './storage/storage-adapter.js';
import { cloudContentDisposition } from './asset-urls.js';

const TINY_PNG = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C636400010000000500010D0A2DB40000000049454E44AE426082',
  'hex',
);
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>',
);
const HTML = Buffer.from('<!doctype html><html><body><p>hello</p></body></html>');

interface Stored {
  mimeType: string;
  kind: string;
  filename: string;
}

function pipeline(policy: UploadPolicy = { allowedTypes: ['*'], maxFileSizeMb: 0 }): {
  run: (filename: string, declaredMime: string, bytes: Buffer) => Promise<Stored>;
  puts: string[];
} {
  const puts: string[] = [];
  const adapter = {
    code: 'local',
    newLocator: ({ assetId }: { assetId: string }) => `aa/bb/${assetId}`,
    put: async (input: { locator: string; mimeType: string; stream: NodeJS.ReadableStream }) => {
      for await (const _chunk of input.stream) {
        /* drain */
      }
      puts.push(input.mimeType);
    },
    resolveUrl: async () => ({ url: 'http://x/assets/file/1', expiresAt: null }),
    delete: async () => undefined,
  };
  const em = {
    create: (_entity: unknown, data: Stored) => data,
    persist: () => undefined,
    flush: async () => undefined,
  } as unknown as EntityManager;
  const p = new UploadPipeline({
    emFactory: () => em,
    adapters: { getActive: async () => adapter } as unknown as AdapterRegistry,
    loadPolicy: async () => policy,
  });
  return {
    puts,
    run: async (filename, declaredMime, bytes) =>
      (await p.run({
        filename,
        declaredMime,
        stream: Readable.from([bytes]),
        declaredSize: 0,
        folderId: null,
        label: null,
        visibility: 'public',
      })) as unknown as Stored,
  };
}

describe('UploadPipeline — stored type', () => {
  it('stores the sniffed type when the content is recognised', async () => {
    const a = await pipeline().run('photo.bin', 'application/octet-stream', TINY_PNG);
    expect(a.mimeType).toBe('image/png');
    expect(a.kind).toBe('image');
  });

  it('stores the sniffed type, not a declared document type, for recognised content', async () => {
    const a = await pipeline().run('photo.png', 'text/html', TINY_PNG);
    expect(a.mimeType).toBe('image/png');
  });

  it('accepts an SVG and stores it as image/svg+xml', async () => {
    const a = await pipeline().run('logo.svg', 'image/svg+xml', SVG);
    expect(a.mimeType).toBe('image/svg+xml');
    expect(a.kind).toBe('image');
  });

  it('stores a file named .svg as image/svg+xml whatever type was declared', async () => {
    const a = await pipeline().run('logo.svg', 'text/plain', SVG);
    expect(a.mimeType).toBe('image/svg+xml');
  });

  it('keeps a declared inert type for content it cannot recognise', async () => {
    const a = await pipeline().run('notes.txt', 'text/plain', Buffer.from('hello'));
    expect(a.mimeType).toBe('text/plain');
  });
});

describe('UploadPipeline — documents a browser would run are refused', () => {
  it.each([
    ['page.html', 'text/html'],
    ['page.htm', 'text/html; charset=utf-8'],
    ['page.xhtml', 'application/xhtml+xml'],
    ['feed.xml', 'application/xml'],
    ['feed.xml', 'text/xml'],
    ['style.xsl', 'text/xsl'],
    ['app.js', 'text/javascript'],
    ['app.mjs', 'application/javascript'],
    ['page.txt', 'text/html'],
    ['page.html', 'text/plain'],
    ['page.html.', 'text/plain'],
    ['data.bin', 'application/rss+xml'],
  ])('refuses %s declared as %s with 415', async (filename, mime) => {
    const p = pipeline();
    await expect(p.run(filename, mime, HTML)).rejects.toMatchObject({
      statusCode: 415,
      code: 'ASSET_UPLOAD_TYPE_NOT_ALLOWED',
      // Issue #86 — the token picks the sentence naming the refused types.
      details: { code: 'active_content' },
    });
    expect(p.puts).toHaveLength(0);
  });

  it('refuses them even when the configured policy allows the type explicitly', async () => {
    const p = pipeline({ allowedTypes: ['text/html', '.html'], maxFileSizeMb: 0 });
    await expect(p.run('page.html', 'text/html', HTML)).rejects.toMatchObject({ statusCode: 415 });
  });

  it('applies the configured policy to the type the SVG is stored as', async () => {
    const p = pipeline({ allowedTypes: ['image/png'], maxFileSizeMb: 0 });
    await expect(p.run('logo.svg', 'image/png', SVG)).rejects.toMatchObject({ statusCode: 415 });
  });
});

// ---------------------------------------------------------------------------
// specs/156-asset-stable-url/ T023 — the staging step shared by upload and
// replace (research R-4), and `mimeToKind`.
// ---------------------------------------------------------------------------

interface RecordedPut {
  locator: string;
  mimeType: string;
  visibility: string;
  cacheControl?: string;
  contentDisposition?: string;
  bytes: number;
}

function recordingAdapter() {
  const puts: RecordedPut[] = [];
  const deleted: string[] = [];
  const adapter = {
    code: 'local' as const,
    newLocator: ({ assetId }: { assetId: string }) => `aa/bb/${assetId}.bin`,
    put: async (input: {
      locator: string;
      mimeType: string;
      visibility: string;
      stream: NodeJS.ReadableStream;
      cacheControl?: string;
      contentDisposition?: string;
    }) => {
      let bytes = 0;
      for await (const chunk of input.stream) bytes += (chunk as Buffer).length;
      puts.push({
        locator: input.locator,
        mimeType: input.mimeType,
        visibility: input.visibility,
        ...(input.cacheControl !== undefined ? { cacheControl: input.cacheControl } : {}),
        ...(input.contentDisposition !== undefined
          ? { contentDisposition: input.contentDisposition }
          : {}),
        bytes,
      });
    },
    resolveUrl: async () => ({ url: 'http://x/assets/file/1', expiresAt: null }),
    delete: async ({ locator }: { locator: string }) => {
      deleted.push(locator);
    },
  };
  return { adapter, puts, deleted };
}

function stager(policy: UploadPolicy = { allowedTypes: ['*'], maxFileSizeMb: 0 }) {
  const rec = recordingAdapter();
  const p = new UploadPipeline({
    emFactory: () => ({}) as unknown as EntityManager,
    adapters: { getActive: async () => rec.adapter } as unknown as AdapterRegistry,
    loadPolicy: async () => policy,
  });
  const stage = (
    filename: string,
    declaredMime: string,
    stream: NodeJS.ReadableStream,
    extra: { declaredSize?: number; sizeCapBytes?: number } = {},
  ) =>
    p.stage({
      adapter: rec.adapter as unknown as StorageAdapter,
      locator: 'aa/bb/stage.bin',
      filename,
      declaredMime,
      stream,
      declaredSize: extra.declaredSize ?? 0,
      visibility: 'private',
      ...(extra.sizeCapBytes !== undefined ? { sizeCapBytes: extra.sizeCapBytes } : {}),
    });
  return { ...rec, stage };
}

describe('UploadPipeline.stage — size', () => {
  it('refuses a declared size over the configured cap with 413', async () => {
    const s = stager({ allowedTypes: ['*'], maxFileSizeMb: 1 });
    await expect(
      s.stage('photo.png', 'image/png', Readable.from([TINY_PNG]), { declaredSize: 2 * 1024 * 1024 }),
    ).rejects.toMatchObject({ statusCode: 413, code: 'ASSET_UPLOAD_TOO_LARGE' });
    expect(s.puts).toHaveLength(0);
  });

  it('refuses once the counted bytes pass the configured cap, which a multipart part never declares', async () => {
    const s = stager({ allowedTypes: ['*'], maxFileSizeMb: 1 });
    const big = Buffer.alloc(2 * 1024 * 1024);
    TINY_PNG.copy(big);
    await expect(s.stage('photo.png', 'image/png', Readable.from([big]))).rejects.toMatchObject({
      statusCode: 413,
      code: 'ASSET_UPLOAD_TOO_LARGE',
      details: { maxFileSizeMb: 1 },
    });
    expect(s.puts).toHaveLength(0);
  });

  it('refuses once the counted bytes pass sizeCapBytes, naming 5120 MB, and leaves no object', async () => {
    const s = stager();
    const cap = 5 * 1024 * 1024 * 1024;
    const block = Buffer.alloc(64 * 1024 * 1024);
    TINY_PNG.copy(block);
    function* blocks(): Generator<Buffer> {
      for (let sent = 0; sent <= cap; sent += block.length) yield block;
    }
    await expect(
      s.stage('photo.png', 'image/png', Readable.from(blocks()), { sizeCapBytes: cap }),
    ).rejects.toMatchObject({
      statusCode: 413,
      code: 'ASSET_UPLOAD_TOO_LARGE',
      details: { maxFileSizeMb: 5120 },
    });
    expect(s.puts).toHaveLength(0);
  }, 60_000);
});

describe('UploadPipeline.stage — type policy', () => {
  it('refuses a disallowed declared type with 415', async () => {
    const s = stager({ allowedTypes: ['image/png'], maxFileSizeMb: 0 });
    await expect(
      s.stage('notes.txt', 'text/plain', Readable.from([Buffer.from('hello')])),
    ).rejects.toMatchObject({
      statusCode: 415,
      code: 'ASSET_UPLOAD_TYPE_NOT_ALLOWED',
      // Issue #86 — the type and the allowed list the bundle sentences name.
      details: { code: 'not_allowed_by_policy', fileType: 'text/plain', allowedTypes: 'image/png' },
    });
    expect(s.puts).toHaveLength(0);
  });

  it('refuses a disallowed sniffed type with 415', async () => {
    const s = stager({ allowedTypes: ['text/plain'], maxFileSizeMb: 0 });
    await expect(s.stage('notes.txt', 'text/plain', Readable.from([TINY_PNG]))).rejects.toMatchObject({
      statusCode: 415,
      code: 'ASSET_UPLOAD_TYPE_NOT_ALLOWED',
      details: { code: 'not_allowed_by_policy', fileType: 'image/png', allowedTypes: 'text/plain' },
    });
    expect(s.puts).toHaveLength(0);
  });

  it.each([
    ['page.html', 'text/html', HTML],
    ['page.html', 'text/plain', HTML],
    ['app.js', 'text/javascript', Buffer.from('alert(1)')],
  ])('refuses %s declared as %s with 415 before any put', async (filename, mime, bytes) => {
    const s = stager();
    await expect(s.stage(filename, mime, Readable.from([bytes]))).rejects.toMatchObject({
      statusCode: 415,
      code: 'ASSET_UPLOAD_TYPE_NOT_ALLOWED',
    });
    expect(s.puts).toHaveLength(0);
  });
});

describe('UploadPipeline.stage — what it stores and answers', () => {
  it('stores an SVG declared image/svg+xml as image/svg+xml with nothing detected, as an attachment', async () => {
    const s = stager();
    const out = await s.stage('logo.svg', 'image/svg+xml', Readable.from([SVG]));
    expect(out.storedMime).toBe('image/svg+xml');
    expect(out.detectedMime).toBeUndefined();
    expect(s.puts[0]!.mimeType).toBe('image/svg+xml');
    expect(s.puts[0]!.contentDisposition).toMatch(/^attachment; /);
  });

  it('stores logo.svg declared text/plain as image/svg+xml with nothing detected', async () => {
    const s = stager();
    const out = await s.stage('logo.svg', 'text/plain', Readable.from([SVG]));
    expect(out.storedMime).toBe('image/svg+xml');
    expect(out.detectedMime).toBeUndefined();
  });

  it('answers the detected type of a recognised PNG, counts its bytes and writes the cloud metadata', async () => {
    const s = stager();
    const out = await s.stage('photo.png', 'application/octet-stream', Readable.from([TINY_PNG]));
    expect(out).toEqual({ storedMime: 'image/png', detectedMime: 'image/png', sizeBytes: TINY_PNG.length });
    expect(s.puts).toEqual([
      {
        locator: 'aa/bb/stage.bin',
        mimeType: 'image/png',
        visibility: 'private',
        cacheControl: 'no-cache',
        contentDisposition: cloudContentDisposition('image/png', 'photo.png'),
        bytes: TINY_PNG.length,
      },
    ]);
    expect(s.puts[0]!.contentDisposition).toMatch(/^inline; /);
  });
});

describe('UploadPipeline.run — through stage', () => {
  function runner(failInsert = false) {
    const rec = recordingAdapter();
    const created: Stored[] = [];
    const em = {
      create: (_entity: unknown, data: Stored) => {
        created.push(data);
        return data;
      },
      persist: () => undefined,
      flush: async () => {
        if (failInsert) throw new Error('insert failed');
      },
    } as unknown as EntityManager;
    const p = new UploadPipeline({
      emFactory: () => em,
      adapters: { getActive: async () => rec.adapter } as unknown as AdapterRegistry,
      loadPolicy: async () => ({ allowedTypes: ['*'], maxFileSizeMb: 0 }),
    });
    const run = () =>
      p.run({
        filename: 'photo.png',
        declaredMime: 'image/png',
        stream: Readable.from([TINY_PNG]),
        declaredSize: 0,
        folderId: null,
        label: null,
        visibility: 'public',
      });
    return { ...rec, created, run };
  }

  it('inserts one row and writes the same cloud metadata as stage', async () => {
    const r = runner();
    await r.run();
    expect(r.created).toHaveLength(1);
    expect(r.puts).toHaveLength(1);
    expect(r.puts[0]).toMatchObject({
      visibility: 'public',
      cacheControl: 'no-cache',
      contentDisposition: cloudContentDisposition('image/png', 'photo.png'),
    });
  });

  it('deletes the stored object when the insert fails', async () => {
    const r = runner(true);
    await expect(r.run()).rejects.toThrow('insert failed');
    expect(r.deleted).toEqual([r.puts[0]!.locator]);
  });
});

describe('mimeToKind', () => {
  it.each([
    ['image/png', 'image'],
    ['video/webm', 'video'],
    ['application/pdf', 'pdf'],
    ['application/zip', 'other'],
  ])('%s → %s', (mime, kind) => {
    expect(mimeToKind(mime)).toBe(kind);
  });
});

/** Security review: a 503 never echoes the adapter's own text, which can name paths or buckets. */
describe('UploadPipeline.stage — storage failure', () => {
  it('answers 503 with the generic sentence and keeps the adapter error as the cause', async () => {
    const s = stager();
    const failure = new Error("EACCES: permission denied, open '/srv/private/var/assets/aa/bb/stage.bin'");
    s.adapter.put = async () => {
      throw failure;
    };
    const error = await s.stage('photo.png', 'image/png', Readable.from([TINY_PNG])).catch((e: unknown) => e);
    expect(error).toMatchObject({ statusCode: 503, code: 'ASSET_STORAGE_UNAVAILABLE' });
    expect((error as Error).message).not.toContain('/srv/private');
    expect((error as Error).message).toBe('The file storage is unavailable. Try again later.');
    expect((error as Error & { cause?: unknown }).cause).toBe(failure);
  });
});
