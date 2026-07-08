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
