import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

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
    // Two seams, both in the boot seeder, both into `admin_roles`.
    //
    // `systemRoleCodePort` (feature 075, Phase C) registers this module's two
    // role codes as deletion-protected, where the seeder used to import
    // `admin_roles`' module-level function. That registry is ungated.
    //
    // `adminRolePort` (feature 075, the boundary drain) is where the two role
    // rows are written, in place of the three raw SQL statements that named
    // `admin_roles`' own table. That one is gated, so it fails closed: with no
    // `admin_roles` in the composition the seeder throws, `runBootHooks`
    // re-throws as `ModuleCompositionError` and the platform exits rather than
    // serving with two roles nobody granted. `admin_roles` is non-deactivatable,
    // so no operator flip reaches that state — only a deployment that never
    // shipped the module, which `composeModules` refuses up front. The
    // declaration therefore buys install and migration order rather than a
    // flip-time refusal.
    'admin_roles',
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
    // `languages` owns `languageReferenceRegistry`, the registry this module
    // contributes its two "which languages do posts and categories carry"
    // descriptors to (feature 077, D-87). `languages` used to ask the question
    // itself, with two `count(*)` statements naming this module's tables.
    'languages',
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
  /**
   * The nineteen error codes this module owns — feature 090 Phase 3
   * (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md`
   * §1.1). This is where the sentence for each is looked up from: `errors.<CODE>`
   * in this module's own `i18n/{en,pl}.json`, which holds all nineteen in both
   * languages. None of them is a `check-error-translations.ts`
   * `UNTRANSLATED_ERROR_CODES` entry.
   *
   * The list is answer-preserving, not a judgement (§6.2 and §6.5), and it was
   * not written by hand: it is the verbatim output of the runbook's step-1
   * derivation over the frozen capture at
   * `backend/test/fixtures/error-code-routing/chain-answers.ts`, which records
   * what the prefix chain in `@endora-commerce/mod-i18n` answered at
   * `49f3c6817`. Re-routing a code to a better owner is
   * `specs/082-error-code-ownership/rulings.md` §9's remaining work and is
   * deliberately not done here.
   *
   * **No code here is a shadow, and that is worth stating rather than leaving a
   * reader to check.** Trap T1 exists because the chain is an ordered `if` and
   * an earlier rule can claim a code a later one names — it cost `inventory` two
   * codes and gave `catalog` four. `blog` has a single rule, `BLOG_`, no misc
   * set, and nothing above it claims a `BLOG_`-prefixed code: the nineteen the
   * chain answers with are exactly the nineteen `BLOG_`-prefixed members of
   * `ERROR_CODES`, so the source reading and the answer reading coincide for this
   * module. The derivation was still run from the answer, because "no shadow
   * reaches me" is a conclusion of reading the whole chain and not a premise a
   * migrating author is entitled to.
   *
   * **Five of the nineteen are raised nowhere in the tree** —
   * `BLOG_ASSET_KIND_MISMATCH`, `BLOG_CATEGORY_NO_CHANNEL`,
   * `BLOG_POST_NO_CHANNEL`, `BLOG_POST_NO_LANGUAGE` and `BLOG_SLUG_INVALID`. Each
   * is a member of `ERROR_CODES` with a sentence in both languages that no
   * `throw` in `backend/src` or `packages` can produce; the refusals they were
   * written for are delivered by the schemas instead, as `VALIDATION_FAILED`
   * (`test/contract/blog/admin-posts.contract.test.ts` says so in its own
   * comment). Ownership follows the capture and not the raise sites, so they are
   * declared: dropping them would red the progress test as `undeclared` and
   * would move an answer this merge request is not allowed to move. Whether the
   * codes should exist at all is a separate question from who owns them.
   *
   * The inverse is also true here and is T2's shape: this module raises
   * `VERSION_CONFLICT` (three sites) and `INTERNAL` (two), which the chain routes
   * to `core`, so they are not declared here and the sentences stay where they
   * are.
   *
   * No `tokens`: no code here carries a refusal discriminator. Derived from the
   * raise sites per the runbook's §5 — every `errors.<CODE>.<token>` key is a
   * value the envelope reads out of `details.code`, no `new HttpError` in this
   * module passes a `code` member at all, and the module's bundles hold no
   * `errors.BLOG_*.<token>` key in the other direction.
   */
  errorCodes: [
    { code: 'BLOG_ASSET_KIND_MISMATCH' },
    { code: 'BLOG_CATEGORY_CYCLE' },
    { code: 'BLOG_CATEGORY_HAS_CHILDREN' },
    { code: 'BLOG_CATEGORY_IN_USE' },
    { code: 'BLOG_CATEGORY_NOT_FOUND' },
    { code: 'BLOG_CATEGORY_NO_CHANNEL' },
    { code: 'BLOG_CATEGORY_PROTECTED' },
    { code: 'BLOG_DISABLED' },
    { code: 'BLOG_POST_NOT_FOUND' },
    { code: 'BLOG_POST_NO_CHANNEL' },
    { code: 'BLOG_POST_NO_LANGUAGE' },
    { code: 'BLOG_RELATED_POST_SELF_REFERENCE' },
    { code: 'BLOG_SLUG_INVALID' },
    { code: 'BLOG_SLUG_TAKEN' },
    { code: 'BLOG_TAG_CODE_TAKEN' },
    { code: 'BLOG_TAG_IN_USE' },
    { code: 'BLOG_TAG_NOT_FOUND' },
    { code: 'BLOG_URL_PREFIX_INVALID' },
    { code: 'BLOG_URL_PREFIX_RESERVED' },
  ],
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
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
