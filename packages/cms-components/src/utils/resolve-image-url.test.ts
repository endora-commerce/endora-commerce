import { describe, expect, it } from 'vitest';
import { absolutizeMediaUrl, resolveImageUrl } from './resolve-image-url.js';

describe('resolveImageUrl', () => {
  const assets = {
    'asset-desktop': { url: '/assets/file/desktop' },
  };

  it('resolves library asset URL with media base', () => {
    expect(
      resolveImageUrl(
        { imageSource: 'library', assetId: 'asset-desktop' },
        'desktop',
        assets,
        'http://localhost:3001',
      ),
    ).toBe('http://localhost:3001/assets/file/desktop');
  });

  it('falls back to /assets/file/:id when assets map misses the id', () => {
    expect(
      resolveImageUrl(
        { imageSource: 'library', assetId: 'missing-id' },
        'desktop',
        {},
        'http://localhost:3001',
      ),
    ).toBe('http://localhost:3001/assets/file/missing-id');
  });

  it('falls back to URL mode', () => {
    expect(resolveImageUrl({ imageSource: 'url', src: 'https://example.com/a.jpg' }, 'desktop', {})).toBe(
      'https://example.com/a.jpg',
    );
  });

  it('rebases relative URL-mode src onto media base', () => {
    expect(
      resolveImageUrl(
        { imageSource: 'url', src: '/assets/file/abc' },
        'desktop',
        {},
        'http://localhost:3001',
      ),
    ).toBe('http://localhost:3001/assets/file/abc');
  });
});

describe('absolutizeMediaUrl', () => {
  it('leaves absolute URLs unchanged', () => {
    expect(absolutizeMediaUrl('https://cdn.example.com/x.png', 'http://localhost:3001')).toBe(
      'https://cdn.example.com/x.png',
    );
  });

  it('does not invent a base from window location', () => {
    expect(absolutizeMediaUrl('/assets/file/x')).toBe('/assets/file/x');
  });
});
