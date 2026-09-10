import { describe, expect, it } from 'vitest';
import {
  PublicApiBaseUrlNotConfiguredError,
  absolutizePublicUrl,
  assertPublicApiBaseUrlConfigured,
  configuredPublicApiBaseUrl,
  resolvePublicApiBaseUrl,
} from './public-api-base-url.js';

/**
 * The public origin of this backend fails closed in production (issue #218).
 *
 * Before this rule, `PUBLIC_API_BASE_URL` was read at eight sites and each of
 * them invented `http://localhost:3001` when it was unset. That origin is what
 * every payment-gateway callback URL, every public product-feed URL and every
 * newsletter confirmation link is built on, so a production deployment that
 * never set the variable handed the gateway a callback it cannot reach — and
 * nothing logged, nothing refused, and no payment was ever confirmed.
 *
 * A value whose absence produces a wrong-but-plausible URL is worse than one
 * that refuses, which is the same argument `SESSION_COOKIE_SECRET` already
 * wins (`src/index.ts:12-18`). The refusal is deliberately **not** absolute:
 * three spellings of the same origin exist in the tree, and the shipped
 * `deploy/compose.prod.yml` supplies `BACKEND_PUBLIC_URL`, so a deployment that
 * is configured today keeps booting tomorrow. What is refused is a production
 * boot with *no* public origin at all.
 */

/** An environment with none of the three spellings and no `NODE_ENV`. */
function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...overrides };
}

describe('configuredPublicApiBaseUrl', () => {
  it('never invents an origin — absent means null, not localhost', () => {
    expect(configuredPublicApiBaseUrl(env())).toBeNull();
  });

  it('treats an empty or blank value as absent', () => {
    expect(configuredPublicApiBaseUrl(env({ PUBLIC_API_BASE_URL: '' }))).toBeNull();
    expect(configuredPublicApiBaseUrl(env({ PUBLIC_API_BASE_URL: '   ' }))).toBeNull();
  });

  it('reads all three spellings of the same origin, in precedence order', () => {
    expect(configuredPublicApiBaseUrl(env({ PUBLIC_API_BASE_URL: 'https://a.example' }))).toBe(
      'https://a.example',
    );
    // What `deploy/compose.prod.yml` has always derived from `API_DOMAIN`.
    expect(configuredPublicApiBaseUrl(env({ BACKEND_PUBLIC_URL: 'https://b.example' }))).toBe(
      'https://b.example',
    );
    // The spelling `tpay` / `payu` / `autopay` carry as their second choice.
    expect(configuredPublicApiBaseUrl(env({ API_PUBLIC_URL: 'https://c.example' }))).toBe(
      'https://c.example',
    );
    expect(
      configuredPublicApiBaseUrl(
        env({
          PUBLIC_API_BASE_URL: 'https://a.example',
          BACKEND_PUBLIC_URL: 'https://b.example',
          API_PUBLIC_URL: 'https://c.example',
        }),
      ),
    ).toBe('https://a.example');
  });

  it('strips trailing slashes, because every call site concatenates a path', () => {
    expect(configuredPublicApiBaseUrl(env({ PUBLIC_API_BASE_URL: 'https://a.example//' }))).toBe(
      'https://a.example',
    );
  });
});

describe('assertPublicApiBaseUrlConfigured', () => {
  it('refuses a production boot with no public origin at all', () => {
    expect(() => assertPublicApiBaseUrlConfigured(env({ NODE_ENV: 'production' }))).toThrow(
      PublicApiBaseUrlNotConfiguredError,
    );
  });

  it('names both variables an operator can set, so the message is actionable', () => {
    let message = '';
    try {
      assertPublicApiBaseUrlConfigured(env({ NODE_ENV: 'production' }));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('PUBLIC_API_BASE_URL');
    expect(message).toContain('BACKEND_PUBLIC_URL');
  });

  it('accepts a production boot configured through any one spelling', () => {
    expect(() =>
      assertPublicApiBaseUrlConfigured(
        env({ NODE_ENV: 'production', PUBLIC_API_BASE_URL: 'https://api.example' }),
      ),
    ).not.toThrow();
    // The already-deployed stack: `compose.prod.yml` sets this one and not the
    // other, so the refusal must not take it down.
    expect(() =>
      assertPublicApiBaseUrlConfigured(
        env({ NODE_ENV: 'production', BACKEND_PUBLIC_URL: 'https://api.example' }),
      ),
    ).not.toThrow();
  });

  it('leaves development and test alone', () => {
    expect(() => assertPublicApiBaseUrlConfigured(env())).not.toThrow();
    expect(() => assertPublicApiBaseUrlConfigured(env({ NODE_ENV: 'test' }))).not.toThrow();
  });
});

describe('resolvePublicApiBaseUrl', () => {
  it('returns the configured origin', () => {
    expect(
      resolvePublicApiBaseUrl(
        env({ NODE_ENV: 'production', BACKEND_PUBLIC_URL: 'https://api.example/' }),
      ),
    ).toBe('https://api.example');
  });

  it('falls back to the local API origin outside production', () => {
    expect(resolvePublicApiBaseUrl(env())).toBe('http://localhost:3001');
    expect(resolvePublicApiBaseUrl(env({ PORT: '4001' }))).toBe('http://localhost:4001');
  });

  it('refuses rather than inventing localhost in production', () => {
    expect(() => resolvePublicApiBaseUrl(env({ NODE_ENV: 'production' }))).toThrow(
      PublicApiBaseUrlNotConfiguredError,
    );
  });
});

/**
 * Feature 080 (T040b) — the three cases that travelled with
 * `absolutizePublicUrl` from `modules/email/absolutize-public-url.test.ts`,
 * unchanged. The function's only caller was and is the composition root; the
 * move takes a value import of a module's source out of it.
 */
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
