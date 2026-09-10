import { describe, expect, it } from 'vitest';

import { absolutizeAssetUrl, resolvePublicUrlBase } from './public-url-base.js';

const ORIGIN = 'https://api.example.test';

describe('resolvePublicUrlBase', () => {
  it('falls back to the resolved API origin when the operator configured nothing', () => {
    expect(resolvePublicUrlBase('', ORIGIN)).toBe(ORIGIN);
    expect(resolvePublicUrlBase('   ', ORIGIN)).toBe(ORIGIN);
    expect(resolvePublicUrlBase(undefined, ORIGIN)).toBe(ORIGIN);
  });

  /**
   * D-223's own words: "an operator who set the value explicitly must keep
   * winning". This is that clause, asserted rather than noted — the fallback is
   * the blank case and nothing else.
   */
  it('keeps an explicitly configured absolute base, whatever the API origin is', () => {
    expect(resolvePublicUrlBase('https://cdn.example.test', ORIGIN)).toBe(
      'https://cdn.example.test',
    );
    expect(resolvePublicUrlBase('https://cdn.example.test/media/', ORIGIN)).toBe(
      'https://cdn.example.test/media',
    );
    expect(resolvePublicUrlBase('http://localhost:9999', ORIGIN)).toBe('http://localhost:9999');
  });

  it('rebases a configured base that is a path onto the API origin', () => {
    expect(resolvePublicUrlBase('/media', ORIGIN)).toBe(`${ORIGIN}/media`);
    expect(resolvePublicUrlBase('media', ORIGIN)).toBe(`${ORIGIN}/media`);
  });

  it('strips trailing slashes from the origin it falls back to', () => {
    expect(resolvePublicUrlBase('', `${ORIGIN}//`)).toBe(ORIGIN);
  });

  it('keeps a protocol-relative base as the operator wrote it', () => {
    expect(resolvePublicUrlBase('//cdn.example.test', ORIGIN)).toBe('//cdn.example.test');
  });
});

describe('absolutizeAssetUrl', () => {
  it('leaves an already-absolute URL alone, signature and query included', () => {
    const signed = 'https://bucket.s3.eu-central-1.amazonaws.com/a/b.jpg?X-Amz-Signature=abc';
    expect(absolutizeAssetUrl(signed, ORIGIN)).toBe(signed);
    expect(absolutizeAssetUrl('data:image/png;base64,AAA', ORIGIN)).toBe(
      'data:image/png;base64,AAA',
    );
  });

  /**
   * The signed local-FS form. `?token=…&exp=…` is part of the path-and-query and
   * must survive the rebase intact: the route validates the signature over the
   * asset id and the expiry, so a mangled query is a 403 rather than an image.
   */
  it('rebases a signed host-relative URL without touching its query', () => {
    expect(absolutizeAssetUrl('/assets/file/abc?token=deadbeef&exp=42', ORIGIN)).toBe(
      `${ORIGIN}/assets/file/abc?token=deadbeef&exp=42`,
    );
  });

  it('rebases a relative URL that carries no leading slash', () => {
    expect(absolutizeAssetUrl('assets/file/abc', ORIGIN)).toBe(`${ORIGIN}/assets/file/abc`);
  });

  it('returns the URL unchanged when there is no origin to rebase onto', () => {
    expect(absolutizeAssetUrl('/assets/file/abc', '')).toBe('/assets/file/abc');
  });
});
