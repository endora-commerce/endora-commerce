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
    }),
  ),
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
