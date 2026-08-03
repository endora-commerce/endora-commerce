import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FEED_TOKEN_SHAPE_RE,
  hashFeedToken,
  isFeedPubliclyServable,
  isFeedTokenShape,
  issueFeedToken,
  tokenHashMatches,
} from '../../../src/modules/product_feeds/services/feed-token.service.js';

/**
 * Feature 067 / T024 — the public access token (FR-046, FR-047).
 *
 * The token is the only authorization on the module's internet-facing route, so
 * three properties are non-negotiable: it is unguessable, only its sha256 is
 * ever persisted (the `api_keys` precedent), and comparison is constant-time so
 * the endpoint cannot be turned into a hash oracle.
 */

describe('issueFeedToken', () => {
  it('produces a 43-character base64url token (32 random bytes, ~256 bits)', () => {
    for (let i = 0; i < 20; i++) {
      const { token } = issueFeedToken();
      expect(token).toHaveLength(43);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // base64url: no padding, no + or /.
      expect(token).not.toContain('=');
      expect(token).not.toContain('+');
      expect(token).not.toContain('/');
    }
  });

  it('never repeats', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(issueFeedToken().token);
    expect(seen.size).toBe(500);
  });

  it('returns the sha256 hex of the token — the only thing that is stored', () => {
    const { token, tokenHash } = issueFeedToken();
    expect(tokenHash).toHaveLength(64);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(tokenHash).not.toContain(token);
  });

  it('returns a short non-secret prefix for display', () => {
    const { token, prefix } = issueFeedToken();
    expect(prefix).toHaveLength(8);
    expect(token.startsWith(prefix)).toBe(true);
  });
});

describe('hashFeedToken', () => {
  it('is stable and matches the issuing hash', () => {
    const { token, tokenHash } = issueFeedToken();
    expect(hashFeedToken(token)).toBe(tokenHash);
    expect(hashFeedToken(token)).toBe(hashFeedToken(token));
  });
});

describe('isFeedTokenShape', () => {
  it('accepts a freshly issued token', () => {
    expect(isFeedTokenShape(issueFeedToken().token)).toBe(true);
  });

  it('rejects anything that is not exactly 43 base64url characters', () => {
    const cases = [
      '',
      'short',
      'a'.repeat(42),
      'a'.repeat(44),
      `${'a'.repeat(42)}+`,
      `${'a'.repeat(42)}/`,
      `${'a'.repeat(42)}=`,
      `${'a'.repeat(42)}.`,
      '../../etc/passwd',
    ];
    for (const value of cases) expect(isFeedTokenShape(value)).toBe(false);
  });

  it('exposes the shape as a non-global regex, so it carries no lastIndex state', () => {
    expect(FEED_TOKEN_SHAPE_RE.global).toBe(false);
    const token = issueFeedToken().token;
    expect(FEED_TOKEN_SHAPE_RE.test(token)).toBe(true);
    expect(FEED_TOKEN_SHAPE_RE.test(token)).toBe(true);
  });
});

describe('tokenHashMatches — constant time', () => {
  it('matches a hash against itself', () => {
    const { tokenHash } = issueFeedToken();
    expect(tokenHashMatches(tokenHash, tokenHash)).toBe(true);
  });

  it('rejects a different hash', () => {
    expect(tokenHashMatches(issueFeedToken().tokenHash, issueFeedToken().tokenHash)).toBe(false);
  });

  it('rejects a null or length-mismatched stored hash without throwing', () => {
    const { tokenHash } = issueFeedToken();
    expect(tokenHashMatches(tokenHash, null)).toBe(false);
    expect(tokenHashMatches(tokenHash, '')).toBe(false);
    expect(tokenHashMatches(tokenHash, 'abc')).toBe(false);
    // `crypto.timingSafeEqual` throws on unequal lengths; the wrapper must not.
    expect(tokenHashMatches(tokenHash, tokenHash.slice(0, 63))).toBe(false);
  });

  it('uses timingSafeEqual rather than string equality', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(
        new URL(
          '../../../src/modules/product_feeds/services/feed-token.service.ts',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    expect(source).toContain('timingSafeEqual');
  });
});

describe('isFeedPubliclyServable', () => {
  const servable = {
    enabled: true,
    tokenHash: 'a'.repeat(64),
    tokenRevokedAt: null,
    publishedArtefactId: '11111111-1111-4111-8111-111111111111',
  };

  it('is true for an enabled feed with a live token and a published artefact', () => {
    expect(isFeedPubliclyServable(servable)).toBe(true);
  });

  it('is false once the token is revoked — a revoked token never resolves', () => {
    expect(isFeedPubliclyServable({ ...servable, tokenRevokedAt: new Date() })).toBe(false);
    expect(isFeedPubliclyServable({ ...servable, tokenHash: null })).toBe(false);
  });

  it('is false while the feed is disabled', () => {
    expect(isFeedPubliclyServable({ ...servable, enabled: false })).toBe(false);
  });

  it('is false before the first successful run', () => {
    expect(isFeedPubliclyServable({ ...servable, publishedArtefactId: null })).toBe(false);
  });
});
