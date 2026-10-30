import {
  CMS_TRANSLATION_DEFAULT_MAX_SOURCE_CHARACTERS,
  defineModuleManifest,
  defineModuleSettingsManifest,
  type ModuleCliCommand,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { DEFAULT_BREAKPOINTS, type PageBuilderBreakpoints } from '@endora-commerce/page-builder-core/types/responsive';

export const CMS_PAGE_BUILDER_SETTING_CODES = {
  BREAKPOINT_TABLET_MIN: 'cms.page_builder.breakpoint.tablet_min',
  BREAKPOINT_DESKTOP_MIN: 'cms.page_builder.breakpoint.desktop_min',
  COLOR_PALETTE: 'cms.page_builder.color_palette',
  /**
   * Feature 151 — the Page Builder's Translate action: its own switch (not the
   * module's activation control, which stays `cms.enabled`), the LLM credential
   * it uses, and the most source text one click may send.
   */
  TRANSLATION_ENABLED: 'cms.page_builder.translation.enabled',
  TRANSLATION_LLM_CREDENTIALS: 'cms.page_builder.translation.llm_credentials',
  TRANSLATION_MAX_SOURCE_CHARACTERS: 'cms.page_builder.translation.max_source_characters',
} as const;

/** Feature 151 — the code a role needs to use the Translate action. */
export const CMS_TRANSLATE_PERMISSION = 'cms.translate';

/**
 * The deployment's reserved first path segments
 * (`specs/105-cms-root-page-urls/` FR-031/FR-032;
 * `contracts/cms-page-url.md` §5.2).
 *
 * A CMS page lives at the storefront root, `/{slug}`, so a page slugged
 * `cart` saves, publishes and is never served: a root catch-all is Next's
 * lowest-priority match and the storefront's own `/cart` wins. Nothing here
 * creates that precedence and nothing may (§5.0) — this value is what lets the
 * module tell the operator *before* the page disappears.
 *
 * **The value is the deployment's and the default is empty**, which is not a
 * gap left open. The set is a fact about a *storefront's route table*; a
 * headless backend serves storefronts it did not build, so a list shipped in
 * `cms` would be a derived fact about a consumer written into the owner — stale
 * the first time any client adds a route, and stale in the direction that fails
 * open. The reference storefront publishes its own segments as
 * `RESERVED_TOP_LEVEL_SEGMENTS` (`storefront/app/reserved-segments.ts`),
 * reconciled against its route tree by `check:storefront-indexability`, and a
 * deployment copies its value from there.
 */
export const CMS_SETTING_CODES = {
  RESERVED_SLUG_SEGMENTS: 'cms.reserved_slug_segments',
  /**
   * Feature 163 (FR-033) — the sharing image a page without its own uses. The
   * `*_asset_id` suffix gives the generic Settings screen its asset picker.
   */
  DEFAULT_SHARE_IMAGE_ASSET_ID: 'cms.default_share_image_asset_id',
  /**
   * Feature 169 (data-model §3.1) — who receives the messages of the `cms.ContactForm`
   * block, per sales channel. Read by the server per request; never in page data.
   */
  CONTACT_FORM_RECIPIENTS: 'cms.contact_form_recipients',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'cms',
  groups: [
    { code: 'cms', name: 'CMS' },
    { code: 'cms_page_builder', name: 'Page Builder' },
    // Feature 169 — the contact form's recipients.
    { code: 'cms_contact_form', name: 'Contact form' },
  ],
  settings: [
    {
      // Feature 073 — the operator's activation control. Platform-wide.
      code: 'cms.enabled',
      name: 'CMS enabled',
      description:
        'Switches the CMS admin screens, its API and the storefront pages, blocks and hooks it serves on or off. Nothing is dropped: pages, blocks, templates and hook attachments stay in the database and reappear exactly as they were when you switch it back on.',
      groupCode: 'cms',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      // Feature 105 — the deployment's reserved first path segments. See
      // `CMS_SETTING_CODES` above for why the list is yours and not ours.
      code: CMS_SETTING_CODES.RESERVED_SLUG_SEGMENTS,
      name: 'Reserved page-slug segments',
      description:
        'First path segments your storefront already serves, as a JSON array of strings — for example ["cart","checkout","catalog"]. A CMS page is served at your storefront root, so a page whose slug starts with one of these would never be shown: the storefront route wins. Saving such a page is refused, and the page editor warns while the slug is being typed. Leave it empty and nothing is refused. The reference storefront publishes the segments it owns in storefront/app/reserved-segments.ts; a custom storefront has its own list.',
      groupCode: 'cms',
      valueType: 'json',
      defaultValue: [],
    },
    {
      code: CMS_PAGE_BUILDER_SETTING_CODES.BREAKPOINT_TABLET_MIN,
      name: 'Tablet breakpoint (min-width px)',
      description:
        'Minimum viewport width in pixels for the tablet tier in the CMS Page Builder preview and responsive styles.',
      groupCode: 'cms_page_builder',
      valueType: 'number',
      defaultValue: DEFAULT_BREAKPOINTS.tabletMin,
    },
    {
      code: CMS_PAGE_BUILDER_SETTING_CODES.BREAKPOINT_DESKTOP_MIN,
      name: 'Desktop breakpoint (min-width px)',
      description:
        'Minimum viewport width in pixels for the desktop tier in the CMS Page Builder preview and responsive styles.',
      groupCode: 'cms_page_builder',
      valueType: 'number',
      defaultValue: DEFAULT_BREAKPOINTS.desktopMin,
    },
    {
      code: CMS_PAGE_BUILDER_SETTING_CODES.COLOR_PALETTE,
      name: 'Page Builder color palette',
      description:
        'Global named colors available in the CMS Page Builder color fields. Each entry has a display name and hex value.',
      groupCode: 'cms_page_builder',
      valueType: 'json',
      defaultValue: [],
    },
    // Feature 151 — the Translate action (`specs/151-page-builder-translate/`).
    // Platform-wide like the module's other non-channel settings; read per
    // request, so a change applies to the next click without a restart.
    {
      code: CMS_PAGE_BUILDER_SETTING_CODES.TRANSLATION_ENABLED,
      name: 'Translation enabled',
      description:
        'Shows the Translate button in the Page Builder. When on, editors with the "Translate Page Builder content with AI" permission can translate a canvas into the language being edited. The text of the canvas is sent to the provider of the model chosen below.',
      groupCode: 'cms_page_builder',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: CMS_PAGE_BUILDER_SETTING_CODES.TRANSLATION_LLM_CREDENTIALS,
      name: 'Translation credentials',
      description:
        'The LLM credential configuration (Credentials screen) whose provider, model and API key the Translate button uses. Supported providers: OpenAI, Anthropic, Google, DeepSeek and any OpenAI-compatible endpoint (through the configuration\'s Base URL). Required for the button to work.',
      groupCode: 'cms_page_builder',
      valueType: 'credential_ref',
      configurationType: 'llm',
      defaultValue: '',
    },
    {
      code: CMS_PAGE_BUILDER_SETTING_CODES.TRANSLATION_MAX_SOURCE_CHARACTERS,
      name: 'Translation size limit (characters)',
      description:
        'The most text, in characters, one click of Translate may send to the model (default 40 000, allowed 1 000–200 000). A higher limit lets longer pages be translated at once but costs more per click and makes the editor wait longer on a single request, which a slow provider or a proxy timeout can then cut off. Larger content is refused before anything is sent.',
      groupCode: 'cms_page_builder',
      valueType: 'number',
      defaultValue: CMS_TRANSLATION_DEFAULT_MAX_SOURCE_CHARACTERS,
    },
    // Feature 163 (FR-033; data-model §1.4). Read per request for the
    // request's channel, so a channel may carry an image of its own.
    {
      code: CMS_SETTING_CODES.DEFAULT_SHARE_IMAGE_ASSET_ID,
      name: 'Default sharing image',
      description:
        'The image shown when a CMS page is shared on social networks and in messengers, for every page that has no sharing image of its own. Choose a public image from the Assets Library; about 1200 × 630 px suits most networks. Leave empty and such pages are shared without an image. Can be overridden per sales channel.',
      groupCode: 'cms_page_builder',
      valueType: 'string',
      defaultValue: '',
    },
    // Feature 169 (research R-8). Read per request for the request's channel; not `secret`
    // — an address is not a credential, and the operator has to read it back.
    {
      code: CMS_SETTING_CODES.CONTACT_FORM_RECIPIENTS,
      name: 'Contact form recipients',
      description:
        'The e-mail addresses that receive the messages sent with the Contact form block on this sales channel — at most 10. Leave empty and the form answers that it is unavailable. Can be overridden per sales channel. Never shown on the storefront.',
      groupCode: 'cms_contact_form',
      valueType: 'string_list',
      defaultValue: [],
    },
  ],
});

export const cmsSettingsManifest = settings;

export const manifest = defineModuleManifest({
  id: 'cms',
  name: 'CMS',
  description: 'Pages, blocks, templates, and hooks for content management.',
  version: '1.0.0',
  /**
   * What this module needs from the environment (`specs/117-instance-bring-up/`
   * FR-002). Only what it **owns**: its reads of platform-owned names are
   * satisfied by `packages/platform/src/env/index.ts`.
   *
   * Why each of these is not a Setting is its entry in
   * `backend/scripts/ledgers/module-environment-inputs/cms.ts`.
   */
  env: [
    {
      name: 'CMS_PB_BREAKPOINT_TABLET_MIN',
      describes: {
        en: 'The viewport width, in pixels, at which the Page Builder’s tablet preview begins.',
        pl: 'Szerokość okna w pikselach, od której zaczyna się podgląd tabletowy w kreatorze stron.',
      },
      requirement: {
        kind: 'optional',
        without: {
          en: 'The Page Builder previews at the platform’s breakpoints rather than this storefront theme’s, so an editor lays pages out against widths the shop does not use.',
          pl: 'Kreator stron pokazuje podgląd przy punktach granicznych platformy, a nie motywu tego sklepu, więc redaktor układa strony dla szerokości, których sklep nie używa.',
        },
      },
      secret: false,
      generable: false,
      owner: { kind: 'module', moduleId: 'cms' },
      consumers: ['backend'],
      addressOf: null,
    },
    {
      name: 'CMS_PB_BREAKPOINT_DESKTOP_MIN',
      describes: {
        en: 'The viewport width, in pixels, at which the Page Builder’s desktop preview begins.',
        pl: 'Szerokość okna w pikselach, od której zaczyna się podgląd desktopowy w kreatorze stron.',
      },
      requirement: {
        kind: 'optional',
        without: {
          en: 'The Page Builder previews at the platform’s breakpoints rather than this storefront theme’s, so an editor lays pages out against widths the shop does not use.',
          pl: 'Kreator stron pokazuje podgląd przy punktach granicznych platformy, a nie motywu tego sklepu, więc redaktor układa strony dla szerokości, których sklep nie używa.',
        },
      },
      secret: false,
      generable: false,
      owner: { kind: 'module', moduleId: 'cms' },
      consumers: ['backend'],
      addressOf: null,
    },
  ],
  // `auth` owns the `requireAdmin` port both route files are gated by, and
  // `settings` owns the store the page-builder resolvers read and write.
  // `assets_library` owns the reference registry this module contributes its
  // embedded-asset scan to (T143a) — the edge existed as a composition root's
  // cross-registration, which is to say it existed nowhere an operator, the
  // lifecycle or the migration order could see it.
  // `languages` owns `languageReferenceRegistry`, the registry this module
  // contributes its "which languages do pages carry" descriptor to (feature 077,
  // D-87). `languages` used to ask the question itself, with a jsonb
  // containment test against `cms_pages` — this module's table.
  // Feature 169 (research R-6): `email` owns `emailMailer`, the transport the contact form
  // sends through, and `_i18n` owns `adminI18nService`, which writes that e-mail in the
  // channel's language. Both are non-deactivatable, so neither edge costs the operator a switch.
  dependencies: ['assets_library', 'languages', 'sales_channels', 'auth', 'settings', 'email', '_i18n'],
  nonBindingDependencies: [
    {
      moduleId: 'credentials',
      name: 'credentialsService',
      kind: 'degrades-without',
      whenAbsent:
        'Page Builder translation reports itself unavailable; every other CMS function keeps working.',
      reason:
        'Feature 151 (research R11). The Translate action resolves its LLM credential through this ' +
        'port per request, after asking whether `credentials` is present, and answers ' +
        '`unavailable` / `409 CMS_TRANSLATION_UNAVAILABLE` when it is not. Not `dependencies`: ' +
        'the function is optional and off by default, and the edge would make `credentials` ' +
        'a module the operator could not switch off while the CMS is on.',
    },
  ],
  /**
   * Error codes this module owns — feature 090, Phase 3
   * (`specs/090-module-owned-error-codes/`).
   *
   * The list is the incumbent prefix chain's **answer**, copied from the frozen
   * capture (`backend/test/fixtures/error-code-routing/chain-answers.ts`, taken
   * at `49f3c6817`) rather than judged: the migration is answer-preserving over
   * all 289 codes and re-routing is out of scope (runbook §6.5). Ten codes, and
   * this module happens to be the clean case for trap T1 — the chain's
   * `startsWith('CMS_')` rule shadows nothing and is shadowed by nothing, so its
   * source and its answer agree here, which is not true of the four codes T1
   * names.
   *
   * **Two names a reader would attribute elsewhere, and both are ours.**
   * `CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE` names two other modules' nouns and
   * belongs to neither: it is raised twice in `cms-page-service.ts`, once when a
   * page's content is written in a language the page does not carry and once
   * when a page's declared languages are not in the union its assigned sales
   * channels resolve. `megamenu` owns the identically shaped
   * `MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE` on the same reading.
   * `CMS_REFERENCED` is the cross-entity reference guard for pages, blocks and
   * templates — not a narrowing of `assets_library`'s `ASSET_REFERENCED`, which
   * is that module's and stays there.
   *
   * **And the inverse: seven raises this module makes and must not declare.**
   * `VERSION_CONFLICT` four times (the `If-Match` guard in each of the four
   * entity services) and `VALIDATION_FAILED` three times (the storefront
   * route's missing-parameter refusals). Both route to `core`, because
   * ownership follows the domain noun and never the thrower (D-95.2).
   *
   * **No `tokens`, and that is derived rather than assumed.** The envelope's
   * `refusalToken` (`packages/platform/src/http/error-envelope.ts`) reads one
   * member of `details` — `code` — as the tail of `errors.<CODE>.<token>`. All
   * 32 raises of these ten codes were enumerated over `packages` and
   * `backend/src` in both spellings (`ERROR_CODES.<CODE>` and the bare string
   * literal, runbook step 2), and not one passes a fourth argument at all;
   * neither do the seven `core`-owned raises above. The runbook §5 tree-wide
   * scan agrees, printing the same ten codes over 41 sites it has printed since
   * `catalog`, none of them a `CMS_` one. The bundle agrees from the other
   * direction: ten `errors.<CODE>` keys in `en` and `pl`, no
   * `errors.<CODE>.<token>` key in either.
   *
   * **One code nothing raises: `CMS_SCHEMA_UPGRADE_FAILED`** — declared anyway,
   * because ownership follows the capture (trap T10) and deleting it would move
   * an answer this merge request may not move. It is reported, not repaired;
   * the finding is in the merge request and belongs to
   * `specs/deferred-defects.md` § *Roughly 29 error codes have translated
   * sentences no client can ever receive*.
   */
  errorCodes: [
    { code: 'CMS_BLOCK_NOT_FOUND' },
    { code: 'CMS_CODE_CONFLICT' },
    { code: 'CMS_HOOK_NOT_FOUND' },
    { code: 'CMS_HOOK_SYSTEM_PROTECTED' },
    { code: 'CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE' },
    { code: 'CMS_PAGE_NOT_FOUND' },
    { code: 'CMS_REFERENCED' },
    { code: 'CMS_SCHEMA_UPGRADE_FAILED' },
    { code: 'CMS_SLUG_CONFLICT' },
    // Feature 105. Its sentence names the offending segment through the
    // envelope's `details` → `{placeholder}` path, so the operator reads which
    // path would win rather than being told a slug is "invalid".
    { code: 'CMS_SLUG_RESERVED' },
    { code: 'CMS_TEMPLATE_NOT_FOUND' },
    // Feature 163 (`specs/163-page-builder-marketing-pages/` data-model §6). The
    // anchor sentences name the anchor through `details` → `{anchor}`.
    { code: 'CMS_DUPLICATE_ANCHOR' },
    { code: 'CMS_RESERVED_ANCHOR' },
    { code: 'CMS_PAGE_PARENT_CYCLE' },
    // Feature 151 — the Page Builder translation (`contracts/page-builder-translation-api.md` §3).
    // `TOO_LARGE` names the configured limit through `details` → `{limit}`;
    // `PROVIDER_FAILED` chooses its sentence by `details.code`.
    { code: 'CMS_TRANSLATION_DISABLED' },
    { code: 'CMS_TRANSLATION_NOT_CONFIGURED' },
    { code: 'CMS_TRANSLATION_UNAVAILABLE' },
    { code: 'CMS_TRANSLATION_TOO_LARGE' },
    { code: 'CMS_TRANSLATION_SELECTION_NOT_FOUND' },
    {
      code: 'CMS_TRANSLATION_PROVIDER_FAILED',
      tokens: ['credentials_rejected', 'rate_limited', 'unavailable', 'timeout', 'malformed'],
    },
    // Feature 169 (data-model §3.2) — the contact form on a channel with no recipients.
    { code: 'CMS_CONTACT_FORM_UNAVAILABLE' },
  ],
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  settings,
  permissions: [
    { code: 'cms.read', label: 'View CMS content' },
    { code: 'cms.write', label: 'Edit CMS content' },
    { code: CMS_TRANSLATE_PERMISSION, label: 'Translate Page Builder content with AI' },
    // Feature 163 — the brand tokens are every page at once, so saving them is
    // its own decision; reading them stays `cms.read` (the canvas is styled with
    // them). `PUT /api/v1/admin/cms/brand-tokens`.
    { code: 'cms.brand', label: 'Edit brand settings', requires: ['cms.read'] },
  ],
  actions: [
    {
      id: 'new-page',
      labelKey: 'actions.newPage.label',
      descriptionKey: 'actions.newPage.description',
      icon: 'FileText',
      targetRoute: '/cms/pages/new',
      requiredPermission: 'cms.write',
      keywords: ['page', 'new', 'create', 'strona', 'nowa', 'utwórz'],
      weight: 130,
    },
    // Navigation to the four list screens, under the read code that opens
    // them and with the glyphs their sidebar rows draw (`src/admin/index.ts`).
    {
      id: 'open-pages',
      labelKey: 'actions.openPages.label',
      descriptionKey: 'actions.openPages.description',
      icon: 'Newspaper',
      targetRoute: '/cms/pages',
      requiredPermission: 'cms.read',
      keywords: ['cms', 'pages', 'page', 'content', 'strony', 'strona', 'treści'],
      weight: 131,
    },
    {
      id: 'open-blocks',
      labelKey: 'actions.openBlocks.label',
      descriptionKey: 'actions.openBlocks.description',
      icon: 'Newspaper',
      targetRoute: '/cms/blocks',
      requiredPermission: 'cms.read',
      keywords: ['cms', 'blocks', 'block', 'bloki', 'blok'],
      weight: 132,
    },
    {
      id: 'open-templates',
      labelKey: 'actions.openTemplates.label',
      descriptionKey: 'actions.openTemplates.description',
      icon: 'Newspaper',
      targetRoute: '/cms/templates',
      requiredPermission: 'cms.read',
      keywords: ['cms', 'templates', 'template', 'szablony', 'szablon'],
      weight: 133,
    },
    {
      id: 'open-hooks',
      labelKey: 'actions.openHooks.label',
      descriptionKey: 'actions.openHooks.description',
      icon: 'Webhook',
      targetRoute: '/cms/hooks',
      requiredPermission: 'cms.read',
      keywords: ['cms', 'hooks', 'hook', 'hooki'],
      weight: 134,
    },
    // Feature 151 — the generic Settings screen has no per-group address, so
    // the entry opens it under the code it is gated by (the `seo` precedent).
    {
      id: 'open-page-builder-translation-settings',
      labelKey: 'actions.openPageBuilderTranslationSettings.label',
      descriptionKey: 'actions.openPageBuilderTranslationSettings.description',
      icon: 'Sparkles',
      targetRoute: '/settings',
      requiredPermission: 'settings:read',
      keywords: [
        'translate',
        'translation',
        'ai',
        'llm',
        'page builder',
        'tłumacz',
        'tłumaczenie',
        'przetłumacz',
        'kreator stron',
      ],
      weight: 135,
    },
    // Feature 163 — the brand screen (`contracts/storefront-and-admin-api.md`
    // §6). Under the read code that opens it; saving there needs `cms.brand`.
    // No palette glyph is on the allowlist, so it draws its sidebar row's.
    {
      id: 'open-cms-brand',
      labelKey: 'actions.openCmsBrand.label',
      descriptionKey: 'actions.openCmsBrand.description',
      icon: 'Layers',
      targetRoute: '/cms/brand',
      requiredPermission: 'cms.read',
      keywords: [
        'brand',
        'fonts',
        'colours',
        'colors',
        'typography',
        'theme',
        // The schema's ceiling is ten: the contract's six, and four Polish.
        'marka',
        'czcionki',
        'kolory',
        'motyw',
      ],
      weight: 136,
    },
    // Feature 169 (FR-023) — the recipients are edited on the generic Settings screen, which
    // has no per-group address, so the entry opens it under the code it is gated by.
    {
      id: 'open-contact-form-settings',
      labelKey: 'actions.openContactFormSettings.label',
      descriptionKey: 'actions.openContactFormSettings.description',
      icon: 'Inbox',
      targetRoute: '/settings',
      requiredPermission: 'settings:read',
      keywords: [
        'contact',
        'form',
        'recipients',
        'e-mail',
        'enquiries',
        'kontakt',
        'formularz',
        'odbiorcy',
        'zapytania',
      ],
      weight: 137,
    },
  ],
  // Feature 073 — the operator's activation control. A platform without a CMS
  // is a smaller platform, not a broken one: pages, blocks and hooks are
  // content, and switching the module off hides the screens and the storefront
  // surface without dropping a row.
  activation: { settingCode: 'cms.enabled', default: true },
  /**
   * The 30 Page Builder blocks this module owns, and the eight CMS palette
   * sections its own blocks populate (feature 096,
   * `specs/096-page-builder-block-ownership/` §7.1 and §2.1).
   *
   * `catalog` is **not** among them although the CMS palette renders a Catalog
   * section today: `cms` owns no block in it, the five that populate it are
   * `catalog`'s, and a section is declared by the module whose blocks occupy it
   * (`contracts/block-definition.md` §1.1's authoring guidance).
   *
   * `internal` is the hidden drawer that keeps `cms.Column`, `cms.Slide` and
   * the Carousel's item blocks (feature 163) out of Puck's *Other* group, where
   * they are insertable outside their parent and render wrong. It was keyed `_internal` until this feature; the key grammar
   * `blockCategoryKeyRe` forbids a leading underscore, so it is `internal` —
   * the same word, the same title and the same behaviour.
   *
   * `fields` and `previewIcon` are the registration at `plugin.ts`'s
   * `register('cms', …)` call, moved rather than rewritten; `responsiveFields`
   * are `defaultPageBuilderConfig`'s. Nothing reads either through the manifest
   * until Phase 2's registry work (T209/T210).
   */
  blocks: [
    // Feature 163, plan § Owner ruling 2026-10-23 (FR-000): the one block that
    // carries section settings, with a slot for any blocks; top level only.
    // Its settings hold no text (the anchor is an identifier), so nothing is
    // translated here — the slot's blocks are, through their own declarations.
    {
      name: 'cms.Section',
      translatable: [],
      labelKey: 'blocks.section.label',
      descriptionKey: 'blocks.section.description',
      category: 'layout',
      contexts: ['cms'],
      fields: {},
      // T117: the settings are top-level props; these sit on the editor's Responsive tab
      // (R19C, T260/T261: the width and the background outset too).
      responsiveFields: ['width', 'spaceTop', 'spaceBottom', 'contentPosition', 'overlap'],
      weight: 5,
    },
    // Feature 163, T158 (plan § Owner ruling 2026-10-26): the top-level container
    // of Sections, painting one scheme, background and decorative layer behind
    // them. No prose: its Sections are their own nodes.
    {
      name: 'cms.SectionGroup',
      translatable: [],
      labelKey: 'blocks.sectionGroup.label',
      descriptionKey: 'blocks.sectionGroup.description',
      category: 'layout',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['spaceTop', 'spaceBottom'],
      weight: 6,
    },
    {
      name: 'cms.Row',
      translatable: [],
      labelKey: 'blocks.row.label',
      descriptionKey: 'blocks.row.description',
      category: 'layout',
      contexts: ['cms'],
      fields: {
        gap: { type: 'number', label: 'Gap' },
        align: {
          type: 'select',
          label: 'Align',
          options: [
            { label: 'stretch', value: 'stretch' },
            { label: 'start', value: 'start' },
            { label: 'center', value: 'center' },
            { label: 'end', value: 'end' },
          ],
        },
      },
      responsiveFields: [
        'contentMaxWidth',
        'customMaxWidthPx',
        'contentPosition',
        'minHeight',
        'gap',
        'rowGap',
        'verticalAlign',
        'margin',
        'padding',
        'border',
      ],
      weight: 10,
    },
    {
      name: 'cms.Spacer',
      translatable: [],
      labelKey: 'blocks.spacer.label',
      descriptionKey: 'blocks.spacer.description',
      category: 'layout',
      contexts: ['cms'],
      fields: { heightPx: { type: 'number', label: 'Height' } },
      responsiveFields: ['heightPx'],
      weight: 20,
    },
    {
      name: 'cms.Heading',
      // Feature 163 (T039): inline rich text. A heading stored before keeps a
      // plain string here until the editor opens it; the translation reads
      // that string as plain text.
      translatable: [{ path: 'text', format: 'tiptap' }],
      labelKey: 'blocks.heading.label',
      descriptionKey: 'blocks.heading.description',
      category: 'content',
      contexts: ['cms'],
      fields: {
        level: {
          type: 'select',
          label: 'Level',
          options: [
            { label: 'H1', value: 'h1' },
            { label: 'H2', value: 'h2' },
            { label: 'H3', value: 'h3' },
            { label: 'H4', value: 'h4' },
            { label: 'H5', value: 'h5' },
            { label: 'H6', value: 'h6' },
            { label: 'Paragraph', value: 'p' },
          ],
        },
        text: { type: 'richtext', label: 'Text' },
      },
      responsiveFields: [
        'size',
        'fontSize',
        'fontWeight',
        'align',
        'lineHeight',
        'margin',
        'padding',
        'border',
        // R19A (T226), R21G (T337).
        'textMaxWidth', 'textMaxWidthPx',
      ],
      weight: 10,
    },
    {
      name: 'cms.Text',
      // R19A (T232): `text` is inline rich text once edited; a plain string stored before is read as plain text.
      translatable: [{ path: 'text', format: 'tiptap' }, { path: 'tiptapContent', format: 'tiptap' }],
      labelKey: 'blocks.text.label',
      descriptionKey: 'blocks.text.description',
      category: 'content',
      contexts: ['cms'],
      fields: { text: { type: 'richtext', label: 'Text' } },
      responsiveFields: [
        'fontSize',
        'fontWeight',
        'textAlign',
        'lineHeight',
        'textMaxWidth',
        'textMaxWidthPx',
        'margin',
        'padding',
        'border',
      ],
      weight: 20,
    },
    {
      name: 'cms.RichContent',
      translatable: [{ path: 'content', format: 'tiptap' }],
      labelKey: 'blocks.richContent.label',
      descriptionKey: 'blocks.richContent.description',
      category: 'content',
      contexts: ['cms'],
      fields: { content: { type: 'richtext', label: 'Content' } },
      responsiveFields: ['textMaxWidth', 'textMaxWidthPx', 'margin', 'padding', 'border', 'textSize', 'textSizePx', 'listLineHeight'],
      weight: 30,
    },
    {
      name: 'cms.Button',
      // Feature 163 (T039): one `ButtonSpec`. A button stored before keeps its
      // top-level `label` until the editor opens it; both are translated.
      translatable: [{ path: 'button.label' }, { path: 'label' }],
      labelKey: 'blocks.button.label',
      descriptionKey: 'blocks.button.description',
      category: 'content',
      contexts: ['cms'],
      fields: {
        button: { type: 'object', label: 'Button', required: true },
        align: {
          type: 'select',
          label: 'Align',
          options: [
            { label: 'start', value: 'start' },
            { label: 'center', value: 'center' },
            { label: 'end', value: 'end' },
          ],
        },
      },
      // R19B (T246): an icon-only button's size per breakpoint.
      responsiveFields: ['button', 'align', 'fullWidth', 'margin', 'padding', 'border'],
      weight: 40,
    },
    {
      name: 'cms.Image',
      // Feature 163, T127: the caption is prose too.
      translatable: [{ path: 'alt' }, { path: 'caption' }],
      labelKey: 'blocks.image.label',
      descriptionKey: 'blocks.image.description',
      category: 'content',
      contexts: ['cms'],
      fields: {
        src: { type: 'text', label: 'Image URL', required: true },
        alt: { type: 'text', label: 'Alt text' },
      },
      // R19B (T251): the caption's placement, size and alignment per breakpoint.
      responsiveFields: ['widthMode', 'widthPx', 'ratio', 'align', 'captionPlacement', 'captionSize', 'captionSizePx', 'captionAlign', 'captionMaxWidthPx', 'margin', 'padding', 'border'],
      weight: 50,
    },
    {
      name: 'cms.Icons',
      translatable: [],
      labelKey: 'blocks.icons.label',
      descriptionKey: 'blocks.icons.description',
      category: 'content',
      contexts: ['cms'],
      fields: {
        name: { type: 'text', label: 'Icon name' },
        size: { type: 'number', label: 'Size' },
      },
      responsiveFields: ['align', 'margin', 'padding', 'border'],
      previewIcon: 'sparkles',
      weight: 60,
    },
    {
      name: 'cms.Social',
      translatable: [{ path: 'items[].label' }],
      labelKey: 'blocks.social.label',
      descriptionKey: 'blocks.social.description',
      category: 'content',
      contexts: ['cms'],
      fields: {
        layout: {
          type: 'select',
          label: 'Layout',
          options: [
            { label: 'Icons only', value: 'icons-only' },
            { label: 'Icons with labels', value: 'icons-with-labels' },
            { label: 'Vertical list', value: 'vertical-list' },
            { label: 'Pills', value: 'pills' },
          ],
        },
      },
      responsiveFields: ['align', 'margin', 'padding', 'border', 'gap', 'gapPx'],
      previewIcon: 'share',
      weight: 70,
    },
    {
      name: 'cms.FeatureList',
      // Feature 163 (T049): a heading, inline rich titles, rich bodies and an
      // image below the grid. A list stored before keeps plain titles and its
      // `description`s until the editor opens it; those are translated too.
      translatable: [
        { path: 'heading', format: 'tiptap' },
        { path: 'items[].title', format: 'tiptap' },
        { path: 'items[].body', format: 'tiptap' },
        { path: 'image.alt' },
        { path: 'items[].description' },
      ],
      labelKey: 'blocks.featureList.label',
      descriptionKey: 'blocks.featureList.description',
      category: 'content',
      contexts: ['cms'],
      fields: { items: { type: 'array', label: 'Features' } },
      responsiveFields: [
        'headingSize',
        'headingSizePx',
        'headingMaxWidth',
        'headingMaxWidthPx',
        'columns',
        'gap',
        'gapPx',
        'titleSize',
        'titleSizePx',
        'margin',
        'padding',
        'border',
        'headingWeight',
        'align',
        'titleWeight',
        // R19A (T224, T225).
        'titleLineHeight',
        'bodySize',
        'bodySizePx',
        'bodyLineHeight',
        // R20F (T317).
        'rowGapPx',
        'listLineHeight',
        // R22I.
        'iconPosition',
      ],
      previewIcon: 'layout',
      weight: 80,
    },
    {
      name: 'cms.Hero',
      // Feature 163 (T043): inline rich texts, a rich body, a button list and a
      // social-proof line. A hero stored before keeps `heading`, `subtitle` and
      // `buttonLabel` until the editor opens it; those are translated too.
      translatable: [
        { path: 'eyebrow' },
        { path: 'title', format: 'tiptap' },
        { path: 'subheading', format: 'tiptap' },
        { path: 'statement', format: 'tiptap' },
        { path: 'body', format: 'tiptap' },
        { path: 'buttons[].label' },
        { path: 'socialProof.caption' },
        { path: 'media.image.alt' },
        { path: 'socialProof.image.alt' },
        { path: 'heading' },
        { path: 'subtitle' },
        { path: 'buttonLabel' },
      ],
      labelKey: 'blocks.hero.label',
      descriptionKey: 'blocks.hero.description',
      category: 'content',
      contexts: ['cms'],
      fields: {
        title: { type: 'richtext', label: 'Title' },
        buttons: { type: 'array', label: 'Buttons' },
      },
      responsiveFields: [
        'titleSize',
        'titleSizePx',
        'titleMaxWidth',
        'titleMaxWidthPx',
        'subheadingSize',
        'subheadingSizePx',
        'statementSize',
        'statementSizePx',
        'buttons',
        'buttonsFullWidth',
        'minHeight',
        'minHeightPx',
        'gaps',
        'margin',
        'padding',
        'border',
        'titleWeight',
        'align',
        // R19A (T227–T229).
        'subheadingLineHeight',
        'subheadingMaxWidth',
        'subheadingMaxWidthPx',
        'statementLineHeight',
        'statementMaxWidth',
        'statementMaxWidthPx',
        'bodySize',
        'bodySizePx',
        'bodyLineHeight',
        'bodyMaxWidth',
        'bodyMaxWidthPx',
        'gapsPx',
        'mediaSpace',
        'mediaSpacePx',
        // R20E.
        'titleLineHeight',
        'eyebrowSizePx',
        'eyebrowLineHeight',
        'proofCaptionPlacement',
        'proofCaptionMaxWidthPx',
        // R23 (T436).
        'eyebrowSize',
      ],
      weight: 90,
    },
    // Feature 163 (T047) — the composition blocks of US3 (contracts/blocks.md).
    {
      name: 'cms.MediaText',
      // `rows[].media.image.alt` beside the contract's paths: a row's image is
      // read by a screen reader as the first row's is.
      translatable: [
        { path: 'heading', format: 'tiptap' },
        { path: 'body', format: 'tiptap' },
        { path: 'features[].title', format: 'tiptap' },
        { path: 'features[].body' },
        { path: 'buttons[].label' },
        { path: 'footnote', format: 'tiptap' },
        { path: 'media.image.alt' },
        { path: 'rows[].heading', format: 'tiptap' },
        { path: 'rows[].body', format: 'tiptap' },
        { path: 'rows[].features[].title', format: 'tiptap' },
        { path: 'rows[].features[].body' },
        { path: 'rows[].buttons[].label' },
        { path: 'rows[].media.image.alt' },
      ],
      labelKey: 'blocks.mediaText.label',
      descriptionKey: 'blocks.mediaText.description',
      category: 'content',
      contexts: ['cms'],
      fields: {
        heading: { type: 'richtext', label: 'Heading' },
        media: { type: 'object', label: 'Media' },
        body: { type: 'richtext', label: 'Text' },
      },
      // Feature 163, T160: the item titles' size per breakpoint.
      responsiveFields: [
        'headingSize', 'headingSizePx', 'headingMaxWidth', 'headingMaxWidthPx', 'featureTitleSize', 'featureTitleSizePx', 'buttons', 'buttonsFullWidth', 'headingWeight', 'featureTitleWeight',
        // R20F (T315): the text size.
        'bodySize', 'bodySizePx', 'bodyLineHeight', 'headingLineHeight',
        // R22I.
        'columnGapPx', 'featureBodySize', 'featureBodySizePx',
      ],
      weight: 92,
    },
    {
      name: 'cms.BackgroundPanel',
      translatable: [
        { path: 'heading', format: 'tiptap' },
        { path: 'body', format: 'tiptap' },
        { path: 'buttons[].label' },
        { path: 'image.alt' },
      ],
      labelKey: 'blocks.backgroundPanel.label',
      descriptionKey: 'blocks.backgroundPanel.description',
      category: 'content',
      contexts: ['cms'],
      fields: {
        image: { type: 'object', label: 'Image', required: true },
        heading: { type: 'richtext', label: 'Heading' },
      },
      // R20F (T316): the text box's margin and padding.
      responsiveFields: ['headingSize', 'headingSizePx', 'headingMaxWidth', 'headingMaxWidthPx', 'buttons', 'buttonsFullWidth', 'minHeight', 'headingWeight'],
      weight: 94,
    },
    {
      name: 'cms.CtaCard',
      translatable: [
        { path: 'heading', format: 'tiptap' },
        { path: 'body', format: 'tiptap' },
        { path: 'list[].text' },
        { path: 'buttons[].label' },
        { path: 'image.alt' },
      ],
      labelKey: 'blocks.ctaCard.label',
      descriptionKey: 'blocks.ctaCard.description',
      category: 'content',
      contexts: ['cms'],
      fields: {
        heading: { type: 'richtext', label: 'Heading' },
        buttons: { type: 'array', label: 'Buttons' },
      },
      // R20F (T318): the card's padding and the image's columns.
      responsiveFields: ['headingSize', 'headingSizePx', 'headingMaxWidth', 'headingMaxWidthPx', 'buttons', 'buttonsFullWidth', 'headingWeight', 'imageColumns', 'bodySize', 'bodySizePx', 'textMaxWidth', 'textMaxWidthPx'],
      weight: 96,
    },
    {
      name: 'cms.Statement',
      translatable: [
        { path: 'heading', format: 'tiptap' },
        { path: 'body', format: 'tiptap' },
        { path: 'background.image.alt' },
      ],
      labelKey: 'blocks.statement.label',
      descriptionKey: 'blocks.statement.description',
      category: 'content',
      contexts: ['cms'],
      fields: { heading: { type: 'richtext', label: 'Heading' } },
      responsiveFields: [
        'headingSize',
        'headingSizePx',
        'textMaxWidth',
        'textMaxWidthPx',
        'headingWeight',
        'align',
        // R19A (T231).
        'minHeight',
        'minHeightPx',
        'headingLineHeight',
        'bodySize',
        'bodySizePx',
        'bodyLineHeight',
      ],
      weight: 98,
    },
    {
      // Feature 163 (T072, FR-028): rows of a title, a description and a button.
      name: 'cms.LinkList',
      translatable: [
        { path: 'heading', format: 'tiptap' },
        { path: 'items[].title' },
        { path: 'items[].description' },
        { path: 'items[].button.label' },
      ],
      labelKey: 'blocks.linkList.label',
      descriptionKey: 'blocks.linkList.description',
      category: 'content',
      contexts: ['cms'],
      fields: { heading: { type: 'richtext', label: 'Heading' } },
      // R19A (T236): the row titles' size and weight.
      responsiveFields: ['headingSize', 'headingSizePx', 'headingMaxWidth', 'headingMaxWidthPx', 'headingWeight', 'titleSize', 'titleSizePx', 'titleLineHeight'],
      weight: 99,
    },
    {
      name: 'cms.LogoStrip',
      translatable: [{ path: 'items[].alt' }],
      labelKey: 'blocks.logoStrip.label',
      descriptionKey: 'blocks.logoStrip.description',
      category: 'content',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['margin', 'padding', 'border', 'align', 'gap', 'gapPx'],
      weight: 100,
    },
    {
      name: 'cms.Testimonial',
      // Feature 163 (T049): a rich quote (a plain quote stored before is read
      // as plain text under the same path), the image and the avatar.
      translatable: [
        { path: 'quote', format: 'tiptap' },
        { path: 'author' },
        { path: 'role' },
        { path: 'image.alt' },
        { path: 'avatar.alt' },
      ],
      labelKey: 'blocks.testimonial.label',
      descriptionKey: 'blocks.testimonial.description',
      category: 'content',
      contexts: ['cms'],
      fields: { quote: { type: 'richtext', label: 'Quote' } },
      responsiveFields: ['margin', 'padding', 'border', 'quoteSize', 'quoteSizePx'],
      weight: 110,
    },
    {
      name: 'cms.Stats',
      // Feature 163 (T049): a heading and an image beside the figures.
      translatable: [
        { path: 'heading', format: 'tiptap' },
        { path: 'items[].value' },
        { path: 'items[].label' },
        { path: 'image.alt' },
      ],
      labelKey: 'blocks.stats.label',
      descriptionKey: 'blocks.stats.description',
      category: 'content',
      contexts: ['cms'],
      fields: { items: { type: 'array', label: 'Metrics' } },
      responsiveFields: [
        'headingSize',
        'headingSizePx',
        'headingMaxWidth',
        'headingMaxWidthPx',
        'columns',
        'gap',
        'gapPx',
        'valueSize',
        'valueSizePx',
        'margin',
        'padding',
        'border',
        'headingWeight',
        'align',
        // R19A (T235).
        'labelSize',
        'labelSizePx',
        // R20F (T319).
        'labelLineHeight',
        // R22I.
        'columnGapPx', 'valueLineHeight',
      ],
      weight: 120,
    },
    {
      name: 'cms.AnnouncementBar',
      translatable: [{ path: 'text' }],
      labelKey: 'blocks.announcementBar.label',
      descriptionKey: 'blocks.announcementBar.description',
      category: 'content',
      contexts: ['cms'],
      fields: { text: { type: 'text', label: 'Message' } },
      weight: 130,
    },
    {
      name: 'cms.SimpleTable',
      translatable: [
        { path: 'columns[].label' },
        { path: 'tableRows[].cells[].value' },
        { path: 'headers[].label' },
        { path: 'rows[].cells[].value' },
      ],
      labelKey: 'blocks.simpleTable.label',
      descriptionKey: 'blocks.simpleTable.description',
      category: 'content',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['margin', 'padding', 'border'],
      weight: 140,
    },
    {
      name: 'cms.Video',
      translatable: [{ path: 'title' }],
      labelKey: 'blocks.video.label',
      descriptionKey: 'blocks.video.description',
      category: 'media',
      contexts: ['cms'],
      fields: { url: { type: 'text', label: 'Video URL' } },
      // Feature 163, T126: the aspect ratio is per breakpoint.
      responsiveFields: ['aspectRatio', 'maxWidth', 'align', 'margin', 'padding', 'border'],
      weight: 10,
    },
    {
      name: 'cms.Map',
      translatable: [{ path: 'markers[].label' }],
      labelKey: 'blocks.map.label',
      descriptionKey: 'blocks.map.description',
      category: 'media',
      contexts: ['cms'],
      fields: {
        provider: {
          type: 'select',
          label: 'Provider',
          options: [
            { label: 'Leaflet + OSM', value: 'leaflet' },
            { label: 'Google Maps', value: 'google' },
          ],
        },
      },
      responsiveFields: ['height', 'margin', 'padding', 'border'],
      weight: 20,
    },
    {
      // Feature 163 (T054, T055): labelled "Carousel"; the image slider is
      // gone, its items are `cms.CarouselImage` slides (research R-12, FR-041a).
      name: 'cms.ContentSlider',
      translatable: [
        { path: 'header.heading', format: 'tiptap' },
        { path: 'header.lead' },
        { path: 'header.button.label' },
        // T131: the filter bar's labels; the tags themselves are keys, not prose.
        { path: 'filter.allLabel' },
        { path: 'filter.tags[].label' },
      ],
      labelKey: 'blocks.contentSlider.label',
      descriptionKey: 'blocks.contentSlider.description',
      category: 'interactive',
      contexts: ['cms'],
      fields: {},
      responsiveFields: [
        'headingSize',
        'headingSizePx',
        'headingMaxWidth',
        'headingMaxWidthPx',
        'slidesPerView',
        'gap',
        'gapPx',
        'controlsPlacement',
        'controlsAlign',
        'columns',
        'margin',
        'padding',
        'border',
        'headingWeight',
        // R22I.
        'headingLineHeight',
      ],
      weight: 10,
    },
    {
      name: 'cms.Tabs',
      // Feature 163 (R-13): a panel's blocks sit in the `items[].panel` slot and
      // are translated through their own declarations. `items[].content` is
      // only ever the HTML a page stored before, until the editor converts it.
      translatable: [{ path: 'items[].label' }, { path: 'items[].content', format: 'html' }],
      labelKey: 'blocks.tabs.label',
      descriptionKey: 'blocks.tabs.description',
      category: 'interactive',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['tabSize', 'panelGap', 'panelGapPx', 'margin', 'padding', 'border', 'align'],
      weight: 30,
    },
    {
      // Feature 169 (US5): links to sections of the same page; the anchors are ids, not prose.
      name: 'cms.PageNavigation',
      translatable: [{ path: 'label' }, { path: 'items[].label' }],
      labelKey: 'blocks.pageNavigation.label',
      descriptionKey: 'blocks.pageNavigation.description',
      category: 'interactive',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['align', 'margin', 'padding', 'border'],
      weight: 35,
    },
    {
      name: 'cms.Accordion',
      // Feature 163 (R-13): as `cms.Tabs` — blocks in `items[].panel`, stored HTML in `items[].content`.
      translatable: [{ path: 'items[].title' }, { path: 'items[].content', format: 'html' }],
      labelKey: 'blocks.accordion.label',
      descriptionKey: 'blocks.accordion.description',
      category: 'interactive',
      contexts: ['cms'],
      fields: {},
      // Feature 163, T175: the title padding per breakpoint; T182: the space above an open panel and between items;
      // T185: the title weight; T186: the space below an open panel and after an open item.
      responsiveFields: [
        'titleSize', 'titleSizePx', 'titleWeight', 'titlePadding', 'titlePaddingPx', 'panelGap', 'panelGapPx', 'itemGap', 'itemGapPx',
        'panelPaddingBottom', 'panelPaddingBottomPx', 'openItemGap', 'openItemGapPx', 'margin', 'padding', 'border', 'titleLineHeight',
      ],
      weight: 40,
    },
    {
      name: 'cms.Column',
      translatable: [],
      labelKey: 'blocks.column.label',
      descriptionKey: 'blocks.column.description',
      category: 'internal',
      contexts: ['cms'],
      fields: { span: { type: 'number', label: 'Width (1–12)' } },
      // Feature 163, T159: the column's order in the row per breakpoint; T165: its placement in the row's grid;
      // R19C (T265): its box's outset past the track.
      responsiveFields: ['span', 'stackOrder', 'rowSpan', 'columnStart', 'rowStart', 'margin', 'padding', 'border', 'outsetPx'],
      weight: 10,
    },
    {
      name: 'cms.Slide',
      translatable: [],
      labelKey: 'blocks.slide.label',
      descriptionKey: 'blocks.slide.description',
      category: 'internal',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['margin', 'padding', 'border'],
      weight: 20,
    },
    // Feature 163 (T054): the Carousel's item blocks, insertable only into its
    // `slides` (contracts/blocks.md, research R-12).
    {
      name: 'cms.CarouselImage',
      // R19B (T249): the read-more label is prose too.
      translatable: [{ path: 'image.alt' }, { path: 'caption', format: 'tiptap' }, { path: 'moreLabel' }],
      labelKey: 'blocks.carouselImage.label',
      descriptionKey: 'blocks.carouselImage.description',
      category: 'internal',
      contexts: ['cms'],
      fields: {},
      // Feature 163, T188: the caption's weight per breakpoint too. R19B (T249, T250): the caption's
      // padding and the read-more label's size.
      responsiveFields: ['captionSize', 'captionSizePx', 'captionWeight'],
      weight: 30,
    },
    {
      name: 'cms.CarouselSplit',
      translatable: [
        { path: 'title', format: 'tiptap' },
        { path: 'body', format: 'tiptap' },
        { path: 'buttons[].label' },
        { path: 'media.image.alt' },
      ],
      labelKey: 'blocks.carouselSplit.label',
      descriptionKey: 'blocks.carouselSplit.description',
      category: 'internal',
      contexts: ['cms'],
      fields: {},
      // R20F (T311, T312): the title's and the text's type, the space after a hanging icon.
      responsiveFields: [
        'buttons', 'buttonsFullWidth',
        'titleSize', 'titleSizePx', 'titleLineHeight', 'bodySize', 'bodySizePx', 'bodyLineHeight',
        // R22I.
        'columnGapPx',
      ],
      weight: 40,
    },
    {
      name: 'cms.LinkTile',
      translatable: [{ path: 'title', format: 'tiptap' }, { path: 'linkLabel' }, { path: 'image.alt' }],
      labelKey: 'blocks.linkTile.label',
      descriptionKey: 'blocks.linkTile.description',
      category: 'internal',
      contexts: ['cms'],
      fields: {},
      // Feature 163, T181: the resting title and label colours per breakpoint too; T188: their weights.
      responsiveFields: ['ratio', 'titleSize', 'titleSizePx', 'titleWeight', 'titleColor', 'labelSize', 'labelSizePx', 'labelWeight', 'labelColor'],
      weight: 50,
    },
    {
      name: 'cms.DownloadTile',
      translatable: [{ path: 'title' }, { path: 'subtitle' }, { path: 'linkLabel' }, { path: 'hoverImage.alt' }],
      labelKey: 'blocks.downloadTile.label',
      descriptionKey: 'blocks.downloadTile.description',
      category: 'internal',
      contexts: ['cms'],
      fields: {},
      // R19B (T247, T248): the card's padding, the title's size and the icon button's size per breakpoint.
      responsiveFields: ['titleSize', 'titleSizePx'],
      weight: 60,
    },
    {
      name: 'cms.NewsletterSignup',
      translatable: [
        { path: 'heading' },
        { path: 'description' },
        { path: 'placeholder' },
        { path: 'buttonLabel' },
        // Feature 163 (T076): the optional consent checkbox's label.
        { path: 'consentLabel', format: 'tiptap' },
      ],
      labelKey: 'blocks.newsletterSignup.label',
      descriptionKey: 'blocks.newsletterSignup.description',
      category: 'forms',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['margin', 'padding', 'border'],
      weight: 10,
    },
    {
      name: 'cms.ContactFormEmbed',
      translatable: [{ path: 'heading' }, { path: 'description' }],
      labelKey: 'blocks.contactFormEmbed.label',
      descriptionKey: 'blocks.contactFormEmbed.description',
      category: 'forms',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['margin', 'padding', 'border'],
      weight: 20,
    },
    // Feature 169 (data-model §3) — a form with a fixed field set that e-mails the shop.
    // Its text is translated per field; the recipients are a setting, never a prop.
    {
      name: 'cms.ContactForm',
      translatable: [
        { path: 'fields.name.label' },
        { path: 'fields.name.placeholder' },
        { path: 'fields.email.label' },
        { path: 'fields.email.placeholder' },
        { path: 'fields.phone.label' },
        { path: 'fields.phone.placeholder' },
        { path: 'fields.company.label' },
        { path: 'fields.company.placeholder' },
        { path: 'fields.subject.label' },
        { path: 'fields.subject.placeholder' },
        { path: 'fields.choice.label' },
        { path: 'fields.choice.placeholder' },
        { path: 'fields.message.label' },
        { path: 'fields.message.placeholder' },
        { path: 'fields.choice.options[].label' },
        { path: 'privacyConsent.label', format: 'tiptap' },
        { path: 'marketingConsent.label', format: 'tiptap' },
        { path: 'button.label' },
        { path: 'messages.success' },
        { path: 'messages.error' },
        { path: 'messages.unavailable' },
        { path: 'formLabel' },
      ],
      labelKey: 'blocks.contactForm.label',
      descriptionKey: 'blocks.contactForm.description',
      category: 'forms',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['margin', 'padding', 'border'],
      weight: 30,
    },
    {
      name: 'cms.RawHtml',
      translatable: [],
      labelKey: 'blocks.rawHtml.label',
      descriptionKey: 'blocks.rawHtml.description',
      category: 'advanced',
      contexts: ['cms'],
      fields: { html: { type: 'textarea', label: 'HTML' } },
      responsiveFields: ['margin', 'padding', 'border'],
      weight: 10,
    },
    {
      name: 'cms.RawJs',
      translatable: [],
      labelKey: 'blocks.rawJs.label',
      descriptionKey: 'blocks.rawJs.description',
      category: 'advanced',
      contexts: ['cms'],
      fields: { script: { type: 'textarea', label: 'JavaScript' } },
      responsiveFields: ['margin', 'padding', 'border'],
      weight: 20,
    },
    {
      name: 'cms.InsertBlock',
      translatable: [],
      labelKey: 'blocks.insertBlock.label',
      descriptionKey: 'blocks.insertBlock.description',
      category: 'embeds',
      contexts: ['cms'],
      fields: { code: { type: 'text', label: 'Block code', required: true } },
      weight: 10,
    },
    {
      name: 'cms.InsertTemplate',
      translatable: [],
      labelKey: 'blocks.insertTemplate.label',
      descriptionKey: 'blocks.insertTemplate.description',
      category: 'embeds',
      contexts: ['cms'],
      fields: { code: { type: 'text', label: 'Template code', required: true } },
      weight: 20,
    },
  ],
  blockCategories: [
    { key: 'layout', titleKey: 'blocks.category.layout', contexts: ['cms'], weight: 10 },
    { key: 'content', titleKey: 'blocks.category.content', contexts: ['cms'], weight: 20 },
    { key: 'media', titleKey: 'blocks.category.media', contexts: ['cms'], weight: 30 },
    { key: 'interactive', titleKey: 'blocks.category.interactive', contexts: ['cms'], weight: 50 },
    {
      key: 'internal',
      titleKey: 'blocks.category.internal',
      contexts: ['cms'],
      weight: 60,
      visible: false,
    },
    { key: 'forms', titleKey: 'blocks.category.forms', contexts: ['cms'], weight: 70 },
    { key: 'advanced', titleKey: 'blocks.category.advanced', contexts: ['cms'], weight: 80 },
    { key: 'embeds', titleKey: 'blocks.category.embeds', contexts: ['cms'], weight: 90 },
  ],
});

export function resolvePageBuilderBreakpointsFromEnv(): PageBuilderBreakpoints {
  const tabletRaw = process.env['CMS_PB_BREAKPOINT_TABLET_MIN'];
  const desktopRaw = process.env['CMS_PB_BREAKPOINT_DESKTOP_MIN'];
  const tabletMin = tabletRaw ? Number.parseInt(tabletRaw, 10) : DEFAULT_BREAKPOINTS.tabletMin;
  const desktopMin = desktopRaw ? Number.parseInt(desktopRaw, 10) : DEFAULT_BREAKPOINTS.desktopMin;
  return {
    tabletMin: Number.isFinite(tabletMin) ? tabletMin : DEFAULT_BREAKPOINTS.tabletMin,
    desktopMin: Number.isFinite(desktopMin) ? desktopMin : DEFAULT_BREAKPOINTS.desktopMin,
  };
}

/**
 * The operator's pre-flight report for the block-name migration (feature 096,
 * T410; `contracts/block-name-migration.md` §7).
 *
 * The body is `await import()`ed so the generated manifest index stays light —
 * this file is loaded by every check and every composition, and the report pulls
 * in the frozen rename map and the structural walk.
 */
export const cliCommands: ReadonlyArray<ModuleCliCommand<ModuleContext>> = [
  {
    name: 'block-names',
    summary:
      'Report the Page Builder block names stored in this database, and what the ' +
      'namespacing migration will do to each. Read-only.',
    run: async (context) => (await import('./backend/cli/block-names.js')).blockNames(context),
  },
];
