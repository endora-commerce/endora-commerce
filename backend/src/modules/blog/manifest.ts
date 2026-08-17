import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@b2b/contracts';

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
  /**
   * Feature 074 — the operator-activation control, and a **different switch**
   * from `ENABLED` below.
   *
   * `blog.enabled` is channel-scoped by design ("disable the blog for a
   * specific audience while leaving it on globally") and governs storefront
   * URLs only; the admin blog screens keep working under it. Activation is
   * platform-wide by construction — `resolveActivation` stops at
   * `global_value` → `default_value` and never joins the per-channel tier
   * (Constitution XII) — and it governs the whole module. Adopting the
   * existing code would have collapsed the two, and would have switched the
   * module off in every deployment that had set the storefront switch to
   * false globally, which is the state change FR-012 forbids on merge.
   */
  ACTIVATION: 'blog.activation',
  ENABLED: 'blog.enabled',
  URL_PREFIX: 'blog.url_prefix',
  LATEST_COUNT: 'blog.latest_count',
  POSTS_PER_PAGE: 'blog.posts_per_page',
} as const;

export const BLOG_DEFAULT_ENABLED = true;
export const BLOG_DEFAULT_URL_PREFIX = 'blog';
export const BLOG_DEFAULT_LATEST_COUNT = 5;
export const BLOG_DEFAULT_POSTS_PER_PAGE = 12;

const settings = defineModuleSettingsManifest({
  moduleCode: 'blog',
  groups: [
    {
      code: 'blog',
      name: 'Blog',
    },
  ],
  settings: [
    {
      // Feature 074 — the operator's activation control. Platform-wide, and
      // never channel-scoped: the reconciler's channel scope is additive-only,
      // so a channel-scoped first commit would have no way back.
      code: BLOG_SETTING_CODES.ACTIVATION,
      name: 'Blog enabled',
      description:
        'Switches the blog on or off as a whole: the storefront blog, its admin screens and its API. Nothing is dropped — every post, category, tag and media reference stays in the database and comes back exactly as it was when you switch it on again.',
      groupCode: 'blog',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: BLOG_SETTING_CODES.ENABLED,
      name: 'Blog storefront enabled',
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

/** Module-lifecycle manifest (feature 018). */
export const manifest = defineModuleManifest({
  id: 'blog',
  name: 'Blog',
  description:
    'Multi-channel, multi-language blog with categories, tags, and Page Builder posts.',
  version: '1.0.0',
  dependencies: [
    'assets_library',
    // Feature 072 (T061) — blog resolves the `requireAdmin` port, which `auth`
    // owns. Every admin route in this module is gated by it, so `auth` being
    // absent is not a degraded blog, it is a blog whose admin surface cannot be
    // guarded. The edge existed before this declaration; it simply existed
    // nowhere the lifecycle, the migration order or an operator could see it.
    'auth',
    'catalog',
    'cms',
    'dictionaries',
    'sales_channels',
    'settings',
  ],
  settings,
  // Feature 074 (Constitution XVII) — a control this module never had. Before
  // it, an operator could not decline the blog at all: a module with no
  // activation declaration resolves as activated. Editorial content is an
  // additional capability in ruling 1's sense — the catalogue stands without it
  // — so it is operator-controlled, and the default is `true` so that merging
  // this changes no deployment's state (FR-012).
  activation: { settingCode: BLOG_SETTING_CODES.ACTIVATION, default: true },
  i18n: { bundlesDir: 'i18n' },
  actions: [
    {
      id: 'new-post',
      labelKey: 'actions.newPost.label',
      descriptionKey: 'actions.newPost.description',
      icon: 'BookOpen',
      targetRoute: '/blog/posts/new',
      requiredPermission: 'blog.write',
      keywords: ['post', 'new', 'create', 'wpis', 'nowy'],
      weight: 140,
    },
  ],
});

/** Legacy export retained for backward compatibility. */
export const blogManifest = settings;
