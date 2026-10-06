import { describe, expect, it } from 'vitest';
import { asDownloadLink, isActiveContent, refuseActiveContent } from './attachment-active-content.js';

describe('isActiveContent', () => {
  it.each([
    ['offer.html', 'text/html'],
    ['offer.HTM', 'application/octet-stream'],
    ['offer.xhtml', 'application/xhtml+xml'],
    ['offer.shtml', 'text/plain'],
    ['logo.svg', 'image/svg+xml'],
    ['logo.svg', 'image/png'],
    ['feed.xml', 'text/plain'],
    ['style.xsl', 'text/plain'],
    ['app.js', 'text/plain'],
    ['app.mjs', 'application/octet-stream'],
    ['offer.html. ', 'text/plain'],
    ['notes.txt', 'text/html'],
    ['notes.txt', 'Text/HTML; charset=utf-8'],
    ['notes.txt', 'application/xhtml+xml'],
    ['notes.txt', 'image/svg+xml'],
    ['notes.txt', 'text/xml'],
    ['notes.txt', 'application/xml'],
    ['notes.txt', 'application/javascript'],
    ['notes.txt', 'text/javascript'],
    ['notes.txt', 'application/x-javascript'],
  ])('refuses %s declared %s', (filename, mimeType) => {
    expect(isActiveContent({ filename, mimeType })).toBe(true);
    expect(() => refuseActiveContent({ filename, mimeType })).toThrowError(
      expect.objectContaining({ statusCode: 415, code: 'ASSET_UPLOAD_TYPE_NOT_ALLOWED' }),
    );
  });

  it.each([
    ['offer.pdf', 'application/pdf'],
    ['photo.png', 'image/png'],
    ['scope.txt', 'text/plain'],
    ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['archive', 'application/octet-stream'],
    ['html', 'application/octet-stream'],
  ])('admits %s declared %s', (filename, mimeType) => {
    expect(isActiveContent({ filename, mimeType })).toBe(false);
    expect(() => refuseActiveContent({ filename, mimeType })).not.toThrow();
  });
});

describe('asDownloadLink', () => {
  it('asks the library\'s file route for a download, keeping the signature', () => {
    expect(asDownloadLink('http://api.test/assets/file/a-1?token=t&exp=9', 'a-1')).toBe(
      'http://api.test/assets/file/a-1?token=t&exp=9&download=1',
    );
    expect(asDownloadLink('/assets/file/a-1', 'a-1')).toBe('/assets/file/a-1?download=1');
  });

  it('leaves a link that already asks alone', () => {
    const link = '/assets/file/a-1?token=t&exp=9&download=1';
    expect(asDownloadLink(link, 'a-1')).toBe(link);
  });

  it('leaves a store\'s own signed address untouched', () => {
    const link = 'https://bucket.s3.example/assets/a-1/offer.pdf?X-Amz-Signature=abc';
    expect(asDownloadLink(link, 'a-1')).toBe(link);
  });
});
