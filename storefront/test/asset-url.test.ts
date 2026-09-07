import { describe, expect, it } from 'vitest';
import { toAbsoluteAssetUrl } from '../lib/asset-url';

// `vitest.config.mts` sets NEXT_PUBLIC_API_BASE_URL for the run, because the
// helper no longer invents an origin when it is unset — it refuses. These
// assertions pin the rebasing behaviour that keeps gallery/thumbnail images
// resolving against the backend origin rather than the storefront origin, and
// the origin below is deliberately not a plausible default: a helper that
// answered from somewhere other than the configured variable cannot produce it.
const BASE = 'http://api.test';

describe('toAbsoluteAssetUrl', () => {
  it('rebases host-relative asset URLs onto the API origin', () => {
    expect(toAbsoluteAssetUrl('/assets/file/abc-123')).toBe(`${BASE}/assets/file/abc-123`);
  });

  it('passes through absolute http(s) URLs untouched', () => {
    expect(toAbsoluteAssetUrl('https://cdn.example.com/img.png')).toBe(
      'https://cdn.example.com/img.png',
    );
    expect(toAbsoluteAssetUrl('http://cdn.example.com/img.png')).toBe(
      'http://cdn.example.com/img.png',
    );
  });

  it('passes through data: and blob: URLs untouched', () => {
    expect(toAbsoluteAssetUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(toAbsoluteAssetUrl('blob:http://localhost/xyz')).toBe('blob:http://localhost/xyz');
  });

  it('returns an empty string for null/undefined/empty input', () => {
    expect(toAbsoluteAssetUrl(null)).toBe('');
    expect(toAbsoluteAssetUrl(undefined)).toBe('');
    expect(toAbsoluteAssetUrl('')).toBe('');
  });

  it('leaves non-slash relative URLs untouched', () => {
    expect(toAbsoluteAssetUrl('assets/file/abc')).toBe('assets/file/abc');
  });
});
