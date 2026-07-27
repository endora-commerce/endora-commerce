import { describe, expect, it } from 'vitest';
import { absolutizePublicUrl } from './absolutize-public-url.js';

describe('absolutizePublicUrl', () => {
  it('leaves absolute URLs unchanged', () => {
    expect(absolutizePublicUrl('https://cdn.example/x.png', 'http://localhost:3001')).toBe(
      'https://cdn.example/x.png',
    );
  });

  it('prefixes host-relative paths with the public base', () => {
    expect(absolutizePublicUrl('/assets/file/abc', 'http://localhost:3001/')).toBe(
      'http://localhost:3001/assets/file/abc',
    );
  });

  it('returns relative path unchanged when no base is configured', () => {
    expect(absolutizePublicUrl('/assets/file/abc', '')).toBe('/assets/file/abc');
  });
});
