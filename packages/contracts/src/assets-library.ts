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
  'category_content',
  'cms_body_embed',
  'megamenu_item_target',
  'blog_category_main_image',
  'blog_post_main_image',
  'blog_post_content',
  'blog_category_description',
  'crm_opportunity_attachment',
  // `specs/163-projects-and-tasks/` FR-027: a file attached to a Project.
  'project_attachment',
  // `specs/165-task-management/` FR-008: a file attached to a Task.
  'task_attachment',
  // `specs/171-blog-i18n-authors/` US6: an administrator's author avatar.
  'admin_user_avatar',
  // `specs/172-product-content-attributes/` FR-063: an asset embedded in a product's content attribute.
  'product_content',
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

/**
 * `GET /api/v1/admin/assets/folders/:folderId/permalink-count` — how many live
 * assets in the folder's subtree have a permalink, named by the folder delete
 * confirmation (specs/156-asset-stable-url/, owner ruling S4).
 */
export const folderPermalinkCountResponseSchema = z.object({
  data: z.object({ permalinkedAssets: z.number().int().nonnegative() }),
});
export type FolderPermalinkCountResponse = z.infer<typeof folderPermalinkCountResponseSchema>;

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
  /** The stable, unversioned file URL — the same across replaces (specs/156-asset-stable-url/). */
  fileUrl: z.string(),
  /** Operator-chosen alias served at `<base>/assets/file/<permalink>`, or null. */
  permalink: z.string().nullable(),
  /** Absolute permalink URL on the local public base, or null when no permalink is set. */
  permalinkUrl: z.string().nullable(),
  /** Identity of the bytes the asset currently holds. */
  contentVersion: z.string(),
});
export type AssetSummary = z.infer<typeof assetSummarySchema>;

/** The one kept previous version of an asset's file, as the detail panel shows it. */
export const assetPreviousVersionSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  sizeBytes: z.number().int().nonnegative(),
  contentVersion: z.string().min(1).max(32),
  replacedAt: isoDateTimeSchema,
  replacedBy: z.object({ id: uuidSchema, displayName: z.string() }).nullable(),
  /** `replacedAt` + `assets.soft_delete_retention_days` as read now. */
  restorableUntil: isoDateTimeSchema,
});
export type AssetPreviousVersion = z.infer<typeof assetPreviousVersionSchema>;

/** Detail extends summary with multilingual alt text + the deletion-protection list. */
export const assetDetailSchema = assetSummarySchema.extend({
  altText: multilingualStringSchema.nullable(),
  references: z.array(assetReferenceSchema),
  /** The one kept previous version of the file, or null (specs/156-asset-stable-url/). */
  previousVersion: assetPreviousVersionSchema.nullable(),
  /**
   * `assets.soft_delete_retention_days` as the retention sweep reads it, in
   * whole days (at least one): how long a replaced file stays restorable, named
   * by the replace confirmation (specs/156-asset-stable-url/).
   */
  retentionDays: z.number().int().min(1),
  /**
   * Whether the file can be replaced in place (and a previous version
   * restored): false for a legacy row and for a row with no storage key, which
   * both answer `409 ASSET_LEGACY_CANNOT_REPLACE` (specs/156-asset-stable-url/,
   * owner ruling S3).
   */
  replaceable: z.boolean(),
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
// (2) HTTP — permalinks and the previous version (specs/156-asset-stable-url/)
// ────────────────────────────────────────────────────────────────────────────

export const ASSET_PERMALINK_MAX_LENGTH = 200;

export type AssetPermalinkInvalidReason =
  | 'empty'
  | 'too_long'
  | 'invalid_characters'
  | 'invalid_segment'
  | 'uuid_shaped';

const ASSET_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERMALINK_CHARACTERS = /^[A-Za-z0-9._/-]+$/;

/**
 * True for the shape the file route treats as an asset id, in either case. A
 * permalink of this shape would be unreachable, so the validator refuses it.
 */
export function isAssetIdShaped(segment: string): boolean {
  return ASSET_ID_SHAPE.test(segment);
}

/**
 * The one permalink rule for the server and the admin form. Pure; no I/O.
 * Checks run in a fixed order so a value breaking several rules always gets
 * the same reason.
 */
export function validateAssetPermalink(
  value: string,
): { ok: true } | { ok: false; reason: AssetPermalinkInvalidReason } {
  if (value.length === 0) return { ok: false, reason: 'empty' };
  if (value.length > ASSET_PERMALINK_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  if (!PERMALINK_CHARACTERS.test(value)) return { ok: false, reason: 'invalid_characters' };
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return { ok: false, reason: 'invalid_segment' };
  }
  if (isAssetIdShaped(value)) return { ok: false, reason: 'uuid_shaped' };
  return { ok: true };
}

export const setAssetPermalinkRequestSchema = z.object({
  /** Shape judged by `validateAssetPermalink`; the bound only caps the body. */
  permalink: z.string().max(ASSET_PERMALINK_MAX_LENGTH * 2),
  /**
   * Acknowledges taking a permalink whose last holder was a different asset;
   * never needed by the asset that last held it.
   */
  confirmReuse: z.boolean().optional(),
});
export type SetAssetPermalinkRequest = z.infer<typeof setAssetPermalinkRequestSchema>;

/** Both required: a restore names the current file and the previous file it brings back. */
export const restorePreviousAssetVersionRequestSchema = z.object({
  expectedContentVersion: z.string().min(1).max(32),
  expectedPreviousContentVersion: z.string().min(1).max(32),
});
export type RestorePreviousAssetVersionRequest = z.infer<
  typeof restorePreviousAssetVersionRequestSchema
>;

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

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The in-process surface `assets_library` publishes to the six modules that
// read it (feature 075, Phase P). Plain TypeScript, not Zod: these describe
// in-process calls, not an API boundary.
// ---------------------------------------------------------------------------

/**
 * An asset row as it crosses a module boundary — a plain shape, never the ORM
 * entity (FR-011). Distinct from `AssetSummary` / `AssetDetail` above, which
 * are the HTTP projections: those carry ISO strings and a resolved URL, this
 * carries the columns a module reads when it embeds or attaches one.
 */
/**
 * What the library stores, as the column records it.
 *
 * Deliberately **not** `catalog`'s `AssetKind`, which the two attach surfaces
 * narrow to: this one carries `other`, and a record typed with the narrower
 * union would make every row the library holds unrepresentable in the shape
 * that reads it.
 */
export type AssetStoredKind = 'image' | 'video' | 'pdf' | 'certificate' | 'other';

export interface AssetRecord {
  id: string;
  kind: AssetStoredKind;
  filename: string;
  mimeType: string;
  /** Byte count as a decimal string — the column is `bigint`. */
  sizeBytes: string;
  storageUrl: string;
  altText: Record<string, string> | null;
  folderId: string | null;
  visibility: AssetVisibility;
  label: string | null;
  storageBackend: 'local' | 's3' | 'gcs' | 'legacy';
  storageLocator: string;
  pendingCleanup: boolean;
  purgeAfterAt: Date | null;
  mimeTypeOverridden: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  /** Identity of the bytes the asset currently holds (specs/156-asset-stable-url/). */
  contentVersion: string;
  /** Operator-chosen alias, or null. */
  permalink: string | null;
}

/**
 * Container name: `assetReadPort`. Owner: `assets_library`.
 *
 * Five inbound sites read the `Asset` entity to validate that an id an admin
 * supplied exists and is the right kind before attaching it — `catalog`'s
 * gallery, attachments and product links, and `orders`' invoice branding.
 *
 * When `assets_library` is off the read fails closed, which is right: an
 * attach that cannot verify the asset would store a dangling id.
 *
 * Whether `assets_library` has an off state at all is its manifest's `activation` to
 * say, not this line's: a module declaring `nonDeactivatable` never enters one.
 */
export interface AssetReadPort {
  findById(id: string, options?: { liveOnly?: boolean }): Promise<AssetRecord | null>;
  findByIds(
    ids: readonly string[],
    options?: { liveOnly?: boolean },
  ): Promise<AssetRecord[]>;

  /**
   * The **stable, publicly reachable** URL of each of these assets, keyed by
   * asset id — and nothing for the rest.
   *
   * Absence is the answer, not an exception: an id that names no row, a
   * soft-deleted one, a `private` one and one whose URL could only be produced
   * as an expiring signed link are all simply missing from the map. That is the
   * degrade expressed in the return type rather than at a caller's `catch`,
   * which is the only place it can be decided — a consumer holding an asset id
   * cannot tell a signed URL from a stable one, and a consumer that guesses
   * publishes a link that 403s the day after it is fetched.
   *
   * `product_feeds` is the requirement (FR-043): a marketplace fetches a feed
   * from its own network days after it was written, so an expiring URL is not a
   * slightly worse URL, it is no URL at all. It came here from a composition
   * root's closure in `specs/110-instance-repository/` T118c.
   *
   * **Batched, and that is why it is here rather than
   * {@link AssetsLibraryPort.getAsset}.** `getAsset` answers the same question
   * for one asset and carries a resolved `url` already, which is the right
   * answer for `cms` resolving a handful of embeds on one page. It is the wrong
   * one for a feed: it builds the full detail, and the detail carries the
   * deletion-protection `references` list, which is one query per registered
   * reference descriptor. Measured on this tree — seven descriptors, so roughly
   * ten queries per asset — against a feed hydration batch of 500 products
   * whose gallery is one to four images each. This is one query plus a string
   * build per row, and the run walks the whole sellable catalogue.
   */
  resolvePublicUrls(assetIds: readonly string[]): Promise<Map<string, string>>;

  /**
   * Which of these assets the **ambient caller** may see in the asset library
   * (`specs/166-asset-reference-visibility/`): an asset no reader-restricted
   * record uses, or one at least one of whose records the caller may see. The
   * system actor and a holder of the platform wildcard `*` see every id that
   * exists. An id that does not exist, or is not a uuid, is absent — the same
   * as a hidden one.
   *
   * Ask it before any other refusal that would describe the asset (its
   * visibility, its type), so a hidden asset and a missing one get one answer.
   * The other methods of this port are unfiltered: they serve modules that
   * decide by their own record's rules.
   */
  visibleToCaller(assetIds: readonly string[]): Promise<ReadonlySet<string>>;

  /**
   * The **bytes** of one asset, buffered, with the MIME type they were stored
   * under — or nothing.
   *
   * Absence is the answer and not an exception, for the reason
   * {@link resolvePublicUrls} gives: an id that names no row, a soft-deleted
   * one, a row whose bytes this platform never issued (`storageBackend` is
   * `legacy` — a URL this library can resolve and an object it cannot open) and
   * a configured store that would not stream are all simply `null`. That is the
   * degrade expressed in the return type rather than at a caller's `catch`,
   * which is composition checklist item 7's rule and the only place it can be
   * decided: the caller cannot tell "this asset is not there" from "the bucket
   * did not answer", and neither should turn a document into an error page.
   *
   * `invoices` is the requirement. pdfmake resolves an `image:` by **fetching**
   * it, so an `InvoiceLogo` pointing at `/assets/file/<id>` makes the process
   * serving the preview request issue an HTTP request to itself — which
   * deadlocks for a public asset and 403s for a private one. The document
   * embeds an inline `data:` URI instead, and that needs the bytes. It came
   * here from a composition root's closure in
   * `specs/110-instance-repository/` T118c.
   *
   * **Here rather than on {@link AssetsLibraryPort}, and rather than left at
   * the caller over {@link ObjectStoragePort}.** It is a read, and a consumer
   * that wants a logo must not thereby acquire `upload`, `patchAsset` and
   * `softDelete` — the argument `ObjectStoragePort`'s own doc block makes in
   * the other direction. A caller that opened the store itself would carry
   * three facts about this module's storage layout instead: that `legacy` has
   * no `open`, that a locator falls back to `storageUrl` when the column is
   * empty, and that the stream has to be drained. Those are what the root
   * closure knew, and moving them here is what publishing a port is for.
   *
   * `Uint8Array` and not `Buffer`: this package is compiled by
   * `@endora-commerce/admin-kit` with `types: ["vite/client"]`, so the `Buffer`
   * global is not in scope — the reason {@link AssetByteStream} gives in full.
   * Buffered and not a stream, because the one consumer base64-encodes the
   * whole object and the objects this answers for are document decorations. A
   * consumer that wants to *stream* bytes it owns takes
   * {@link ObjectStoragePort}.
   *
   * **It does not filter by kind, and that is the caller's half.** Which MIME
   * types a consumer can use is the consumer's rule — pdfmake embeds PNG and
   * JPEG and nothing else — so ask {@link findById} first when the answer
   * decides whether the bytes are worth moving.
   */
  openAssetBytes(assetId: string): Promise<AssetBytes | null>;
}

/** One asset's stored bytes, with the MIME type they were stored under. */
export interface AssetBytes {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * One reference as a descriptor reports it. `assetId` is the asset the
 * reference points at — what lets the library answer for many assets in one
 * call (`specs/166-asset-reference-visibility/` research R-6).
 *
 * Required of a descriptor that declares `readerRestriction`, and set by every
 * descriptor in this repository. A descriptor that omits it is still answered
 * correctly: the registry asks it one asset at a time. Never sent to a client:
 * `AssetDetail.references` carries {@link AssetReference}, and the library
 * strips the field.
 */
export type AssetReferenceHit = AssetReference & { readonly assetId?: string };

/**
 * The reader-restriction half of a descriptor (feature 166, FR-002/FR-003):
 * a reader who may see none of the records referencing an asset does not see
 * the asset in the library.
 *
 * **Every method answers for the ambient caller** — the administrator the
 * request's TenantContext names, with their Organization reach — exactly as
 * the owner's own screens do, **including the owner's read permission** (a
 * caller without `tasks:read` sees no Task). The caller is never a parameter:
 * it is the `TaskContextDescriptor` precedent.
 *
 * The library asks only while the owner is **effectively present**, and never
 * for the system actor or a holder of the platform wildcard, whom it answers
 * itself. Each method is a bounded number of statements, independent of the
 * size of its input (FR-014). Never catch `ModuleDisabledError` inside one
 * (`check:port-catches`).
 */
export interface AssetReferenceReaderRestriction {
  /** Of these record ids of this descriptor's kind, the ones the caller may see. Unknown ids are simply absent. */
  visibleEntityIds(entityIds: readonly string[]): Promise<ReadonlySet<string>>;
  /**
   * Every asset id that at least one record of this kind the caller may
   * **not** see points at. The exact complement of `visibleEntityIds` over
   * this descriptor's references — written NULL-safe (`(<visible>) is not
   * true`), so a row the predicate cannot decide is hidden, never shown.
   */
  assetIdsWithHiddenReferences(): Promise<readonly string[]>;
  /**
   * Every asset id any record of this kind points at, whoever asks. Asked
   * while the owner is **switched off**, when no record of it is visible to a
   * restricted reader. Plain SQL over the owner's own tables, like
   * `findReferences`, because it runs while the owner is off: it resolves no
   * port.
   */
  allReferencedAssetIds(): Promise<readonly string[]>;
}

/**
 * One contributed "who points at this asset" scanner.
 *
 * `ownerModuleId` is required and is the whole mechanism (D-39): without it the
 * registry could not state a policy for an absent owner at all — not "honour",
 * not "skip", only "nobody looked".
 */
export interface AssetReferenceDescriptor {
  ownerModuleId: string;
  /**
   * Given a list of asset ids, return every reference that points at any of
   * them, each tagged with the `assetId` it points at. MUST issue a single
   * batched query, one per descriptor regardless of batch size.
   *
   * A descriptor returning plain {@link AssetReference}s still compiles and is
   * still answered correctly — the registry asks it one asset at a time
   * wherever it needs to attribute a batch.
   */
  findReferences(assetIds: string[]): Promise<AssetReferenceHit[]>;
  /**
   * Present ⇔ these references are **reader-restricted**: a reader who may see
   * none of the records referencing an asset does not see the asset (feature
   * 166, FR-001). Absent ⇔ the references never hide an asset (catalog, cms,
   * blog, megamenu). An optional **data property**, not an optional method
   * (`check:port-shape`).
   */
  readonly readerRestriction?: AssetReferenceReaderRestriction;
}

/**
 * Container name: `assetReferenceRegistry`. Owner: `assets_library`.
 *
 * A **contribution seam**: `catalog` (four descriptors), `cms`, `blog` and
 * `megamenu` register from their boot hooks, and the library consults the
 * table before every soft-delete (feature 013 FR-030).
 *
 * **Enumeration policy: honoured while the contributing module is absent**,
 * and that is the deviation from D-39's default, with the reason D-39 requires.
 * This registry is referential integrity, not a surface. If `blog` is switched
 * off its posts still exist and still embed assets; skipping `blog`'s scanner
 * would let an operator delete an asset that comes back as a broken image the
 * moment `blog` is switched on again — data loss caused by an action
 * Constitution XVII promises is non-destructive and reversible.
 *
 * `skip` is right for surface-like contributions, where a switched-off module
 * must contribute nothing a user can see. Nobody sees these; they exist to
 * refuse a delete. Publishing the shape must not change that classification.
 *
 * **Enumeration is not visibility** (feature 166). Which assets a library
 * reader may see is the library's own evaluation, which reads the same
 * descriptors and decides a switched-off owner's references as **hidden**
 * (fail closed). The two policies answer different questions: this port's
 * methods answer "does anything still use this file", for whoever asks.
 */
export interface AssetReferenceRegistryPort {
  register(descriptor: AssetReferenceDescriptor): void;
  /** The contributing module of every registered descriptor, in registration order. */
  owners(): readonly string[];
  /** Every reference pointing at **one** asset, across all descriptors. */
  findReferences(assetId: string): Promise<AssetReference[]>;
  /**
   * The same question for many assets at once, keyed by asset id. Every id
   * asked for is present in the result, with an empty list when nothing points
   * at it — a caller deleting in bulk needs to tell "no references" from "not
   * asked about".
   */
  findReferencesMany(assetIds: string[]): Promise<Map<string, AssetReference[]>>;
}

export interface AssetPatchInput {
  filename?: string;
  label?: string | null;
  mimeType?: string;
  visibility?: AssetVisibility;
  folderId?: string | null;
  /**
   * Per-language alternate text. Feature 068 needs it, because an imported
   * image must keep the alternate text the source supplied, per language
   * (FR-047). Deliberately absent from the HTTP patch schema — this is a
   * module-caller field.
   */
  altText?: Record<string, string> | null;
}

/**
 * The byte source an upload streams from, described structurally.
 *
 * Deliberately **not** `NodeJS.ReadableStream`: this package is imported by
 * the admin SPA and the storefront as well as the backend, and naming the
 * `NodeJS` namespace here fails the compile of a consumer that type-checks
 * without `@types/node`. It named `@endora-commerce/api-client` until D-202
 * deleted that package; measured again on the tree that replaced it, the
 * consumer that goes red is `@endora-commerce/admin-kit`, which compiles this
 * file with `types: ["vite/client"]`. A Node `Readable` satisfies this shape —
 * `Buffer` extends `Uint8Array` — so the one caller passes its multipart part
 * through unchanged.
 */
export interface AssetUploadStream {
  [Symbol.asyncIterator](): AsyncIterableIterator<string | Uint8Array>;
}

export interface AssetUploadInput {
  /** Original filename from the multipart part. Used for extension + display. */
  filename: string;
  /** MIME from the multipart Content-Type header (may be wrong; sniffed on ingest). */
  declaredMime: string;
  /** Streaming source — must be consumed exactly once. */
  stream: AssetUploadStream;
  /** Best-effort byte count from headers; `0` when unknown. */
  declaredSize: number;
  /** Folder id chosen by the caller, or null for "Unsorted". */
  folderId: string | null;
  /** Optional storefront-visible label. */
  label: string | null;
  visibility: AssetVisibility;
}

/**
 * Container name: `assetsLibraryPort`. Owner: `assets_library`.
 *
 * `pim_ergonode` ingests media during an import run: it uploads the file the
 * source supplied, patches the alternate text onto it, and soft-deletes the
 * asset an item stopped pointing at. Four methods, which is the whole of the
 * demand — the module's own admin surface is much larger and stays unpublished.
 *
 * `cms` is the second consumer and takes `getAsset` alone, to turn an asset id a
 * page or block embeds into the detail the storefront response carries. It reached
 * the same service through a composition-root contribution until
 * `specs/110-instance-repository/` T118c; nothing about this interface changed to
 * admit it, which is the point of publishing one.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `assets_library` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface AssetsLibraryPort {
  upload(input: AssetUploadInput): Promise<AssetDetail>;
  getAsset(assetId: string): Promise<AssetDetail>;
  patchAsset(assetId: string, patch: AssetPatchInput): Promise<AssetDetail>;
  softDelete(assetId: string): Promise<{ deletedAt: Date; purgeAfterAt: Date }>;
}

/**
 * The byte source an object read streams into, described structurally.
 *
 * {@link AssetUploadStream}'s twin, for the reason that one gives in full: this
 * package is compiled by `@endora-commerce/admin-kit` with
 * `types: ["vite/client"]`, so naming the `NodeJS` namespace here fails a
 * consumer's build. A Node `Readable` satisfies it — `NodeJS.ReadableStream`
 * declares `[Symbol.asyncIterator](): AsyncIterableIterator<string | Buffer>`
 * and `Buffer` extends `Uint8Array` — so an adapter returns its stream
 * unchanged and a consumer that needs `.pipe` wraps it once with
 * `Readable.from`, in a backend layer where `node:stream` is legal.
 */
export interface AssetByteStream {
  [Symbol.asyncIterator](): AsyncIterableIterator<string | Uint8Array>;
}

/**
 * A backend that physically stores objects.
 *
 * {@link StorageBackendCode} minus `legacy`, and the exclusion is the whole
 * point: `legacy` is not a store, it is a resolver for pre-013 rows whose URL
 * this platform did not issue. It can answer a URL and it can stream nothing,
 * which is why {@link ObjectStoragePort.getForBackend} is total here and the
 * module-internal registry's equivalent is not.
 */
export type ObjectStorageBackendCode = Exclude<StorageBackendCode, 'legacy'>;

export interface ObjectStoragePutInput {
  locator: string;
  mimeType: string;
  visibility: AssetVisibility;
  /** Consumed exactly once. */
  stream: AssetUploadStream;
  /** Best-effort byte count; `0` when the length is not known up front. */
  sizeBytes: number;
}

/** One configured object store — bytes in, bytes out, bytes gone. */
export interface ObjectStore {
  /** Which backend this is, so a caller can record where an object's bytes went. */
  readonly code: ObjectStorageBackendCode;
  put(input: ObjectStoragePutInput): Promise<void>;
  open(input: { locator: string }): Promise<AssetByteStream>;
  delete(input: { locator: string }): Promise<void>;
}

/**
 * Container name: `objectStoragePort`. Owner: `assets_library`.
 *
 * **Which bucket this deployment writes to, with which credentials** — and
 * nothing about assets. A consumer of this port stores its own bytes under its
 * own locator prefix and creates no `Asset` row: the objects are its data, they
 * do not appear in the asset browser, they are not counted in library quotas
 * and they are not reachable through the assets routes.
 *
 * `product_feeds` is the first consumer (FR-043): a generated feed artefact is
 * written under `product-feeds/…` and served by that module's own tokenised
 * route, which streams `open()` rather than handing out a store URL, so
 * rotating a feed token actually revokes access. `invoices` asks the same
 * question of the same registry today through a composition root, to embed a
 * logo in a PDF.
 *
 * **A sibling of {@link AssetsLibraryPort} rather than four more methods on
 * it.** That port's demand is an *asset* — upload it, read it, patch its
 * alternate text, soft-delete it — and hanging a byte store off it would hand
 * an importer a capability it never asked for. These are two capabilities that
 * happen to share a configuration.
 *
 * **Retiring condition.** This is really an object store and not an asset
 * library, and it lives here because that is where the configuration lives. If
 * a byte-store module is ever extracted, this port moves to it wholesale and no
 * consumer's call site changes. Nothing is owed today: `assets_library`
 * declares `nonDeactivatable`, so the coupling costs an operator no control.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `assets_library` has an off state at all is its
 * manifest's `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface ObjectStoragePort {
  /** The store new objects are written to. */
  getActive(): Promise<ObjectStore>;
  /**
   * The store that owns an existing object's bytes. Reads and deletes MUST go
   * through this and never through {@link getActive}: after a backend switch
   * the active store would resolve an object written under the old one to the
   * wrong place.
   */
  getForBackend(backend: ObjectStorageBackendCode): Promise<ObjectStore>;
}
