import { describe, expect, it } from 'vitest';
import { BlogSettingsResolver } from '../../../../packages/modules/blog/src/backend/services/blog-settings-resolver.js';
import type { SettingsServicePort } from '../../../../packages/modules/blog/src/backend/services/blog-settings-resolver.js';
import {
  BLOG_DEFAULT_ENABLED,
  BLOG_DEFAULT_LATEST_COUNT,
  BLOG_DEFAULT_POSTS_PER_PAGE,
  BLOG_DEFAULT_URL_PREFIX,
} from '../../../../packages/modules/blog/src/manifest.js';

const CHANNEL_ID = '11111111-1111-1111-1111-111111111111';

function makeStub(values: Record<string, unknown>): SettingsServicePort {
  return {
    async get<T>(code: string, _channelId: string, schema: { parse: (v: unknown) => T }): Promise<T> {
      if (!(code in values)) throw new Error(`unregistered: ${code}`);
      // Validate to match the real service's behaviour.
      return schema.parse(values[code]);
    },
  } as SettingsServicePort;
}

describe('BlogSettingsResolver (T015)', () => {
  it('returns documented defaults when no rows exist', async () => {
    const resolver = new BlogSettingsResolver(makeStub({}));
    const out = await resolver.getResolved(CHANNEL_ID);
    expect(out).toEqual({
      enabled: BLOG_DEFAULT_ENABLED,
      urlPrefix: BLOG_DEFAULT_URL_PREFIX,
      urlPrefixByLanguage: {},
      latestCount: BLOG_DEFAULT_LATEST_COUNT,
      postsPerPage: BLOG_DEFAULT_POSTS_PER_PAGE,
    });
  });

  it('per-channel values beat defaults', async () => {
    const resolver = new BlogSettingsResolver(
      makeStub({
        'blog.enabled': false,
        'blog.url_prefix': 'aktualnosci',
        'blog.latest_count': 8,
        'blog.posts_per_page': 16,
      }),
    );
    const out = await resolver.getResolved(CHANNEL_ID);
    expect(out).toEqual({
      enabled: false,
      urlPrefix: 'aktualnosci',
      urlPrefixByLanguage: {},
      latestCount: 8,
      postsPerPage: 16,
    });
  });

  it('clamps non-positive latest_count back to the default', async () => {
    const resolver = new BlogSettingsResolver(
      makeStub({ 'blog.latest_count': 0 }),
    );
    const out = await resolver.getResolved(CHANNEL_ID);
    expect(out.latestCount).toBe(BLOG_DEFAULT_LATEST_COUNT);
  });

  it('clamps a negative posts_per_page back to the default', async () => {
    const resolver = new BlogSettingsResolver(
      makeStub({ 'blog.posts_per_page': -3 }),
    );
    const out = await resolver.getResolved(CHANNEL_ID);
    expect(out.postsPerPage).toBe(BLOG_DEFAULT_POSTS_PER_PAGE);
  });

  it('falls back when url_prefix shape is invalid', async () => {
    const resolver = new BlogSettingsResolver(
      makeStub({ 'blog.url_prefix': 'Not Valid' }),
    );
    const out = await resolver.getResolved(CHANNEL_ID);
    expect(out.urlPrefix).toBe(BLOG_DEFAULT_URL_PREFIX);
  });

  // The `blog.url_prefix` write rule moved to `BlogUrlPrefixService.validator()`,
  // registered with the settings module (feature 171); it is exercised through the
  // Settings API in `test/integration/blog/url-prefix-validation.test.ts`.
});
