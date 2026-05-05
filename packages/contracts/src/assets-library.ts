// Assets Library — feature 013 contract surface.
// Replaces the legacy `assets` module's wire surface and adds folders, visibility,
// labels, and pluggable storage backends. Three logical sections in one file:
//   (1) Domain types — visibility, storage backend code, asset reference kinds.
//   (2) HTTP request/response Zod schemas for /api/v1/admin/assets/** and /assets/file/:id.
//   (3) Cross-module SPI shapes — StorageAdapter, AssetReferenceDescriptor, CMS body embed.
//
// See specs/013-assets-library/contracts/ for the per-surface contracts these schemas back.

import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema, multilingualStringSchema } from './common.js';

// ────────────────────────────────────────────────────────────────────────────
// (1) Domain types
// ────────────────────────────────────────────────────────────────────────────

export const assetVisibilitySchema = z.enum(['public', 'private']);
export type AssetVisibility = z.infer<typeof assetVisibilitySchema>;

/**
 * Storage-backend identifier persisted on every Asset row so that switching the
 * platform's *active* adapter does not orphan files uploaded under a previous
 * adapter. `'legacy'` is a runtime-only escape hatch for rows whose pre-013
 * `storage_url` is an absolute URL — see specs/013-assets-library/research.md R11.
 */
export const storageBackendCodeSchema = z.enum(['local', 's3', 'gcs', 'legacy']);
export type StorageBackendCode = z.infer<typeof storageBackendCodeSchema>;

/** What kind of consumer pointed at a given Asset (used in delete-blocked dialogs). */
export const assetReferenceKindSchema = z.enum([
  'product_gallery',
  'product_attachment',
  'product_virtual_download',
  'category_main_image',
  'cms_body_embed',
  'megamenu_item_target',
]);
export type AssetReferenceKind = z.infer<typeof assetReferenceKindSchema>;

export const assetReferenceSchema = z.object({
  kind: assetReferenceKindSchema,
  entityId: uuidSchema,
  label: z.string(),
});
export type AssetReference = z.infer<typeof assetReferenceSchema>;

// ────────────────────────────────────────────────────────────────────────────
// (2) HTTP — folders
// ────────────────────────────────────────────────────────────────────────────

export const assetFolderSchema = z.object({
  id: uuidSchema,
  parentId: uuidSchema.nullable(),
  name: z.string().min(1).max(160),
  position: z.number().int().nonnegative(),
  childIds: z.array(uuidSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AssetFolder = z.infer<typeof assetFolderSchema>;

export const listFoldersResponseSchema = z.object({
  data: z.array(assetFolderSchema),
});
export type ListFoldersResponse = z.infer<typeof listFoldersResponseSchema>;

export const createFolderRequestSchema = z.object({
  parentId: uuidSchema.nullable(),
  name: z.string().min(1).max(160),
});
export type CreateFolderRequest = z.infer<typeof createFolderRequestSchema>;

export const patchFolderRequestSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    parentId: uuidSchema.nullable().optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .refine((x) => x.name !== undefined || x.parentId !== undefined || x.position !== undefined, {
    message: 'At least one of {name, parentId, position} is required.',
  });
export type PatchFolderRequest = z.infer<typeof patchFolderRequestSchema>;

export const deleteFolderRequestSchema = z.object({
  ifNonEmpty: z.enum(['cancel', 'moveContentsToParent', 'deleteRecursively']).default('cancel'),
});
export type DeleteFolderRequest = z.infer<typeof deleteFolderRequestSchema>;

export const deleteFolderResponseSchema = z.object({
  data: z.object({
    deletedFolderId: uuidSchema,
    softDeletedAssetIds: z.array(uuidSchema).optional(),
  }),
});
export type DeleteFolderResponse = z.infer<typeof deleteFolderResponseSchema>;

// ────────────────────────────────────────────────────────────────────────────
// (2) HTTP — assets list / detail
// ────────────────────────────────────────────────────────────────────────────

/**
 * Public asset summary — appears in the Library list, the picker, and embedded
 * inside Catalog/CMS storefront responses. `url` is freshly produced by the
 * active adapter on every read; for `private` assets it is a short-lived
 * signed URL whose TTL is governed by the `assets.privateUrlTtlSec` setting.
 */
export const assetSummarySchema = z.object({
  id: uuidSchema,
  folderId: uuidSchema.nullable(),
  filename: z.string().min(1).max(255),
  label: z.string().nullable(),
  mimeType: z.string().min(1).max(127),
  sizeBytes: z.number().int().nonnegative(),
  visibility: assetVisibilitySchema,
  storageBackend: storageBackendCodeSchema,
  url: z.string(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
  pendingCleanup: z.boolean(),
});
export type AssetSummary = z.infer<typeof assetSummarySchema>;

/** Detail extends summary with multilingual alt text + the deletion-protection list. */
export const assetDetailSchema = assetSummarySchema.extend({
  altText: multilingualStringSchema.nullable(),
  references: z.array(assetReferenceSchema),
});
export type AssetDetail = z.infer<typeof assetDetailSchema>;

export const listAssetsQuerySchema = z.object({
  folderId: uuidSchema.nullable().optional(),
  q: z.string().optional(),
  mime: z.string().optional(),
  visibility: assetVisibilitySchema.optional(),
  includeDeleted: z.coerce.boolean().default(false),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;

export const listAssetsResponseSchema = z.object({
  data: z.array(assetSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListAssetsResponse = z.infer<typeof listAssetsResponseSchema>;

export const getAssetResponseSchema = z.object({ data: assetDetailSchema });
export type GetAssetResponse = z.infer<typeof getAssetResponseSchema>;

export const getAssetUrlResponseSchema = z.object({
  data: z.object({
    url: z.string(),
    expiresAt: isoDateTimeSchema.nullable(),
  }),
});
export type GetAssetUrlResponse = z.infer<typeof getAssetUrlResponseSchema>;

// ────────────────────────────────────────────────────────────────────────────
// (2) HTTP — asset mutation
// ────────────────────────────────────────────────────────────────────────────

export const patchAssetRequestSchema = z
  .object({
    filename: z.string().min(1).max(255).optional(),
    label: z.string().nullable().optional(),
    mimeType: z.string().min(1).max(127).optional(),
    visibility: assetVisibilitySchema.optional(),
    folderId: uuidSchema.nullable().optional(),
  })
  .refine((x) => Object.keys(x).length > 0, { message: 'At least one field is required.' });
export type PatchAssetRequest = z.infer<typeof patchAssetRequestSchema>;

export const moveAssetRequestSchema = z.object({ folderId: uuidSchema.nullable() });
export type MoveAssetRequest = z.infer<typeof moveAssetRequestSchema>;

export const moveManyAssetsRequestSchema = z.object({
  assetIds: z.array(uuidSchema).min(1).max(200),
  folderId: uuidSchema.nullable(),
});
export type MoveManyAssetsRequest = z.infer<typeof moveManyAssetsRequestSchema>;

export const moveManyAssetsResponseSchema = z.object({
  data: z.object({ movedCount: z.number().int().nonnegative() }),
});
export type MoveManyAssetsResponse = z.infer<typeof moveManyAssetsResponseSchema>;

// ────────────────────────────────────────────────────────────────────────────
// (2) HTTP — storage administration
// ────────────────────────────────────────────────────────────────────────────

export const storageSelfCheckResponseSchema = z.object({
  data: z.object({
    adapter: storageBackendCodeSchema.exclude(['legacy']),
    ok: z.boolean(),
    reason: z.string().optional(),
  }),
});
export type StorageSelfCheckResponse = z.infer<typeof storageSelfCheckResponseSchema>;

export const storageStateResponseSchema = z.object({
  data: z.object({
    activeAdapter: storageBackendCodeSchema.exclude(['legacy']),
    selfCheck: z.object({ ok: z.boolean(), reason: z.string().optional() }),
    pendingCleanupCount: z.number().int().nonnegative(),
    softDeletedCount: z.number().int().nonnegative(),
  }),
});
export type StorageStateResponse = z.infer<typeof storageStateResponseSchema>;

// ────────────────────────────────────────────────────────────────────────────
// (3) CMS body embed (FR-029)
// ────────────────────────────────────────────────────────────────────────────

export const assetRefNodeSchema = z
  .object({
    type: z.literal('asset_ref'),
    assetId: uuidSchema,
    rendering: z.enum(['image', 'link', 'embed']).optional(),
  })
  .passthrough();
export type AssetRefNode = z.infer<typeof assetRefNodeSchema>;

/** Resolved view of an embedded asset, returned alongside the body in CMS responses. */
export const assetEmbedResolutionSchema = z.object({
  url: z.string(),
  mimeType: z.string(),
  filename: z.string(),
  label: z.string().nullable(),
  visibility: assetVisibilitySchema,
});
export type AssetEmbedResolution = z.infer<typeof assetEmbedResolutionSchema>;
