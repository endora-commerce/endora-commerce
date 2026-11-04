import { describe, expect, it } from 'vitest';
import { blogDefaultPath, blogPath } from './blog.js';

/**
 * Feature 171 — the one seam every emitted blog URL is composed by
 * (`specs/171-blog-i18n-authors/contracts/routing-and-settings.md` §1).
 */

const plEn = (prefixDefaultLanguage: boolean) => ({
  languages: ['pl-PL', 'en-US'],
  defaultLanguage: 'pl-PL',
  prefixDefaultLanguage,
});

describe('blogPath', () => {
  it('prefixes every language when the channel prefixes its default language', () => {
    const channel = plEn(true);
    expect(blogPath({ view: 'index', languageCode: 'pl-PL', channel, prefix: 'aktualnosci' })).toBe('/pl/aktualnosci');
    expect(blogPath({ view: 'index', languageCode: 'en-US', channel, prefix: 'news' })).toBe('/en/news');
  });

  it('leaves the default language unprefixed when the channel does not prefix it', () => {
    const channel = plEn(false);
    expect(blogPath({ view: 'index', languageCode: 'pl-PL', channel, prefix: 'blog' })).toBe('/blog');
    expect(blogPath({ view: 'entry', key: 'wiertarki', languageCode: 'pl-PL', channel, prefix: 'blog' })).toBe(
      '/blog/wiertarki',
    );
    expect(blogPath({ view: 'entry', key: 'drills', languageCode: 'en-US', channel, prefix: 'blog' })).toBe(
      '/en/blog/drills',
    );
  });

  it('builds the tag view under the fixed tag segment', () => {
    expect(blogPath({ view: 'tag', code: 'diy', languageCode: 'pl-PL', channel: plEn(true), prefix: 'aktualnosci' })).toBe(
      '/pl/aktualnosci/tag/diy',
    );
  });

  it('adds ?page=N only from page 2 on', () => {
    const channel = plEn(false);
    expect(blogPath({ view: 'index', page: 1, languageCode: 'pl-PL', channel, prefix: 'blog' })).toBe('/blog');
    expect(blogPath({ view: 'index', page: 2, languageCode: 'pl-PL', channel, prefix: 'blog' })).toBe('/blog?page=2');
    expect(blogPath({ view: 'entry', key: 'porady', page: 3, languageCode: 'pl-PL', channel, prefix: 'blog' })).toBe(
      '/blog/porady?page=3',
    );
    expect(blogPath({ view: 'tag', code: 'diy', page: 2, languageCode: 'pl-PL', channel, prefix: 'blog' })).toBe(
      '/blog/tag/diy?page=2',
    );
  });

  it('URI-encodes the key and the tag code', () => {
    const channel = plEn(false);
    expect(blogPath({ view: 'entry', key: 'a b', languageCode: 'pl-PL', channel, prefix: 'blog' })).toBe('/blog/a%20b');
    expect(blogPath({ view: 'tag', code: 'a/b', languageCode: 'pl-PL', channel, prefix: 'blog' })).toBe('/blog/tag/a%2Fb');
  });

  it('throws on a language the channel does not have', () => {
    expect(() => blogPath({ view: 'index', languageCode: 'de-DE', channel: plEn(true), prefix: 'blog' })).toThrow();
  });
});

describe('blogDefaultPath', () => {
  it('is the unprefixed path — the x-default target', () => {
    expect(blogDefaultPath({ view: 'index', prefix: 'aktualnosci' })).toBe('/aktualnosci');
    expect(blogDefaultPath({ view: 'entry', key: 'porady', prefix: 'aktualnosci' })).toBe('/aktualnosci/porady');
    expect(blogDefaultPath({ view: 'tag', code: 'diy', page: 2, prefix: 'aktualnosci' })).toBe('/aktualnosci/tag/diy?page=2');
  });
});
