import {
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
} as const;

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
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'cms',
  groups: [
    { code: 'cms', name: 'CMS' },
    { code: 'cms_page_builder', name: 'Page Builder' },
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
  dependencies: ['assets_library', 'languages', 'sales_channels', 'auth', 'settings'],
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
  ],
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  settings,
  permissions: [
    { code: 'cms.read', label: 'View CMS content' },
    { code: 'cms.write', label: 'Edit CMS content' },
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
   * `internal` is the hidden drawer that keeps `cms.Column` and `cms.Slide` out
   * of Puck's *Other* group, where they are insertable outside their parent and
   * render wrong. It was keyed `_internal` until this feature; the key grammar
   * `blockCategoryKeyRe` forbids a leading underscore, so it is `internal` —
   * the same word, the same title and the same behaviour.
   *
   * `fields` and `previewIcon` are the registration at `plugin.ts`'s
   * `register('cms', …)` call, moved rather than rewritten; `responsiveFields`
   * are `defaultPageBuilderConfig`'s. Nothing reads either through the manifest
   * until Phase 2's registry work (T209/T210).
   */
  blocks: [
    {
      name: 'cms.Row',
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
      labelKey: 'blocks.heading.label',
      descriptionKey: 'blocks.heading.description',
      category: 'content',
      contexts: ['cms'],
      fields: {
        level: {
          type: 'select',
          label: 'Level',
          options: [
            { label: 'H1', value: 1 },
            { label: 'H2', value: 2 },
            { label: 'H3', value: 3 },
            { label: 'H4', value: 4 },
            { label: 'H5', value: 5 },
            { label: 'H6', value: 6 },
          ],
        },
        text: { type: 'text', label: 'Text' },
      },
      responsiveFields: [
        'fontSize',
        'fontWeight',
        'textAlign',
        'lineHeight',
        'margin',
        'padding',
        'border',
      ],
      weight: 10,
    },
    {
      name: 'cms.Text',
      labelKey: 'blocks.text.label',
      descriptionKey: 'blocks.text.description',
      category: 'content',
      contexts: ['cms'],
      fields: { text: { type: 'text', label: 'Text' } },
      responsiveFields: [
        'fontSize',
        'fontWeight',
        'textAlign',
        'lineHeight',
        'margin',
        'padding',
        'border',
      ],
      weight: 20,
    },
    {
      name: 'cms.RichContent',
      labelKey: 'blocks.richContent.label',
      descriptionKey: 'blocks.richContent.description',
      category: 'content',
      contexts: ['cms'],
      fields: { content: { type: 'richtext', label: 'Content' } },
      responsiveFields: ['margin', 'padding', 'border'],
      weight: 30,
    },
    {
      name: 'cms.Button',
      labelKey: 'blocks.button.label',
      descriptionKey: 'blocks.button.description',
      category: 'content',
      contexts: ['cms'],
      fields: {
        label: { type: 'text', label: 'Label', required: true },
        href: { type: 'text', label: 'Link target', required: true },
        variant: {
          type: 'select',
          label: 'Variant',
          options: [
            { label: 'primary', value: 'primary' },
            { label: 'secondary', value: 'secondary' },
            { label: 'ghost', value: 'ghost' },
          ],
        },
      },
      responsiveFields: ['variant', 'margin', 'padding', 'border'],
      weight: 40,
    },
    {
      name: 'cms.Image',
      labelKey: 'blocks.image.label',
      descriptionKey: 'blocks.image.description',
      category: 'content',
      contexts: ['cms'],
      fields: {
        src: { type: 'text', label: 'Image URL', required: true },
        alt: { type: 'text', label: 'Alt text' },
      },
      responsiveFields: ['widthMode', 'widthPx', 'align', 'margin', 'padding', 'border'],
      weight: 50,
    },
    {
      name: 'cms.Icons',
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
      responsiveFields: ['align', 'margin', 'padding', 'border'],
      previewIcon: 'share',
      weight: 70,
    },
    {
      name: 'cms.FeatureList',
      labelKey: 'blocks.featureList.label',
      descriptionKey: 'blocks.featureList.description',
      category: 'content',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['columns', 'gap', 'margin', 'padding', 'border'],
      previewIcon: 'layout',
      weight: 80,
    },
    {
      name: 'cms.Hero',
      labelKey: 'blocks.hero.label',
      descriptionKey: 'blocks.hero.description',
      category: 'content',
      contexts: ['cms'],
      fields: { heading: { type: 'text', label: 'Heading' } },
      responsiveFields: ['minHeightPx', 'margin', 'padding', 'border'],
      weight: 90,
    },
    {
      name: 'cms.LogoStrip',
      labelKey: 'blocks.logoStrip.label',
      descriptionKey: 'blocks.logoStrip.description',
      category: 'content',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['margin', 'padding', 'border'],
      weight: 100,
    },
    {
      name: 'cms.Testimonial',
      labelKey: 'blocks.testimonial.label',
      descriptionKey: 'blocks.testimonial.description',
      category: 'content',
      contexts: ['cms'],
      fields: { quote: { type: 'textarea', label: 'Quote' } },
      responsiveFields: ['margin', 'padding', 'border'],
      weight: 110,
    },
    {
      name: 'cms.Stats',
      labelKey: 'blocks.stats.label',
      descriptionKey: 'blocks.stats.description',
      category: 'content',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['columns', 'margin', 'padding', 'border'],
      weight: 120,
    },
    {
      name: 'cms.AnnouncementBar',
      labelKey: 'blocks.announcementBar.label',
      descriptionKey: 'blocks.announcementBar.description',
      category: 'content',
      contexts: ['cms'],
      fields: { text: { type: 'text', label: 'Message' } },
      weight: 130,
    },
    {
      name: 'cms.SimpleTable',
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
      labelKey: 'blocks.video.label',
      descriptionKey: 'blocks.video.description',
      category: 'media',
      contexts: ['cms'],
      fields: { url: { type: 'text', label: 'Video URL' } },
      responsiveFields: ['maxWidth', 'align', 'margin', 'padding', 'border'],
      weight: 10,
    },
    {
      name: 'cms.Map',
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
      name: 'cms.ContentSlider',
      labelKey: 'blocks.contentSlider.label',
      descriptionKey: 'blocks.contentSlider.description',
      category: 'interactive',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['slidesPerView', 'gap', 'margin', 'padding', 'border'],
      weight: 10,
    },
    {
      name: 'cms.ImageSlider',
      labelKey: 'blocks.imageSlider.label',
      descriptionKey: 'blocks.imageSlider.description',
      category: 'interactive',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['slidesPerView', 'gap', 'margin', 'padding', 'border'],
      weight: 20,
    },
    {
      name: 'cms.Tabs',
      labelKey: 'blocks.tabs.label',
      descriptionKey: 'blocks.tabs.description',
      category: 'interactive',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['margin', 'padding', 'border'],
      weight: 30,
    },
    {
      name: 'cms.Accordion',
      labelKey: 'blocks.accordion.label',
      descriptionKey: 'blocks.accordion.description',
      category: 'interactive',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['margin', 'padding', 'border'],
      weight: 40,
    },
    {
      name: 'cms.Column',
      labelKey: 'blocks.column.label',
      descriptionKey: 'blocks.column.description',
      category: 'internal',
      contexts: ['cms'],
      fields: { span: { type: 'number', label: 'Width (1–12)' } },
      responsiveFields: ['span', 'margin', 'padding', 'border'],
      weight: 10,
    },
    {
      name: 'cms.Slide',
      labelKey: 'blocks.slide.label',
      descriptionKey: 'blocks.slide.description',
      category: 'internal',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['margin', 'padding', 'border'],
      weight: 20,
    },
    {
      name: 'cms.NewsletterSignup',
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
      labelKey: 'blocks.contactFormEmbed.label',
      descriptionKey: 'blocks.contactFormEmbed.description',
      category: 'forms',
      contexts: ['cms'],
      fields: {},
      responsiveFields: ['margin', 'padding', 'border'],
      weight: 20,
    },
    {
      name: 'cms.RawHtml',
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
      labelKey: 'blocks.insertBlock.label',
      descriptionKey: 'blocks.insertBlock.description',
      category: 'embeds',
      contexts: ['cms'],
      fields: { code: { type: 'text', label: 'Block code', required: true } },
      weight: 10,
    },
    {
      name: 'cms.InsertTemplate',
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
