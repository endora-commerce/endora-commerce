import { defineModuleSettingsManifest } from '@b2b/contracts';

/**
 * Built-in settings manifest for the Blog module — feature 016 / R7.
 *
 * Reserves the `blog` group and registers four settings the module
 * consumes through `settings.service.getValue(...)`:
 *
 *   - blog.enabled          (boolean, default true)
 *   - blog.url_prefix       (string,  default 'blog')   — single URL segment
 *   - blog.latest_count     (number,  default 5)        — index "latest N"
 *   - blog.posts_per_page   (number,  default 12)       — pagination page size
 *
 * Range bounds (`latest_count` ≥ 1, `posts_per_page` ≥ 1) and the
 * url-prefix shape + reserved-segments check live in
 * `services/blog-settings-resolver.ts` (the Settings module's value-type
 * registry only validates primitive shapes).
 */
export const BLOG_SETTING_CODES = {
  ENABLED: 'blog.enabled',
  URL_PREFIX: 'blog.url_prefix',
  LATEST_COUNT: 'blog.latest_count',
  POSTS_PER_PAGE: 'blog.posts_per_page',
} as const;

export const BLOG_DEFAULT_ENABLED = true;
export const BLOG_DEFAULT_URL_PREFIX = 'blog';
export const BLOG_DEFAULT_LATEST_COUNT = 5;
export const BLOG_DEFAULT_POSTS_PER_PAGE = 12;

export const blogManifest = defineModuleSettingsManifest({
  moduleCode: 'blog',
  groups: [
    {
      code: 'blog',
      name: 'Blog',
    },
  ],
  settings: [
    {
      code: BLOG_SETTING_CODES.ENABLED,
      name: 'Blog enabled',
      description:
        'When false, every blog URL on the storefront returns 404 in this scope. Set per Sales Channel to disable the blog for a specific audience while leaving it on globally.',
      groupCode: 'blog',
      valueType: 'boolean',
      defaultValue: BLOG_DEFAULT_ENABLED,
    },
    {
      code: BLOG_SETTING_CODES.URL_PREFIX,
      name: 'Blog URL prefix',
      description:
        "Single URL segment under which the blog is served (e.g. 'blog' → /blog, 'aktualnosci' → /aktualnosci). Must match ^[a-z0-9-]+$ and avoid reserved segments.",
      groupCode: 'blog',
      valueType: 'string',
      defaultValue: BLOG_DEFAULT_URL_PREFIX,
    },
    {
      code: BLOG_SETTING_CODES.LATEST_COUNT,
      name: 'Latest posts on the blog index',
      description:
        'How many newest posts the blog index page shows. Sensible range 1..20.',
      groupCode: 'blog',
      valueType: 'number',
      defaultValue: BLOG_DEFAULT_LATEST_COUNT,
    },
    {
      code: BLOG_SETTING_CODES.POSTS_PER_PAGE,
      name: 'Posts per page in Category and Tag views',
      description:
        'Page size for the paginated post list on Category and Tag pages. Sensible range 1..100.',
      groupCode: 'blog',
      valueType: 'number',
      defaultValue: BLOG_DEFAULT_POSTS_PER_PAGE,
    },
  ],
});
