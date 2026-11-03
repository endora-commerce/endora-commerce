import { describe, expect, it } from 'vitest';
import { upsertSeoMetaOverrideRequestSchema } from './seo.js';

/**
 * Feature 163 (checkpoint E security review, I5) — an Open Graph image URL is written
 * into every page's `<meta property="og:image">`, so a write accepts only an absolute
 * `http(s)` URL or a site-relative path (`/…`, never `//…`); `javascript:`, `data:`
 * and every other scheme are refused.
 */
describe('upsertSeoMetaOverrideRequestSchema.ogImageUrl', () => {
  const parse = (ogImageUrl: unknown) => upsertSeoMetaOverrideRequestSchema.safeParse({ ogImageUrl });

  it.each(['https://cdn.example.com/a.png', 'http://cdn.example.com/a.png', '/assets/a.png', null])(
    'accepts %s',
    (value) => {
      expect(parse(value).success).toBe(true);
    },
  );

  it.each([
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'ftp://example.com/a.png',
    '//evil.example/a.png',
    '/\\\\evil.example/a.png',
    'assets/a.png',
    '',
  ])('refuses %s', (value) => {
    expect(parse(value).success).toBe(false);
  });
});

describe('ogImageUrlSchema refuses userinfo (170 C2/C3 review)', () => {
  it.each(['https://user:pass@evil.example/a.png', 'http://u@cdn.example.com/a.png'])('refuses %s', (value) => {
    expect(upsertSeoMetaOverrideRequestSchema.safeParse({ ogImageUrl: value }).success).toBe(false);
  });
});
