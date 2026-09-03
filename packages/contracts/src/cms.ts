// CMS — feature 014 contract surface.
// Pages, Blocks, Templates, Hooks, Page Builder content envelope, and
// the storefront-side resolved-content shapes. Per Principle V, these
// schemas are the source of truth for every HTTP boundary in the new
// `cms` module. The Page Builder tree itself is opaque at this layer
// (Puck's wire format is treated as `unknown`); per-component validation
// happens server-side in the CMS module.

import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

// ────────────────────────────────────────────────────────────────────
// Domain primitives
// ────────────────────────────────────────────────────────────────────

const cmsCodeRe = /^[a-z0-9][a-z0-9._-]{0,178}[a-z0-9]$/;
const cmsSlugRe = /^[a-z0-9](?:[a-z0-9/_-]{0,178}[a-z0-9])?$/;

export const cmsPageStatusSchema = z.enum(['draft', 'published', 'archived']);
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
});
export type CmsPageSummary = z.infer<typeof cmsPageSummarySchema>;

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

export const pageBuilderContextSchema = z.enum(['cms', 'email', 'invoice', 'newsletter']);
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
    }),
  ),
  /** The declared palette sections, merged across every present module. */
  categories: z.array(BlockCategorySchema).optional(),
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
});
export type CmsResolvedPage = z.infer<typeof cmsResolvedPageSchema>;

export const cmsResolvedHookSchema = z.object({
  hookCode: z.string(),
  blocks: z.array(cmsResolvedBlockSchema),
});
export type CmsResolvedHook = z.infer<typeof cmsResolvedHookSchema>;

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
