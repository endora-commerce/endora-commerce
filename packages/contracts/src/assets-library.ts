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
  'blog_category_main_image',
  'blog_post_content',
  'blog_category_description',
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
   * them. MUST issue a single batched query, one per descriptor regardless of
   * batch size.
   */
  findReferences(assetIds: string[]): Promise<AssetReference[]>;
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
