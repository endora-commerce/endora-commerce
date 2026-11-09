import { describe, expect, it } from 'vitest';

import { decideFileResponse, type FileRequest, type FileRow } from './file-response.js';
import { PDF_CSP, SANDBOX_CSP } from './content-policy.js';
import { contentDispositionHeader } from './asset-urls.js';

// specs/156-asset-stable-url/ T054 — every row of contracts/file-serving.md §2.

const ID = '0b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const CV = 'a1b2c3d4e5f6';

function row(over: Partial<FileRow> = {}): FileRow {
  return {
    id: ID,
    filename: 'photo.png',
    mimeType: 'image/png',
    sizeBytes: '68',
    visibility: 'public',
    storageBackend: 'local',
    storageLocator: `0b/8f/${ID}.png`,
    storageUrl: `/assets/file/${ID}`,
    contentVersion: CV,
    permalink: 'Docs/Certificate.pdf',
    deletedAt: null,
    ...over,
  };
}

function decide(over: Partial<FileRequest> & { row?: FileRow | null } = {}) {
  return decideFileResponse({
    row: row(),
    form: 'id',
    query: {},
    signatureValid: false,
    ...over,
  });
}

const REFUSAL = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': SANDBOX_CSP, 'Cache-Control': 'no-store' };

describe('decideFileResponse — refusals', () => {
  it('no row → 404 ASSET_NOT_FOUND with the fixed refusal headers', () => {
    expect(decide({ row: null })).toEqual({
      status: 404,
      headers: REFUSAL,
      body: { code: 'ASSET_NOT_FOUND', message: 'Asset not found.' },
    });
  });

  it.each(['local', 's3', 'gcs'] as const)('private by id without a valid signature → 403 on %s, no Location', (backend) => {
    const d = decide({ row: row({ visibility: 'private', storageBackend: backend }) });
    expect(d.status).toBe(403);
    expect(d).not.toHaveProperty('location');
    expect(d.headers).toEqual(REFUSAL);
    expect(d.body).toMatchObject({ code: 'ASSET_ACCESS_DENIED' });
  });

  it.each(['local', 's3', 'gcs'] as const)('private by permalink without a valid signature → exactly the no-row answer (%s)', (backend) => {
    const d = decide({ form: 'permalink', row: row({ visibility: 'private', storageBackend: backend }) });
    expect(d).toEqual(decide({ form: 'permalink', row: null }));
  });

  it('a soft-deleted private asset: 403 by id and 404 by permalink without a signature, 410 with one', () => {
    const deleted = row({ visibility: 'private', deletedAt: new Date() });
    expect(decide({ row: deleted }).status).toBe(403);
    expect(decide({ row: deleted, form: 'permalink' })).toEqual(decide({ row: null }));
    expect(decide({ row: deleted, signatureValid: true }).status).toBe(410);
    expect(decide({ row: deleted, form: 'permalink', signatureValid: true }).status).toBe(410);
  });

  it.each([
    ['bare', {}],
    ['current v', { v: CV }],
    ['stale v', { v: 'ffffffffffff' }],
  ])('a soft-deleted public asset → 410 (%s), by id and by permalink', (_label, query) => {
    for (const form of ['id', 'permalink'] as const) {
      const d = decide({ row: row({ deletedAt: new Date() }), form, query });
      expect(d.status).toBe(410);
      expect(d.headers).toEqual(REFUSAL);
      expect(d.body).toMatchObject({ code: 'ASSET_GONE' });
    }
  });

  it('an unsigned request on a private asset carrying its current ETag is refused, never 304', () => {
    const priv = row({ visibility: 'private' });
    const etag = `"${ID}-${CV}"`;
    expect(decide({ row: priv, ifNoneMatch: etag }).status).toBe(403);
    expect(decide({ row: priv, ifNoneMatch: etag, form: 'permalink' }).status).toBe(404);
  });
});

describe('decideFileResponse — private with a valid signature', () => {
  it('local → 200 private, no-store, ignoring v', () => {
    const d = decide({ row: row({ visibility: 'private' }), signatureValid: true, query: { v: 'ffffffffffff' } });
    expect(d.status).toBe(200);
    expect(d.headers['Cache-Control']).toBe('private, no-store, max-age=0');
    expect(d.headers).not.toHaveProperty('Cross-Origin-Resource-Policy');
    const conditional = decide({ row: row({ visibility: 'private' }), signatureValid: true, ifNoneMatch: `"${ID}-${CV}"` });
    expect(conditional.status).toBe(304);
    expect(conditional.headers).not.toHaveProperty('Cross-Origin-Resource-Policy');
  });

  it.each(['s3', 'gcs'] as const)('%s → 302 to the time-limited URL, no-store', (backend) => {
    const d = decide({ row: row({ visibility: 'private', storageBackend: backend }), signatureValid: true });
    expect(d).toEqual({ status: 302, headers: REFUSAL, body: 'none', location: { kind: 'private-signed' } });
  });
});

describe('decideFileResponse — public, not stored here', () => {
  it.each(['s3', 'gcs'] as const)('%s → 302 to the stable bucket URL, with the current v only when one was asked for', (backend) => {
    const r = row({ storageBackend: backend });
    expect(decide({ row: r })).toEqual({ status: 302, headers: REFUSAL, body: 'none', location: { kind: 'stable' } });
    expect(decide({ row: r, query: { v: 'old' } })).toMatchObject({ location: { kind: 'stable', version: CV } });
  });

  it('legacy → 302 to an https stored URL', () => {
    const d = decide({ row: row({ storageBackend: 'legacy', storageLocator: 'https://old.example.test/a.png' }) });
    expect(d).toMatchObject({ status: 302, location: { kind: 'url', url: 'https://old.example.test/a.png' } });
  });

  it.each(['data:image/png;base64,AAAA', 'javascript:alert(1)', '/uploads/a.png'])('legacy → 404 ASSET_FILE_MISSING for %s', (stored) => {
    const d = decide({ row: row({ storageBackend: 'legacy', storageLocator: stored, storageUrl: stored }) });
    expect(d.status).toBe(404);
    expect(d.body).toMatchObject({ code: 'ASSET_FILE_MISSING' });
    expect(d.headers).toEqual(REFUSAL);
  });
});

describe('decideFileResponse — public, local', () => {
  it('no v → public, no-cache with the content-version ETag, and 304 on a match', () => {
    const d = decide();
    expect(d.status).toBe(200);
    expect(d.headers).toMatchObject({
      'Cache-Control': 'public, no-cache',
      ETag: `"${ID}-${CV}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': SANDBOX_CSP,
      'Content-Type': 'image/png',
      'Content-Length': '68',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Content-Disposition': contentDispositionHeader('inline', 'photo.png'),
    });
    const conditional = decide({ ifNoneMatch: `"${ID}-${CV}"` });
    expect(conditional.status).toBe(304);
    expect(conditional.headers['Content-Security-Policy']).toBe(SANDBOX_CSP);
    expect(conditional.headers['Cross-Origin-Resource-Policy']).toBe('cross-origin');
  });

  it('current v → immutable for a year', () => {
    expect(decide({ query: { v: CV } }).headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
  });

  it('a PDF carries the PDF policy, and download or a non-inline type is an attachment', () => {
    const pdf = decide({ row: row({ mimeType: 'application/pdf', filename: 'certificate.pdf' }) });
    expect(pdf.headers['Content-Security-Policy']).toBe(PDF_CSP);
    expect(pdf.headers['Content-Disposition']).toMatch(/^inline;/);
    expect(decide({ query: { download: '1' } }).headers['Content-Disposition']).toBe(
      contentDispositionHeader('attachment', 'photo.png'),
    );
    expect(decide({ row: row({ mimeType: 'application/zip' }) }).headers['Content-Disposition']).toMatch(/^attachment;/);
  });

  it('a stale v redirects to a Location built from the row, copying only download=1', () => {
    expect(decide({ query: { v: 'old' } })).toEqual({
      status: 302,
      headers: REFUSAL,
      body: 'none',
      location: { kind: 'url', url: `/assets/file/${ID}?v=${CV}` },
    });
    expect(decide({ query: { v: 'old', download: '1', token: 'a', exp: '1' } })).toMatchObject({
      location: { url: `/assets/file/${ID}?v=${CV}&download=1` },
    });
    expect(decide({ form: 'permalink', query: { v: 'old', download: '0' } })).toMatchObject({
      location: { url: `/assets/file/Docs/Certificate.pdf?v=${CV}` },
    });
    expect(
      decide({ form: 'permalink', row: row({ permalink: 'a b/c?.pdf' }), query: { v: 'old' } }),
    ).toMatchObject({ location: { url: `/assets/file/a%20b/c%3F.pdf?v=${CV}` } });
  });
});

// Block review H — RFC 9110 weak comparison for GET: a weak tag and a list match.
describe('decideFileResponse — If-None-Match forms', () => {
  const etag = `"${ID}-${CV}"`;
  it.each([
    ['the weak form', `W/${etag}`],
    ['a list holding it', `"other", ${etag}`],
    ['a list holding its weak form', `W/"other",W/${etag}`],
    ['*', '*'],
  ])('answers 304 for %s', (_label, header) => {
    expect(decide({ ifNoneMatch: header }).status).toBe(304);
  });

  it('answers 200 for a list without it', () => {
    expect(decide({ ifNoneMatch: `"other", W/"${ID}-ffffffffffff"` }).status).toBe(200);
  });

  it('still never answers 304 to an unsigned request on a private asset', () => {
    const priv = row({ visibility: 'private' });
    expect(decide({ row: priv, ifNoneMatch: `W/${etag}` }).status).toBe(403);
    expect(decide({ row: priv, ifNoneMatch: '*', form: 'permalink' }).status).toBe(404);
  });
});
