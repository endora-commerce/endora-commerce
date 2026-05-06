import { describe, expect, it } from 'vitest';
import { BlogSettingsResolver } from '../../../src/modules/blog/services/blog-settings-resolver.js';
import { HttpError } from '../../../src/http/error-envelope.js';

/**
 * Integration test for the URL-prefix validator (T088 / R7).
 *
 * The validator is exposed as a static method `assertValidPrefix` on the
 * resolver. The Settings admin form is expected to call this before
 * persisting `blog.url_prefix`. We exercise the validator directly here
 * — a contract test that drives it through the actual Settings admin
 * surface would require a custom value-type extension on the Settings
 * module that the v1 plan has explicitly deferred.
 */
describe('blog URL-prefix validator (T088)', () => {
  it('accepts canonical values', () => {
    expect(() => BlogSettingsResolver.assertValidPrefix('blog')).not.toThrow();
    expect(() => BlogSettingsResolver.assertValidPrefix('aktualnosci')).not.toThrow();
    expect(() => BlogSettingsResolver.assertValidPrefix('news-2026')).not.toThrow();
  });

  it('refuses empty / uppercase / path-like values with 400 BLOG_URL_PREFIX_INVALID', () => {
    const cases: unknown[] = ['', 'Blog', 'news/posts', 'has space', '-leading', 'trailing-'];
    for (const v of cases) {
      let caught: HttpError | null = null;
      try {
        BlogSettingsResolver.assertValidPrefix(v);
      } catch (e) {
        caught = e as HttpError;
      }
      expect(caught, `expected ${JSON.stringify(v)} to be refused`).toBeInstanceOf(HttpError);
      expect(caught!.statusCode).toBe(400);
      expect(caught!.code).toBe('BLOG_URL_PREFIX_INVALID');
    }
  });

  it('refuses reserved Next.js segments with 409 BLOG_URL_PREFIX_RESERVED', () => {
    for (const reserved of ['api', '_next', 'sitemap.xml', 'favicon.ico', 'robots.txt']) {
      let caught: HttpError | null = null;
      try {
        BlogSettingsResolver.assertValidPrefix(reserved);
      } catch (e) {
        caught = e as HttpError;
      }
      // `_next` and `manifest.webmanifest` fail the regex first → 400.
      // Plain-letter reserved values pass the regex and trip the
      // reserved-segment branch → 409.
      expect(caught).toBeInstanceOf(HttpError);
      if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(reserved)) {
        expect(caught!.statusCode).toBe(409);
        expect(caught!.code).toBe('BLOG_URL_PREFIX_RESERVED');
      } else {
        expect(caught!.statusCode).toBe(400);
        expect(caught!.code).toBe('BLOG_URL_PREFIX_INVALID');
      }
    }
  });
});
