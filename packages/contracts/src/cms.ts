// CMS — feature 014 contract surface.
// Pages, Blocks, Templates, Hooks, Page Builder content envelope, and
// the storefront-side resolved-content shapes. Per Principle V, these
// schemas are the source of truth for every HTTP boundary in the new
// `cms` module. The Page Builder tree itself is opaque at this layer
// (Puck's wire format is treated as `unknown`); per-component validation
// happens server-side in the CMS module.

import { z } from 'zod';
import { storefrontPagePath, type ChannelUrlFacts } from './storefront-language-path.js';
import { isoDateTimeSchema, uuidSchema } from './common.js';
import { LlmProviderSchema } from './prompt-actions.js';
import { cmsBrandTokensSchema } from './cms-brand.js';

// ────────────────────────────────────────────────────────────────────
// Domain primitives
// ────────────────────────────────────────────────────────────────────

const cmsCodeRe = /^[a-z0-9][a-z0-9._-]{0,178}[a-z0-9]$/;
const cmsSlugRe = /^[a-z0-9](?:[a-z0-9/_-]{0,178}[a-z0-9])?$/;

export const cmsPageStatusSchema = z.enum(['draft', 'published', 'archived']);

/**
 * One language's own name, slug and description of a CMS page
 * (`specs/163-page-builder-marketing-pages/` R24, issue #521). Every field is
 * optional: an absent or blank one inherits the page's own field, which stays
 * the default for every language that does not override it.
 */
export const cmsPageTranslationSchema = z.object({
  name: z.string().max(200).optional(),
  slug: z.string().regex(cmsSlugRe).max(180).optional(),
  description: z.string().optional(),
});
export type CmsPageTranslation = z.infer<typeof cmsPageTranslationSchema>;

/** The per-language overrides of a CMS page, by BCP-47 language code (R24). */
export const cmsPageTranslationsSchema = z.record(z.string().min(2), cmsPageTranslationSchema);
export type CmsPageTranslations = z.infer<typeof cmsPageTranslationsSchema>;
export type CmsPageStatus = z.infer<typeof cmsPageStatusSchema>;

export const cmsContentEnvelopeSchema = z.object({
  // naming:allow-snake-case — the spelling is fixed by rows already in the
  // database, not by our API style: the applied CMS migration bakes
  // `{"schema_version":1,…}` into the `content` column defaults of
  // `cms_pages` / `cms_templates`. Renaming it would need a data migration
  // for no gain, since the key is deprecated and normalized away on read
  // (`packages/cms-components/src/schema/envelope.ts`).
  /** @deprecated Ignored — legacy rows may still carry this key. */
  schema_version: z.number().int().min(1).optional(),
  /** Per-language Puck data trees. The trees are opaque at this boundary. */
  languages: z.record(z.string().min(2), z.unknown()),
});
export type CmsContentEnvelope = z.infer<typeof cmsContentEnvelopeSchema>;

// ────────────────────────────────────────────────────────────────────
// Pages
// ────────────────────────────────────────────────────────────────────

export const cmsPageSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  status: cmsPageStatusSchema,
  active: z.boolean(),
  description: z.string().nullable(),
  salesChannelIds: z.array(uuidSchema),
  languages: z.array(z.string()),
  version: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  /**
   * The breadcrumb parent (feature 163, FR-030). On the list too, so the
   * editor's parent picker can leave out the page's own descendants; the
   * `cms_page.update` Command stays the authority (`CMS_PAGE_PARENT_CYCLE`).
   */
  parentPageId: uuidSchema.nullable(),
  /**
   * Whether the page's public path starts with its parent's (R19D, T281):
   * `false` keeps the flat `/<slug>` every page had before, so no stored page
   * changes address. The resulting path is `cmsPagePublicPaths`'s answer.
   */
  parentPathInUrl: z.boolean(),
  /**
   * Feature 167 (FR-041) — present when the page's first slug segment is a storefront
   * language prefix (or split alias) of a sales channel: `/<prefix>/…` is that
   * language's page, so the page is not reachable at its own address there. Saves
   * refuse such a slug; this marks a page that predates the language.
   */
  shadowedByLanguagePrefix: z
    .object({ prefix: z.string(), channelCodes: z.array(z.string()) })
    .optional(),
  /**
   * R24: the page's name, slug and description per language. `{}` — every
   * language inherits the fields above, which is every page stored before it.
   */
  translations: cmsPageTranslationsSchema,
});
export type CmsPageSummary = z.infer<typeof cmsPageSummarySchema>;

/** The breadcrumb colour scheme of a page (feature 163, FR-031). */
export const cmsBreadcrumbsSchemeSchema = z.enum(['light', 'muted', 'dark']);
export type CmsBreadcrumbsScheme = z.infer<typeof cmsBreadcrumbsSchemeSchema>;

export const cmsPageDetailSchema = cmsPageSummarySchema.extend({
  meta: z
    .record(
      z.string().min(2),
      z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        keywords: z.string().optional(),
      }),
    )
    .nullable(),
  content: cmsContentEnvelopeSchema,
  breadcrumbsVisible: z.boolean(),
  breadcrumbsScheme: cmsBreadcrumbsSchemeSchema,
  /**
   * R21H (T355): the trail drawn over the page's first section instead of in
   * a band above it. `false` (the default) keeps the band.
   */
  breadcrumbsOverlay: z.boolean(),
  /** The page's sharing image, an `assets_library` asset id (feature 163, FR-033). */
  shareImageAssetId: uuidSchema.nullable(),
});
export type CmsPageDetail = z.infer<typeof cmsPageDetailSchema>;

export const createCmsPageRequestSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().regex(cmsSlugRe).max(180),
  active: z.boolean().default(true),
  description: z.string().nullable().optional(),
  salesChannelIds: z.array(uuidSchema).min(1),
  languages: z.array(z.string().min(2)).min(1),
  meta: z
    .record(
      z.string().min(2),
      z.object({
        title: z.string().max(180).optional(),
        description: z.string().max(400).optional(),
        keywords: z.string().max(400).optional(),
      }),
    )
    .optional(),
  // Feature 163 (`contracts/storefront-and-admin-api.md` §2): optional on
  // create and patch alike; an absent key leaves the column's default or value.
  parentPageId: uuidSchema.nullable().optional(),
  breadcrumbsVisible: z.boolean().optional(),
  breadcrumbsScheme: cmsBreadcrumbsSchemeSchema.optional(),
  /** R21H (T355): the trail over the first section. Absent = `false`. */
  breadcrumbsOverlay: z.boolean().optional(),
  shareImageAssetId: uuidSchema.nullable().optional(),
  /** R19D (T281): serve the page under its parent's path. Absent = `false`. */
  parentPathInUrl: z.boolean().optional(),
  /**
   * R24: per-language name, slug and description. Absent leaves the stored
   * map; present replaces it whole. A key must be one of the page's languages.
   */
  translations: cmsPageTranslationsSchema.optional(),
});
export type CreateCmsPageRequest = z.infer<typeof createCmsPageRequestSchema>;

export const patchCmsPageRequestSchema = createCmsPageRequestSchema
  .partial()
  .extend({ version: z.number().int().optional() })
  .refine((x) => Object.keys(x).length > 0, { message: 'At least one field required.' });
export type PatchCmsPageRequest = z.infer<typeof patchCmsPageRequestSchema>;

export const putCmsPageContentRequestSchema = z.object({
  data: z.unknown(),
  version: z.number().int(),
});
export type PutCmsPageContentRequest = z.infer<typeof putCmsPageContentRequestSchema>;

// ────────────────────────────────────────────────────────────────────
// Blocks
// ────────────────────────────────────────────────────────────────────

export const cmsBlockSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
  active: z.boolean(),
  description: z.string().nullable(),
  salesChannelIds: z.array(uuidSchema),
  languages: z.array(z.string()),
  version: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type CmsBlockSummary = z.infer<typeof cmsBlockSummarySchema>;

export const cmsBlockDetailSchema = cmsBlockSummarySchema.extend({
  content: cmsContentEnvelopeSchema,
});
export type CmsBlockDetail = z.infer<typeof cmsBlockDetailSchema>;

export const createCmsBlockRequestSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().regex(cmsCodeRe).max(180),
  active: z.boolean().default(true),
  description: z.string().nullable().optional(),
  salesChannelIds: z.array(uuidSchema).min(1),
  languages: z.array(z.string().min(2)).min(1),
});
export type CreateCmsBlockRequest = z.infer<typeof createCmsBlockRequestSchema>;

export const patchCmsBlockRequestSchema = createCmsBlockRequestSchema
  .partial()
  .extend({ version: z.number().int().optional() })
  .refine((x) => Object.keys(x).length > 0, { message: 'At least one field required.' });
export type PatchCmsBlockRequest = z.infer<typeof patchCmsBlockRequestSchema>;

// ────────────────────────────────────────────────────────────────────
// Templates
// ────────────────────────────────────────────────────────────────────

export const cmsTemplateSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
  description: z.string().nullable(),
  salesChannelIds: z.array(uuidSchema),
  languages: z.array(z.string()),
  version: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type CmsTemplateSummary = z.infer<typeof cmsTemplateSummarySchema>;

export const cmsTemplateDetailSchema = cmsTemplateSummarySchema.extend({
  content: cmsContentEnvelopeSchema,
});
export type CmsTemplateDetail = z.infer<typeof cmsTemplateDetailSchema>;

export const createCmsTemplateRequestSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().regex(cmsCodeRe).max(180),
  description: z.string().nullable().optional(),
  salesChannelIds: z.array(uuidSchema).min(1),
  languages: z.array(z.string().min(2)).min(1),
});
export type CreateCmsTemplateRequest = z.infer<typeof createCmsTemplateRequestSchema>;

export const patchCmsTemplateRequestSchema = createCmsTemplateRequestSchema
  .partial()
  .extend({ version: z.number().int().optional() })
  .refine((x) => Object.keys(x).length > 0, { message: 'At least one field required.' });
export type PatchCmsTemplateRequest = z.infer<typeof patchCmsTemplateRequestSchema>;

// ────────────────────────────────────────────────────────────────────
// Hooks
// ────────────────────────────────────────────────────────────────────

export const cmsHookSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
  active: z.boolean(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  salesChannelIds: z.array(uuidSchema),
  attachmentCount: z.number().int().nonnegative(),
  version: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type CmsHookSummary = z.infer<typeof cmsHookSummarySchema>;

export const cmsHookDetailSchema = cmsHookSummarySchema.extend({
  attachments: z.array(
    z.object({
      blockId: uuidSchema,
      blockCode: z.string(),
      position: z.number().int(),
    }),
  ),
});
export type CmsHookDetail = z.infer<typeof cmsHookDetailSchema>;

export const createCmsHookRequestSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().regex(cmsCodeRe).max(180),
  active: z.boolean().default(true),
  description: z.string().nullable().optional(),
  salesChannelIds: z.array(uuidSchema).min(1),
});
export type CreateCmsHookRequest = z.infer<typeof createCmsHookRequestSchema>;

export const patchCmsHookRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    active: z.boolean().optional(),
    description: z.string().nullable().optional(),
    salesChannelIds: z.array(uuidSchema).optional(),
    version: z.number().int().optional(),
  })
  .refine((x) => Object.keys(x).length > 0, { message: 'At least one field required.' });
export type PatchCmsHookRequest = z.infer<typeof patchCmsHookRequestSchema>;

export const cmsHookAttachmentRequestSchema = z.object({
  blockId: uuidSchema,
  position: z.number().int().nonnegative().default(0),
});
export type CmsHookAttachmentRequest = z.infer<typeof cmsHookAttachmentRequestSchema>;

// ────────────────────────────────────────────────────────────────────
// Page Builder config descriptor
// ────────────────────────────────────────────────────────────────────

/**
 * The surfaces a Page Builder block may be offered on. `document` is the
 * document-template editor's (`specs/152-compare-pdf-template/`): blocks
 * declared for it — the facility's general-purpose blocks and a host's own
 * document blocks — never reach the CMS or e-mail palettes.
 */
export const pageBuilderContextSchema = z.enum(['cms', 'email', 'invoice', 'newsletter', 'document']);
export type PageBuilderContext = z.infer<typeof pageBuilderContextSchema>;

export const pageBuilderBreakpointsSchema = z.object({
  tabletMin: z.number().int().positive(),
  desktopMin: z.number().int().positive(),
});
export type PageBuilderBreakpoints = z.infer<typeof pageBuilderBreakpointsSchema>;

export const cmsFieldDescriptorSchema = z.object({
  type: z.enum([
    'text',
    'textarea',
    'number',
    'select',
    'radio',
    'array',
    'object',
    'external',
    'uuid',
    'richtext',
  ]),
  label: z.string().optional(),
  required: z.boolean().optional(),
  options: z
    .array(
      z.object({
        label: z.string(),
        value: z.union([z.string(), z.number()]),
      }),
    )
    .optional(),
  refKind: z.string().optional(),
});
export type CmsFieldDescriptor = z.infer<typeof cmsFieldDescriptorSchema>;

export const cmsColorPaletteEntrySchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(64),
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type CmsColorPaletteEntry = z.infer<typeof cmsColorPaletteEntrySchema>;

export const cmsColorPaletteSchema = z.array(cmsColorPaletteEntrySchema);
export type CmsColorPalette = z.infer<typeof cmsColorPaletteSchema>;

export const putCmsColorPaletteRequestSchema = z.object({
  entries: cmsColorPaletteSchema,
  expectedVersion: z.string().optional(),
});
export type PutCmsColorPaletteRequest = z.infer<typeof putCmsColorPaletteRequestSchema>;

// ────────────────────────────────────────────────────────────────────
// Page Builder block ownership — feature 096
// ────────────────────────────────────────────────────────────────────

/**
 * The grammar of a **persisted** Page Builder block name:
 * `<ownerModuleId>.<LocalName>`, one separator exactly
 * (`specs/096-page-builder-block-ownership/data-model.md` §3).
 *
 * The owner segment is the declaring module's `id` and is matched by the same
 * shape as `moduleIdRe`, minus the underscore prefix `moduleIdRe` reserves for
 * platform-internal modules — none of which owns a block. The local segment is
 * PascalCase, which all 74 pre-existing names already are.
 *
 * **This is the one place the grammar is written.**
 * `@endora-commerce/page-builder-core`'s `block-name.ts` imports it for
 * `parseBlockName` / `ownerOf` / `isNamespaced` / `formatBlockName`, and every
 * other reader goes through those — the discipline `text-normalization.ts`
 * keeps for diacritic folding and slugs, for the same reason: a second copy of
 * a grammar is a second answer waiting to disagree, and this one is written
 * into `jsonb` and never rewritten.
 */
export const blockNameRe = /^[a-z][a-z0-9_]*\.[A-Z][A-Za-z0-9]*$/;

/**
 * The grammar of a declared palette category's key (`data-model.md` §2).
 * snake_case, like a module id and unlike a block's local name — a category is
 * a section of a palette, not a persisted identifier.
 */
export const blockCategoryKeyRe = /^[a-z][a-z0-9_]*$/;

/**
 * A module's declaration of one Page Builder block
 * (`specs/096-page-builder-block-ownership/contracts/block-definition.md` §1).
 *
 * Declared on the module manifest as `blocks`, beside `permissions`, `actions`
 * and `errorCodes`, and read by nothing at runtime until the registry is
 * populated from it.
 *
 * **There is no `ownerModule` field, and its absence is the design.** The owner
 * is the segment before the `.` in `name`, so ownership is stated once rather
 * than twice; the registry keeps computing it for the descriptor it serves.
 * `defineModuleManifest` refuses a `name` whose owner segment is not the
 * declaring module's own `id`.
 *
 * `labelKey` and `descriptionKey` are **relative to the declaring module's own
 * i18n namespace** — `blocks.productGrid.label`, never `catalog.blocks.…` —
 * which is the rule manifest `actions` already follow, and which this layer
 * cannot enforce for the reason it cannot enforce it there either: relativity
 * is a fact about a bundle, and this schema sees a string.
 */
/**
 * Feature 151 — the grammar of a translatable-text path (research R5): prop
 * names joined by `.`, each optionally suffixed `[]` for "every element of this
 * array". `items[].title`, `headers[].label`, `text`.
 */
export const translatablePathRe = /^[a-zA-Z][a-zA-Z0-9_]*(\[\])?(\.[a-zA-Z][a-zA-Z0-9_]*(\[\])?)*$/;

/**
 * Feature 151 — one prop of a block that a shopper reads as prose
 * (`specs/151-page-builder-translate/contracts/block-translatable-declaration.md`).
 * `format: 'tiptap'` marks a TipTap JSON document, `format: 'html'` an HTML
 * string (the Accordion's and the Tabs' item content), whose tags never reach
 * the model; absent means plain text.
 */
export const blockTranslatableTextSchema = z.object({
  path: z.string().regex(translatablePathRe).max(128),
  format: z.enum(['plain', 'tiptap', 'html']).optional(),
});
export type BlockTranslatableText = z.infer<typeof blockTranslatableTextSchema>;

/**
 * A block's translatable texts. `[]` is a declaration ("no prose"); an absent
 * property means "unknown", and the Page Builder translation leaves such a
 * block untouched and reports it.
 */
export const blockTranslatableSchema = z
  .array(blockTranslatableTextSchema)
  .max(32)
  .refine((entries) => new Set(entries.map((e) => e.path)).size === entries.length, {
    message: 'translatable paths must be unique',
  });

export const BlockDefinitionSchema = z.object({
  /** The persisted identifier. Permanent: written into `jsonb` and never rewritten. */
  name: z.string().regex(blockNameRe),
  /** Module-relative i18n key for the palette entry's label. */
  labelKey: z.string().min(1).max(255),
  /** Module-relative i18n key for the palette entry's description. */
  descriptionKey: z.string().min(1).max(255).optional(),
  /** The key of a declared {@link BlockCategorySchema} — not free text. */
  category: z.string().regex(blockCategoryKeyRe),
  /** The surfaces this block is offered on. A block offered nowhere has no reader. */
  contexts: z.array(pageBuilderContextSchema).min(1),
  /** The block's editable fields, in the shape the descriptor already serves. */
  fields: z.record(z.string(), cmsFieldDescriptorSchema),
  /** Props a freshly inserted node carries. Opaque at this boundary. */
  defaultProps: z.record(z.string(), z.unknown()).optional(),
  /** Which of `fields` accept a per-breakpoint override. */
  responsiveFields: z.array(z.string().min(1)).optional(),
  /** Palette thumbnail hint, passed through verbatim as it is today. */
  previewIcon: z.string().min(1).optional(),
  /** Sort order within the category. Absent sorts after everything that declares one. */
  weight: z.number().int().min(0).max(9999).optional(),
  /**
   * Feature 151 — which props are prose the Page Builder may machine-translate.
   * Every first-party block offered in the `cms` context declares it.
   */
  translatable: blockTranslatableSchema.optional(),
});
export type BlockDefinition = z.infer<typeof BlockDefinitionSchema>;

/**
 * A declared palette section (`data-model.md` §2).
 *
 * Categories are declared rather than hard-coded so that a module contributing
 * a block into a category never has to edit a shared `categories` map in a
 * package it does not own — the shape feature 091 removed from the admin. Two
 * modules declaring the same `(key, context)` is therefore expected and is not
 * a collision; the palette merges them.
 *
 * **`contracts/block-definition.md` §1.1 is normative for that merge** — what
 * unions, what resolves, the total order that decides which declaration's
 * `titleKey`, `weight` and `visible` are served as one record, and the two CI
 * signals that hold this repository's modules to agreeing. It is cited rather
 * than summarised here: a second statement of a merge rule is a second answer
 * waiting to disagree. `defineModuleManifest` refuses one *manifest* declaring
 * one `(key, context)` twice (§1 rule 4), which is the only case with a single
 * author and therefore the only one decidable where it is written.
 *
 * A category exists **per context**: `layout` in the CMS palette and `layout`
 * in the e-mail palette are two declarations.
 *
 * `visible` is absent-means-visible rather than a Zod `.default(true)`,
 * deliberately: `ModuleManifest` is the schema's *output* type, so a default
 * would oblige every author to write `visible: true` on every category — which
 * is what `actions`' `keywords` and `weight` already do, and is not a precedent
 * worth extending. It replaces the CMS palette's `_internal` hidden drawer.
 */
export const BlockCategorySchema = z.object({
  key: z.string().regex(blockCategoryKeyRe),
  /** Module-relative i18n key for the section title. */
  titleKey: z.string().min(1).max(255),
  /** The palettes this section appears in. */
  contexts: z.array(pageBuilderContextSchema).min(1),
  /** Palette order. */
  weight: z.number().int().min(0).max(9999).optional(),
  /** Absent means visible. `false` hides the section from the palette. */
  visible: z.boolean().optional(),
});
export type BlockCategory = z.infer<typeof BlockCategorySchema>;

/**
 * `GET /api/v1/admin/cms/page-builder/config`.
 *
 * Feature 096 extends this **additively**: every per-component field it gains
 * is optional and the category list is optional, so a consumer reading only the
 * five fields that were here before keeps working, and Phase 1 changes nothing
 * a client can observe. `name` deliberately does **not** take `blockNameRe` —
 * the registry serves the pre-migration bare names until the renderer maps are
 * re-keyed, and a grammar here would make the vocabulary phase a breaking
 * change.
 */
export const cmsPageBuilderDescriptorSchema = z.object({
  schemaVersion: z.number().int(),
  breakpoints: pageBuilderBreakpointsSchema.optional(),
  colorPalette: cmsColorPaletteSchema.optional(),
  /**
   * Feature 163 (research R-4) — the effective brand tokens for the channel the
   * editor previews (`?salesChannelId=`), else the global set, so the canvas
   * renders as the storefront does. Optional on the wire: a consumer reading
   * only the earlier fields keeps working.
   */
  brandTokens: cmsBrandTokensSchema.optional(),
  components: z.array(
    z.object({
      name: z.string(),
      ownerModule: z.string(),
      fields: z.record(z.string(), cmsFieldDescriptorSchema),
      previewIcon: z.string().optional(),
      contexts: z.array(pageBuilderContextSchema).min(1).optional(),
      // Feature 096 — the six a declaration carries that a registration did
      // not. Optional at this layer and required of a declaration by
      // `BlockDefinitionSchema`; what makes them present in a response is a
      // module having declared the block.
      labelKey: z.string().min(1).max(255).optional(),
      descriptionKey: z.string().min(1).max(255).optional(),
      category: z.string().regex(blockCategoryKeyRe).optional(),
      defaultProps: z.record(z.string(), z.unknown()).optional(),
      responsiveFields: z.array(z.string().min(1)).optional(),
      weight: z.number().int().min(0).max(9999).optional(),
      /** Feature 151 — the block's declaration, when it made one. */
      translatable: blockTranslatableSchema.optional(),
    }),
  ),
  /**
   * The declared palette sections, **merged across every present module** —
   * one entry per `(key, context)` the present modules declare, not one per
   * declaration (`contracts/block-definition.md` §1.1 and §4.1).
   *
   * `ownerModule` is the one field a served section carries that a declaration
   * does not: the module whose declaration won the fold, derived and never
   * declared, exactly as a block's `ownerModule` is derived from its `name`. It
   * is what lets an operator — and a support engineer reading a bug report —
   * see why a section is called what it is called without composing the
   * platform in their head. Optional on the wire, so a consumer reading only
   * the declared fields keeps working.
   */
  categories: z
    .array(BlockCategorySchema.extend({ ownerModule: z.string().optional() }))
    .optional(),
});
export type CmsPageBuilderDescriptor = z.infer<typeof cmsPageBuilderDescriptorSchema>;

// ────────────────────────────────────────────────────────────────────
// Storefront resolved shapes
// ────────────────────────────────────────────────────────────────────

export const cmsAssetEmbedResolutionSchema = z.object({
  url: z.string(),
  mimeType: z.string(),
  filename: z.string(),
  label: z.string().nullable(),
  visibility: z.enum(['public', 'private']),
});
export type CmsAssetEmbedResolution = z.infer<typeof cmsAssetEmbedResolutionSchema>;

export const cmsResolvedBlockSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  language: z.string(),
  content: z.object({ data: z.unknown() }),
});
export type CmsResolvedBlock = z.infer<typeof cmsResolvedBlockSchema>;

export const cmsResolvedTemplateSchema = cmsResolvedBlockSchema;
export type CmsResolvedTemplate = CmsResolvedBlock;

export const cmsResolvedPageSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  /**
   * The page's public path in the request's channel, without a leading slash
   * (R19D, T282): its own slug, or — when it includes its parent's path — its
   * ancestors' path and its slug. The page is canonical at `/<path>`; a
   * storefront that resolved it under another address (the flat slug of a
   * nested page) redirects there permanently.
   *
   * Optional only for an answer cached before the field existed, which was
   * served at its `slug`; every answer composed since carries it.
   */
  path: z.string().optional(),
  /**
   * R24: the page's canonical URL in the served language — `cmsPageUrl` of
   * `path`, so `?lang=` rides along for a language other than the channel's
   * default. Built by the backend; the storefront redirects to it when it was
   * asked under another address and composes no CMS URL of its own.
   * Optional only for an answer cached before the field existed.
   */
  url: z.string().optional(),
  /**
   * R24: one URL per language the page can be served in (`languages`), each
   * at that language's own path — the `hreflang` alternates. Optional on the
   * same terms as `url`.
   */
  alternates: z.array(z.object({ language: z.string(), url: z.string() })).optional(),
  /** The page name in the served language (R24: its override, else the page's). */
  name: z.string(),
  language: z.string(),
  meta: z.object({
    title: z.string().nullable(),
    description: z.string().nullable(),
    keywords: z.string().nullable(),
  }),
  content: z.object({ data: z.unknown() }),
  embeds: z.object({
    blocks: z.record(z.string(), cmsResolvedBlockSchema),
    templates: z.record(z.string(), cmsResolvedTemplateSchema),
  }),
  assets: z.record(uuidSchema, cmsAssetEmbedResolutionSchema),
  /**
   * The breadcrumb trail for the request's channel (feature 163, data-model §5):
   * root-first, without Home and without the page itself. An ancestor the
   * channel does not serve, published and active, carries `slug: null` and
   * renders as text (FR-030a).
   *
   * `path` (R19D, T282) is the ancestor's public path in this channel — what
   * its link is built from, `/<path>`. It equals `slug` for a page that does
   * not include its parent's path, and is `null` exactly when `slug` is.
   * Optional on the same terms as the page's own `path`.
   */
  breadcrumbs: z.object({
    visible: z.boolean(),
    scheme: cmsBreadcrumbsSchemeSchema,
    /**
     * R21H (T355): the trail over the first section, not in a band above it.
     * Optional: an answer cached before the field existed is read as `false`.
     */
    overlay: z.boolean().optional(),
    trail: z.array(
      z.object({ name: z.string(), slug: z.string().nullable(), path: z.string().nullable().optional() }),
    ),
  }),
  /**
   * The sharing image (feature 163, FR-033): the page's own
   * `shareImageAssetId`, else `cms.default_share_image_asset_id` read for the
   * request's channel, else `null`. A public URL, ready for `og:image`.
   */
  share: z.object({ imageUrl: z.string().nullable() }),
  /**
   * The languages this page can be served in (feature 163, FR-034), for
   * `og:locale:alternate`. Includes the served `language`.
   */
  languages: z.array(z.string()),
});
export type CmsResolvedPage = z.infer<typeof cmsResolvedPageSchema>;

export const cmsResolvedHookSchema = z.object({
  hookCode: z.string(),
  blocks: z.array(cmsResolvedBlockSchema),
});
export type CmsResolvedHook = z.infer<typeof cmsResolvedHookSchema>;

/**
 * One published CMS page, as a crawler needs to be told about it
 * (`specs/105-cms-root-page-urls/` FR-021; `contracts/cms-page-url.md` §4.1).
 *
 * `slug` is the **per-channel** slug — `cms_page_sales_channels.slug`, which is
 * what §1 says the page's address is built from, and not `cms_pages.slug`,
 * which carries one value for every channel the page is published to. The two
 * agree for a single-channel page and are free to disagree for any other, which
 * is why the join and not the column is the source.
 *
 * `updatedAt` is the page row's, and it is here because a sitemap entry with no
 * `lastModified` tells a crawler nothing it did not already know. Nothing else
 * of the page travels: this shape exists to enumerate addresses, and a rendered
 * page-builder tree per row would put the whole CMS through memory on every
 * sitemap build — the reasoning `CmsPageRecord` already states for dropping
 * `body` and `content`.
 */
export const cmsPageIndexEntrySchema = z.object({
  slug: z.string(),
  /**
   * The page's public path in this channel (R19D, T282) — what the URL is
   * built from. Every answer since R19D carries it; a reader of an older
   * backend falls back to `slug`.
   */
  path: z.string().optional(),
  /** R24: the URL in the channel's default language — `cmsPageUrl` of `path`. */
  url: z.string().optional(),
  /** R24: the URL of every language the page is served in, the default one included. */
  alternates: z.array(z.object({ language: z.string(), url: z.string() })).optional(),
  updatedAt: isoDateTimeSchema,
});
export type CmsPageIndexEntry = z.infer<typeof cmsPageIndexEntrySchema>;

/** The published pages of the requested sales channel (FR-021). */
export const cmsPageIndexResponseSchema = z.object({
  pages: z.array(cmsPageIndexEntrySchema),
});
export type CmsPageIndexResponse = z.infer<typeof cmsPageIndexResponseSchema>;

/**
 * The deployment's reserved first path segments, as the page editor reads them
 * (`specs/105-cms-root-page-urls/` FR-033; `contracts/cms-page-url.md` §5.3).
 *
 * Normalised: lowercase, one path segment each, no duplicates — whatever an
 * operator typed into the Setting. The editor compares a slug's first segment
 * against this list, and the backend refuses a save against the same value, so
 * the warning and the refusal cannot disagree.
 */
export const cmsReservedSegmentsResponseSchema = z.object({
  segments: z.array(z.string()),
});
export type CmsReservedSegmentsResponse = z.infer<typeof cmsReservedSegmentsResponseSchema>;

/**
 * The first path segment of a CMS page slug — the only segment that can collide
 * with a storefront route (`contracts/cms-page-url.md` §5.1).
 *
 * `cmsSlugRe` permits `/`, so `pomoc/dostawa` is one page at `/pomoc/dostawa`
 * rather than a page under a section, and its first segment is `pomoc`. The
 * storefront's route table decides the *first* segment of a URL and a catch-all
 * takes everything after it, so that is what the refusal compares.
 *
 * **It lives here because two programs ask the question and must agree**: the
 * backend, refusing a save, and the page editor, warning while the operator
 * types. A second copy in the admin layer is a second answer waiting to
 * disagree — the discipline `blockNameRe` and `slugify` already keep.
 */
export function firstSlugSegment(slug: string): string {
  return slug.split('/').filter((segment) => segment.length > 0)[0]?.toLowerCase() ?? '';
}

/**
 * How many slugs a public path may join — the page tree's own depth limit
 * (`CMS_PAGE_TREE_MAX_DEPTH`, research R-18), so a well-formed tree always has
 * its whole path and a stored chain that is too deep still terminates.
 */
export const CMS_PAGE_PATH_MAX_LEVELS = 8;

/** One page as the public-path rule reads it, in one sales channel. */
export interface CmsPagePathNode {
  id: string;
  /** The slug the channel serves the page under. */
  slug: string;
  parentPageId: string | null;
  parentPathInUrl: boolean;
}

function trimSlashes(slug: string): string {
  return slug.split('/').filter((segment) => segment.length > 0).join('/');
}

/**
 * The public path of every page in one sales channel, without a leading slash
 * (`specs/163-page-builder-marketing-pages/` R19D, T280).
 *
 * A page that does not include its parent's path is served at its own slug —
 * every page stored before the option existed, unchanged. A page that does is
 * served at its parent's public path, a `/`, and its own slug; the parent's
 * path is computed by the same rule, so the prefix runs up the tree until an
 * ancestor that did not opt in. It falls back to the page's own slug when the
 * parent is not among `nodes` (the channel does not serve it), when the chain
 * loops, or when it would join more than `CMS_PAGE_PATH_MAX_LEVELS` slugs —
 * the write side refuses the last two, so the fallback answers only stored
 * data that predates the refusal.
 *
 * **It lives here because three programs ask the question and must agree**:
 * the backend resolving a path and refusing a duplicate, the page editor
 * showing the address, and the storefront linking to it.
 */
export function cmsPagePublicPaths(nodes: Iterable<CmsPagePathNode>): Map<string, string> {
  const byId = new Map<string, CmsPagePathNode>();
  for (const node of nodes) byId.set(node.id, node);
  const memo = new Map<string, { path: string; levels: number }>();
  const flat = (node: CmsPagePathNode) => ({ path: trimSlashes(node.slug), levels: 1 });
  // The pages being composed, child below parent, to recognise a stored loop.
  const stack: string[] = [];

  const visit = (node: CmsPagePathNode): { path: string; levels: number } => {
    const known = memo.get(node.id);
    if (known) return known;
    const parent = node.parentPathInUrl && node.parentPageId ? byId.get(node.parentPageId) : undefined;
    if (!parent) {
      memo.set(node.id, flat(node));
      return flat(node);
    }
    const loopStart = stack.indexOf(parent.id);
    if (loopStart >= 0) {
      // Every page on the loop is served at its own slug.
      for (const id of stack.slice(loopStart)) memo.set(id, flat(byId.get(id)!));
      memo.set(node.id, flat(node));
      return flat(node);
    }
    stack.push(node.id);
    const above = visit(parent);
    stack.pop();
    const marked = memo.get(node.id);
    if (marked) return marked;
    const own = trimSlashes(node.slug);
    const result =
      above.levels + 1 > CMS_PAGE_PATH_MAX_LEVELS
        ? flat(node)
        : { path: above.path.length > 0 ? `${above.path}/${own}` : own, levels: above.levels + 1 };
    memo.set(node.id, result);
    return result;
  };

  const paths = new Map<string, string>();
  for (const node of byId.values()) paths.set(node.id, visit(node).path);
  return paths;
}

/** What `cmsLocalizedPage` reads of a page: its own fields and its overrides. */
export interface CmsLocalizablePage {
  name: string;
  slug: string;
  description?: string | null;
  languages: readonly string[];
  /** Absent on a page read before R24. */
  translations?: CmsPageTranslations | null;
}

/**
 * A page's name, slug and description in one language
 * (`specs/163-page-builder-marketing-pages/` R24, issue #521): each field the
 * language overrides, else the page's own. A blank override inherits, and so
 * does every override of a language the page does not declare — removing a
 * language from a page keeps its overrides stored but stops them counting, so
 * adding it back restores them.
 *
 * **It lives here because three programs ask the question and must agree**: the
 * backend resolving and refusing a path, the page editor previewing the
 * address, and the storefront through what the backend answers.
 */
export function cmsLocalizedPage(
  page: CmsLocalizablePage,
  language: string,
): { name: string; slug: string; description: string | null } {
  const own = page.languages.includes(language) ? page.translations?.[language] : undefined;
  const pick = (value: string | undefined): string | undefined =>
    value !== undefined && value.trim().length > 0 ? value : undefined;
  return {
    name: pick(own?.name) ?? page.name,
    slug: pick(own?.slug) ?? page.slug,
    description: pick(own?.description) ?? page.description ?? null,
  };
}

export interface CmsPageUrlInput {
  /** The page's public path in the language, with or without slashes. */
  path: string;
  /** The language the URL is for — already resolved against the page and channel. */
  languageCode: string;
  /**
   * The channel's URL-language facts (feature 167, `specs/167-storefront-locale-path/`):
   * its languages, default and *prefix the default language* setting.
   */
  channel: ChannelUrlFacts;
}

/**
 * The storefront URL of a CMS page: `/<path>` in the language, under that language's
 * path prefix (`/en/about`, or `/o-nas` for the default language of a channel that
 * does not prefix it) — the rule `productPath` states for a product. A page's slug
 * may differ in every language (R24), so the language travels with the URL as its
 * prefix; 163 R24's interim `?lang=` is never appended (feature 167, OR-7).
 *
 * The backend calls it for every CMS URL it answers — the resolved page's canonical
 * and alternates, the channel index.
 */
export function cmsPageUrl(input: CmsPageUrlInput): string {
  const trimmed = trimSlashes(input.path);
  return storefrontPagePath({
    path: trimmed === '' ? '/' : `/${trimmed}`,
    languageCode: input.languageCode,
    channel: input.channel,
  });
}

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The in-process surface `cms` publishes to the two modules that read it
// (feature 075, Phase P) — `megamenu` and `seo`.
// ---------------------------------------------------------------------------

/**
 * One thing pointing at a CMS object, as a delete guard reports it.
 *
 * `kind` is deliberately open on the string side: the four `cms_*` tags are
 * this module's own, and a scanner contributed by another module names its own
 * kind. Closing the union would mean `cms` had to know every module that might
 * ever embed a block.
 */
export interface CmsReference {
  kind: 'cms_page' | 'cms_block' | 'cms_template' | 'cms_hook' | 'megamenu' | string;
  entityId: string;
  label: string;
}

/**
 * A scanner contributed by another module so its references block a CMS page,
 * block or template from being deleted.
 *
 * Every method is optional — a scanner fills in only the edges it cares about.
 * `ownerModuleId` is not: a contribution seam records its contributor, so the
 * registry can state a policy for an absent owner instead of having no way to
 * express one (D-39).
 *
 * The block and template scanners receive both an id and a code, because a
 * contributor may have stored either.
 */
export interface CmsExternalReferenceScanner {
  ownerModuleId: string;
  findPageReferences?: (pageId: string) => Promise<CmsReference[]>;
  findBlockReferences?: (blockId: string, blockCode: string) => Promise<CmsReference[]>;
  findTemplateReferences?: (templateId: string, templateCode: string) => Promise<CmsReference[]>;
}

/**
 * Container name: `cmsReferenceRegistry`. Owner: `cms`.
 *
 * A **contribution seam**, and the reference-integrity twin of
 * `assetReferenceRegistry`: `megamenu` is the one contributor today. Its
 * absent-owner policy should be read the same way — these scanners exist to
 * refuse a delete, not to render a surface, so an absent contributor's edges
 * still matter. Publishing the shape must not change the classification.
 */
export interface CmsReferenceRegistryPort {
  register(scanner: CmsExternalReferenceScanner): void;
  /** The contributing module of every registered scanner, in registration order. */
  owners(): readonly string[];
}

/**
 * A CMS page as `seo` reads it — never the ORM entity (FR-011).
 *
 * **`path` and `title` are the entity's two `@deprecated` columns**, and the
 * first version of this record carried only those. `slug`, `name` and `active`
 * join them in Phase C, because they are what `seo` measurably reads: the
 * sitemap stamps `${baseUrl}/${slug}` and excludes `active === false`, and the
 * meta-tag rule falls back to `name` when a page has no localized `metaTitle`.
 * Publishing the record without them would have made the cut change which URL
 * a crawler is given and put deactivated pages back into the sitemap — a
 * product change wearing a refactor.
 *
 * The deprecated pair stays: `cms` owns the decision to retire them, and
 * removing a published field to fix a consumer is the wrong direction.
 */
export interface CmsPageRecord {
  id: string;
  /** @deprecated Use `slug`. The entity says so; the record repeats it. */
  path: string;
  /** The storefront slug — what a URL is built from. */
  slug: string;
  status: 'draft' | 'published' | 'archived';
  /** Admin-facing page name, and the meta-title fallback. */
  name: string;
  /** An operator can deactivate a published page; a deactivated one has no URL. */
  active: boolean;
  /** @deprecated Use `name` + `metaTitle`. The entity says so; the record repeats it. */
  title: Record<string, string>;
  metaTitle: Record<string, string> | null;
  metaDescription: Record<string, string> | null;
  metaKeywords: Record<string, string> | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** The breadcrumb parent (feature 163). Never part of the page's URL. */
  parentPageId: string | null;
  /**
   * The languages the page has content in (feature 167): the sitemap lists the page
   * under the prefix of each of these the channel serves. Absent — a record from a
   * reader that predates it — every channel language.
   */
  languages?: readonly string[];
  /**
   * 163 R24: the page's per-language name, slug and description overrides — the
   * sitemap lists each language at its own slug (`cmsLocalizedPage`). Absent: none.
   */
  translations?: CmsPageTranslations;
}

/**
 * Container name: `cmsPageReadPort`. Owner: `cms`.
 *
 * `seo` reads pages twice: to resolve one page's meta tags, and to enumerate
 * the published ones for the sitemap. The `body` and `content` columns are
 * absent from the record on purpose — a sitemap and a meta-tag resolver have
 * no use for a page's rendered tree, and shipping it would make every sitemap
 * build carry the whole CMS.
 */
export interface CmsPageReadPort {
  findById(id: string): Promise<CmsPageRecord | null>;
  findByPath(path: string): Promise<CmsPageRecord | null>;
  /**
   * These ids, in the order given. The sitemap's read: it already holds the
   * channel's member ids, so `listPublished` would fetch every page on the
   * platform to keep one channel's few.
   */
  findByIds(ids: readonly string[]): Promise<CmsPageRecord[]>;
  /** Published pages only, ordered by path — the platform-wide enumeration. */
  listPublished(): Promise<CmsPageRecord[]>;
  /**
   * A storefront link to each of these pages that the channel serves, in one
   * language: its localised name and its path in that language's page tree
   * (`specs/168-megamenu-navigation-bar/` plan R-8). The megamenu's page links
   * read this, so a link follows the page's slug per language (feature 163 R24)
   * and its parent's path (R19D). Pages the channel does not serve are absent.
   */
  findStorefrontLinks(ids: readonly string[], scope: CmsPageStorefrontLinkScope): Promise<CmsPageStorefrontLink[]>;
  /**
   * Feature 171 — the lower-case first slug segment of every page the channel serves,
   * in every language (its own slug and each translation's), so another module can
   * refuse an address a page already holds.
   */
  firstSegmentsInChannel(salesChannelId: string): Promise<string[]>;
}

/**
 * Feature 171 (`specs/171-blog-i18n-authors/` research R5) — a module that serves
 * first path segments of its own on the storefront (the blog's prefix) claims them
 * here, and CMS refuses a page slug that starts with a claimed segment, as it does a
 * language prefix (feature 167). CMS never names the contributor.
 */
export interface CmsReservedSegmentContributor {
  /** The contributing module — a switched-off contributor claims nothing. */
  readonly contributorModuleId: string;
  /** The lower-case first segments the module serves in this channel. */
  segmentsFor(salesChannelId: string): Promise<string[]>;
}

/**
 * Container name: `cmsReservedSegmentRegistry`. Owner: `cms`. An ungated contribution
 * registry: a module pushes a contributor once, from a boot hook.
 */
export interface CmsReservedSegmentRegistryPort {
  register(contributor: CmsReservedSegmentContributor): void;
}

/** Where a {@link CmsPageReadPort.findStorefrontLinks} link is served. */
export interface CmsPageStorefrontLinkScope {
  salesChannelId: string;
  language: string;
}

/** A page as a link: what the navigation shows and where it leads. */
export interface CmsPageStorefrontLink {
  id: string;
  name: string;
  /**
   * The page's logical path in the language, with no language prefix: the
   * storefront puts the current language's prefix on it, as on every menu link
   * (feature 167), so a menu cached per channel and language holds no URL facts.
   */
  url: string;
}

/**
 * A predefined block a module asks `cms` to keep in place — feature 075 / D-87.
 *
 * Two modules ship one: `newsletter` owns the registration-form consent label
 * and `google_analytics` owns the cookie-banner message. In both the *text* is
 * the asking module's business and the *storage* is this one's, which is why
 * the descriptor carries content and nothing else — no channel list, no block
 * id, no version. The seam is "keep this block in place", not "write to my
 * tables".
 */
export interface CmsSeededBlock {
  /**
   * The block's stable code, and the only identity this seam has. A second call
   * under the same code inserts nothing and updates nothing, so an operator who
   * has edited the seeded text keeps that edit across every restart.
   */
  readonly code: string;
  /** The admin-facing block name. Used only where the block is first created. */
  readonly name: string;
  /** The language codes the block ships content for, e.g. `['en-US', 'pl-PL']`. */
  readonly languages: readonly string[];
  /** The per-language Puck trees, in the envelope the CMS stores. */
  readonly content: CmsContentEnvelope;
}

/**
 * Container name: `cmsBlockSeedPort`. Owner: `cms`.
 *
 * The idempotent seeding seam for a predefined block, and deliberately nothing
 * wider: a module that ships one needs it to exist and to resolve on every
 * sales channel, and needs no other write into the CMS. `newsletter` and
 * `google_analytics` reached `cms_blocks` and `cms_block_sales_channels` in raw
 * SQL until feature 075 — four ledgered reaches that named no import specifier,
 * so the boundary they crossed compiled and returned rows.
 *
 * **Called once per boot, from the asking module's route registration.** There
 * rather than from a migration because a block resolves per sales channel and
 * the system-default channel is created at boot rather than by schema; and
 * re-run every boot because a channel created later has to be bound too.
 *
 * **When `cms` is switched off**, the gate on this registration answers 503
 * `MODULE_DISABLED` instead of handing back a live service. A caller reaching
 * it before the first request — which is where a seed runs — therefore decides
 * presence first with `effectiveState.isPresent('cms')` and skips the seed: a
 * gate's "no" at route registration stops the next start rather than one
 * request. Skipping costs nothing that is not recovered. Deactivation drops no
 * rows, so an already-seeded block outlives the flip, and the first boot after
 * `cms` comes back binds it to whatever channels appeared meanwhile.
 */
export interface CmsBlockSeedPort {
  /**
   * Insert `block` where no block carries its code, then bind it to every sales
   * channel it is not already bound to. Both halves are idempotent, so the call
   * is: a re-run inserts nothing and binds nothing.
   */
  ensureSeededBlock(block: CmsSeededBlock): Promise<void>;
}

/**
 * A CMS block as a consumer outside `cms` reads it — never the ORM entity
 * (FR-011).
 *
 * Three fields, because three is what the demand is. `content` is deliberately
 * absent: the whole point of {@link CmsBlockReadPort.findLocalizedById} is that a
 * consumer never holds the per-language envelope, so shipping it here would make
 * the narrow read pointless and hand every caller a shape whose key layout is
 * this module's storage decision.
 */
export interface CmsBlockRecord {
  id: string;
  /** The block's stable, operator-visible code. */
  code: string;
  /**
   * An operator can deactivate a block. It is on the record rather than applied
   * as a hidden filter because the two consumers disagree about it on purpose:
   * an admin-side existence check accepts a deactivated block (an operator may
   * be editing it), and a storefront render does not.
   */
  active: boolean;
}

/**
 * One block's authored content in **one** language.
 *
 * `data` is the Puck tree, opaque here exactly as it is in
 * {@link CmsContentEnvelope} — this boundary carries content, it does not
 * interpret it. What does not cross is the envelope itself: which key a language
 * hangs off, whether a legacy `schema_version` rides along, and what an absent
 * language means are `cms`' storage decisions, and a consumer that had to know
 * them would be reading this module's columns with extra steps.
 */
export interface CmsLocalizedBlockRecord {
  id: string;
  code: string;
  /** The language actually resolved — the one asked for, never a fallback. */
  language: string;
  data: unknown;
}

/**
 * Container name: `cmsBlockReadPort`. Owner: `cms`.
 *
 * `megamenu` reads blocks twice, and the two reads are different questions
 * rather than one question at two widths (`specs/110-instance-repository/`
 * T118c). Both were raw `select … from cms_blocks` in a composition root until
 * this port existed, which is why the interface is shaped by the demand and not
 * by the table:
 *
 * - {@link findById} answers *does this block exist?* for the admin-side target
 *   validator, which refuses a menu item pointing at a block that is not there.
 *   It does not filter on `active`, and the record carries the flag so the
 *   caller can.
 * - {@link findLocalizedById} answers *what does this block render as, here?*
 *   for the storefront resolver, which inlines the tree into the menu payload.
 *
 * Two methods rather than one wide read: a validator that took the localized
 * record would pull a content tree per menu item to test a row for existence,
 * and a storefront that took the plain record would have to open the envelope
 * itself. Nothing else `cms` knows about blocks is published — the module's own
 * admin surface is much larger and stays where it is.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. That is the honest answer for both consumers: an operator who
 * has switched the CMS off has switched off the thing that owns the block a menu
 * item names, and a menu that quietly dropped the embed would be reporting the
 * content as gone rather than as unavailable.
 */
export interface CmsBlockReadPort {
  findById(id: string): Promise<CmsBlockRecord | null>;
  /**
   * The block's content in `language`, or `null` when there is no active block
   * with that id **or** it carries nothing for that language. The two are one
   * answer on purpose: a caller that inlines a block has the same thing to do in
   * either case, and distinguishing them would put "what does an absent language
   * mean" — which is the envelope's shape — back on the caller.
   */
  findLocalizedById(id: string, language: string): Promise<CmsLocalizedBlockRecord | null>;
}

// ────────────────────────────────────────────────────────────────────
// Page Builder translation (feature 151)
// `specs/151-page-builder-translate/contracts/page-builder-translation-api.md`
// ────────────────────────────────────────────────────────────────────

/** Bounds of the `cms.page_builder.translation.max_source_characters` setting. */
export const CMS_TRANSLATION_MAX_SOURCE_CHARACTERS_BOUNDS = { min: 1_000, max: 200_000 } as const;
export const CMS_TRANSLATION_DEFAULT_MAX_SOURCE_CHARACTERS = 40_000;

export const cmsPageBuilderTranslationStatusSchema = z.enum([
  'ready',
  'disabled',
  'not_configured',
  'unavailable',
]);
export type CmsPageBuilderTranslationStatus = z.infer<typeof cmsPageBuilderTranslationStatusSchema>;

/**
 * `GET /api/v1/admin/cms/page-builder/translation`. Never carries the API key,
 * the credential code or the Base URL.
 */
export const cmsPageBuilderTranslationCapabilitySchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    provider: LlmProviderSchema,
    model: z.string().min(1),
    maxCharacters: z.number().int().positive(),
  }),
  z.object({
    status: z.enum(['disabled', 'not_configured', 'unavailable']),
    maxCharacters: z.number().int().positive(),
  }),
]);
export type CmsPageBuilderTranslationCapability = z.infer<
  typeof cmsPageBuilderTranslationCapabilitySchema
>;

const translationLanguageCodeSchema = z.string().min(2).max(35);

/** A Puck document at the translation boundary — structure checked, content passed through. */
export const cmsPuckDataSchema = z
  .object({
    root: z.object({ props: z.record(z.string(), z.unknown()).optional() }).passthrough(),
    content: z.array(z.record(z.string(), z.unknown())),
    zones: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).optional(),
  })
  .passthrough();
export type CmsPuckData = z.infer<typeof cmsPuckDataSchema>;

/** What part of the canvas to translate (research R22); absent = the whole canvas. */
export const cmsPageBuilderTranslationScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('component'), componentId: z.string().min(1).max(256) }),
  z.object({
    kind: z.literal('text'),
    componentId: z.string().min(1).max(256).nullable(),
    selectedText: z
      .string()
      .trim()
      .min(1)
      .max(CMS_TRANSLATION_MAX_SOURCE_CHARACTERS_BOUNDS.max),
  }),
]);
export type CmsPageBuilderTranslationScope = z.infer<typeof cmsPageBuilderTranslationScopeSchema>;

/** `POST /api/v1/admin/cms/page-builder/translate` body. */
export const cmsPageBuilderTranslateRequestSchema = z
  .object({
    targetLanguage: translationLanguageCodeSchema,
    /** `null` — the model detects the source language. */
    sourceLanguage: translationLanguageCodeSchema.nullable(),
    context: z.literal('cms'),
    data: cmsPuckDataSchema,
    /** Audit context only — what the canvas belongs to. */
    resource: z
      .object({
        type: z.string().regex(/^[a-z][a-z0-9_]*$/).max(64),
        id: z.string().uuid().nullable(),
      })
      .optional(),
    scope: cmsPageBuilderTranslationScopeSchema.optional(),
  })
  .refine((r) => r.sourceLanguage !== r.targetLanguage, {
    message: 'sourceLanguage must differ from targetLanguage',
    path: ['sourceLanguage'],
  });
export type CmsPageBuilderTranslateRequest = z.infer<typeof cmsPageBuilderTranslateRequestSchema>;

export const cmsPageBuilderTranslateResponseSchema = z.object({
  data: cmsPuckDataSchema,
  report: z.object({
    translatedSegments: z.number().int().nonnegative(),
    untranslatedSegments: z.number().int().nonnegative(),
    untranslatableBlocks: z.array(
      z.object({ name: z.string(), count: z.number().int().positive() }),
    ),
    characters: z.number().int().nonnegative(),
    provider: LlmProviderSchema,
    model: z.string(),
    sourceLanguage: translationLanguageCodeSchema.nullable(),
    scope: z.object({
      kind: z.enum(['canvas', 'component', 'text']),
      /** `true` when a text selection was widened to whole paragraph(s). */
      widened: z.boolean(),
    }),
  }),
});
export type CmsPageBuilderTranslateResponse = z.infer<typeof cmsPageBuilderTranslateResponseSchema>;
