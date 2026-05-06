// Megamenu — feature 015 contract surface.
// Pages, Bindings, Items (with a discriminated-union target shape), the
// resolved storefront payload. Per Principle V these schemas are the
// source of truth for every HTTP boundary in the new `megamenu` module.

import { z } from 'zod';
import { isoDateTimeSchema, multilingualStringSchema, uuidSchema } from './common.js';

// ────────────────────────────────────────────────────────────────────
// Domain primitives
// ────────────────────────────────────────────────────────────────────

export const megamenuItemKindSchema = z.enum([
  'category-link',
  'cms-page-link',
  'external-link',
  'button',
  'asset',
  'cms-block-embed',
]);
export type MegamenuItemKind = z.infer<typeof megamenuItemKindSchema>;

export const megamenuButtonVariantSchema = z.enum(['primary', 'secondary', 'ghost']);
export type MegamenuButtonVariant = z.infer<typeof megamenuButtonVariantSchema>;

export const megamenuIconPositionSchema = z.enum(['left', 'right']);
export type MegamenuIconPosition = z.infer<typeof megamenuIconPositionSchema>;

export const megamenuEmbedSideSchema = z.enum(['left', 'right']);
export type MegamenuEmbedSide = z.infer<typeof megamenuEmbedSideSchema>;

export const megamenuAssetKindSchema = z.enum(['image', 'video']);
export type MegamenuAssetKind = z.infer<typeof megamenuAssetKindSchema>;

const externalUrlRegex = /^(?:https?:\/\/|tel:|mailto:)/i;
const externalUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => externalUrlRegex.test(value), {
    message: 'External link must use http://, https://, tel:, or mailto: scheme.',
  });

const buttonUrlSchema = z.string().min(1).max(2048);

const optionalIconShape = {
  iconAssetId: uuidSchema.nullable().optional(),
  iconPosition: megamenuIconPositionSchema.nullable().optional(),
};

// ────────────────────────────────────────────────────────────────────
// Item-level discriminated union — the wire shape carries `kind` at
// the item level and the kind-specific fields collapsed into `target`.
// ────────────────────────────────────────────────────────────────────

export const megamenuItemBaseFields = {
  id: uuidSchema.optional(),
  parentId: uuidSchema.nullable().optional(),
  position: z.number().int().nonnegative(),
  labels: multilingualStringSchema,
  descriptions: multilingualStringSchema.nullable().optional(),
} as const;

export const categoryLinkTargetSchema = z.object({
  categoryId: uuidSchema,
  ...optionalIconShape,
});
export type CategoryLinkTarget = z.infer<typeof categoryLinkTargetSchema>;

export const cmsPageLinkTargetSchema = z.object({
  pageId: uuidSchema,
  ...optionalIconShape,
});
export type CmsPageLinkTarget = z.infer<typeof cmsPageLinkTargetSchema>;

export const externalLinkTargetSchema = z.object({
  url: externalUrlSchema,
  ...optionalIconShape,
});
export type ExternalLinkTarget = z.infer<typeof externalLinkTargetSchema>;

export const buttonTargetSchema = z.object({
  url: buttonUrlSchema,
  variant: megamenuButtonVariantSchema,
});
export type ButtonTarget = z.infer<typeof buttonTargetSchema>;

export const assetTargetSchema = z.union([
  z.object({
    assetId: uuidSchema,
    kind: megamenuAssetKindSchema,
  }),
  z.object({
    /** Free URL — replaced with assetId at save time via Assets Library import. */
    url: z.string().url(),
    kind: megamenuAssetKindSchema,
  }),
]);
export type AssetTarget = z.infer<typeof assetTargetSchema>;

export const cmsBlockEmbedTargetSchema = z.object({
  blockId: uuidSchema,
  embedSide: megamenuEmbedSideSchema,
});
export type CmsBlockEmbedTarget = z.infer<typeof cmsBlockEmbedTargetSchema>;

export const megamenuItemSchema = z.discriminatedUnion('kind', [
  z.object({ ...megamenuItemBaseFields, kind: z.literal('category-link'), target: categoryLinkTargetSchema }),
  z.object({ ...megamenuItemBaseFields, kind: z.literal('cms-page-link'), target: cmsPageLinkTargetSchema }),
  z.object({ ...megamenuItemBaseFields, kind: z.literal('external-link'), target: externalLinkTargetSchema }),
  z.object({ ...megamenuItemBaseFields, kind: z.literal('button'), target: buttonTargetSchema }),
  z.object({ ...megamenuItemBaseFields, kind: z.literal('asset'), target: assetTargetSchema }),
  z.object({ ...megamenuItemBaseFields, kind: z.literal('cms-block-embed'), target: cmsBlockEmbedTargetSchema }),
]);
export type MegamenuItem = z.infer<typeof megamenuItemSchema>;

// ────────────────────────────────────────────────────────────────────
// Megamenu (configuration row)
// ────────────────────────────────────────────────────────────────────

export const megamenuBindingSchema = z.object({
  salesChannelId: uuidSchema,
  language: z.string().min(2).max(8),
  active: z.boolean(),
  version: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type MegamenuBinding = z.infer<typeof megamenuBindingSchema>;

export const megamenuSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  version: z.number().int(),
  bindings: z.array(megamenuBindingSchema),
  activeIn: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type MegamenuSummary = z.infer<typeof megamenuSummarySchema>;

export const megamenuDetailSchema = megamenuSummarySchema.extend({
  items: z.array(megamenuItemSchema),
});
export type MegamenuDetail = z.infer<typeof megamenuDetailSchema>;

export const createMegamenuRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
});
export type CreateMegamenuRequest = z.infer<typeof createMegamenuRequestSchema>;

export const patchMegamenuRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    version: z.number().int().optional(),
  })
  .refine((x) => Object.keys(x).length > 0, { message: 'At least one field required.' });
export type PatchMegamenuRequest = z.infer<typeof patchMegamenuRequestSchema>;

export const putItemsRequestSchema = z.object({
  items: z.array(megamenuItemSchema),
  version: z.number().int(),
});
export type PutItemsRequest = z.infer<typeof putItemsRequestSchema>;

export const addBindingRequestSchema = z.object({
  salesChannelId: uuidSchema,
  language: z.string().min(2).max(8),
});
export type AddBindingRequest = z.infer<typeof addBindingRequestSchema>;

export const activateBindingRequestSchema = addBindingRequestSchema;
export type ActivateBindingRequest = z.infer<typeof activateBindingRequestSchema>;

// ────────────────────────────────────────────────────────────────────
// Storefront resolved payload (recursive)
// ────────────────────────────────────────────────────────────────────

export const megamenuResolvedIconSchema = z.object({
  assetId: uuidSchema,
  url: z.string(),
  position: megamenuIconPositionSchema,
});
export type MegamenuResolvedIcon = z.infer<typeof megamenuResolvedIconSchema>;

export const megamenuResolvedAssetSchema = z.object({
  id: uuidSchema,
  kind: megamenuAssetKindSchema,
  url: z.string(),
  label: z.string().nullable(),
});
export type MegamenuResolvedAsset = z.infer<typeof megamenuResolvedAssetSchema>;

export const megamenuResolvedBlockSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  language: z.string(),
  content: z.object({ schemaVersion: z.number().int(), data: z.unknown() }),
});
export type MegamenuResolvedBlock = z.infer<typeof megamenuResolvedBlockSchema>;

const resolvedMenuItemBase = z.object({
  id: uuidSchema,
  parentId: uuidSchema.nullable(),
  kind: megamenuItemKindSchema,
  label: z.string(),
  description: z.string().nullable().optional(),
  url: z.string().optional(),
  icon: megamenuResolvedIconSchema.nullable().optional(),
  variant: megamenuButtonVariantSchema.optional(),
  asset: megamenuResolvedAssetSchema.optional(),
  block: megamenuResolvedBlockSchema.optional(),
  embedSide: megamenuEmbedSideSchema.optional(),
});

export type ResolvedMenuItem = z.infer<typeof resolvedMenuItemBase> & {
  children: ResolvedMenuItem[];
};

export const resolvedMenuItemSchema: z.ZodType<ResolvedMenuItem> = z.lazy(() =>
  resolvedMenuItemBase.extend({ children: z.array(resolvedMenuItemSchema) }),
);

export const resolvedMegamenuSchema = z.object({
  megamenuId: uuidSchema,
  name: z.string(),
  language: z.string(),
  items: z.array(resolvedMenuItemSchema),
});
export type ResolvedMegamenu = z.infer<typeof resolvedMegamenuSchema>;

// ────────────────────────────────────────────────────────────────────
// Activate response — surfaces the previously-active menu so the admin
// can render a "switched from <name>" confirmation.
// ────────────────────────────────────────────────────────────────────

export const activateBindingResponseSchema = z.object({
  activated: z.object({
    megamenuId: uuidSchema,
    salesChannelId: uuidSchema,
    language: z.string(),
  }),
  previouslyActive: z
    .object({
      megamenuId: uuidSchema,
      name: z.string(),
    })
    .nullable(),
});
export type ActivateBindingResponse = z.infer<typeof activateBindingResponseSchema>;
