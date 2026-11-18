// Admin HTTP surface for the Assets Library — feature 013 / US1.
// Mounts under /api/v1/admin/assets/*.
//
// Routes implemented in this phase (US1):
//   POST   /api/v1/admin/assets             — multipart upload
//   GET    /api/v1/admin/assets             — list (folder filter + pagination)
//   GET    /api/v1/admin/assets/:id         — detail with references
//   GET    /api/v1/admin/assets/:id/url     — re-resolve URL on demand
//   PATCH  /api/v1/admin/assets/:id         — edit metadata + visibility flip
//   POST   /api/v1/admin/assets/:id/replace — replace the file in place (feature 156)
//   POST   /api/v1/admin/assets/:id/previous-version/restore — swap the previous version back (feature 156)
//   PUT    /api/v1/admin/assets/:id/permalink — set the permalink (feature 156)
//   DELETE /api/v1/admin/assets/:id/permalink — remove it (feature 156)
//
// Folder CRUD, soft-delete, restore, bulk move, and storage self-check
// land in subsequent user stories.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Multipart } from '@fastify/multipart';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  patchAssetRequestSchema,
  listAssetsQuerySchema,
  createFolderRequestSchema,
  patchFolderRequestSchema,
  deleteFolderRequestSchema,
  moveAssetRequestSchema,
  moveManyAssetsRequestSchema,
  restorePreviousAssetVersionRequestSchema,
  setAssetPermalinkRequestSchema,
} from '@endora-commerce/contracts';

import { HttpError } from '@endora-commerce/platform/http';
import { Asset } from './entities/asset.entity.js';
import type { AssetsLibraryService } from './services/assets-library.service.js';
import type { FoldersService } from './services/folders.service.js';
import type { AdapterRegistry } from './services/storage/adapter-registry.js';
import type { AssetVisibility } from './services/asset-visibility.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

export interface AdminRoutesDeps {
  service: AssetsLibraryService;
  folders: FoldersService;
  adapters: AdapterRegistry;
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /** Which assets the caller may see (`specs/166-asset-reference-visibility/`). */
  visibility: Pick<AssetVisibility, 'assertVisible'>;
}

const VISIBLE_ASSET_GUARD = Symbol('requireVisibleAsset');

/** Whether a pre-handler is the by-id visibility guard — what the structural test looks for. */
export function isVisibleAssetGuard(handler: unknown): boolean {
  return typeof handler === 'function' && (handler as unknown as Record<symbol, unknown>)[VISIBLE_ASSET_GUARD] === true;
}

/**
 * `requireVisibleAsset` — the by-id guard (`specs/166-asset-reference-visibility/`
 * research R-7, contracts/admin-api.md §1).
 *
 * Every route naming an asset by `:id` places it **after** its permission
 * gate: an asset the caller may not see answers exactly as a missing one
 * (status, code, message), before the handler reads a body or a multipart
 * stream — so a hidden asset's replace stages no bytes. The restricted owners
 * are asked whether or not the row exists, so a hidden id and a missing id
 * issue the same first reads. An id not in the canonical uuid spelling
 * answers not-found too, and the handler sees the id in lower case.
 * `routes.admin.guard.test.ts` fails a route that takes an asset id without it.
 */
function createRequireVisibleAsset(
  visibility: AdminRoutesDeps['visibility'],
): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const guard = async (req: FastifyRequest): Promise<void> => {
    const params = req.params as { id: string };
    // The handler reads the canonical id the guard checked, never the spelling
    // the caller sent: a non-canonical one has already answered not-found
    // (review T055, F-1).
    params.id = await visibility.assertVisible(params.id);
  };
  (guard as unknown as Record<symbol, unknown>)[VISIBLE_ASSET_GUARD] = true;
  return guard;
}

/**
 * One file per request (`limits.files: 1` on the multipart parser). A second
 * file part makes the part iterator throw `FST_FILES_LIMIT` **after** the first
 * file was already stored, so refusing then would report a write that happened
 * as one that did not. Once the first file is through, the extra part is
 * ignored and the answer reports what the first one did (block review I).
 */
function isExtraFilePart(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'FST_FILES_LIMIT';
}

export async function registerAssetsLibraryAdminRoutes(
  app: FastifyInstance,
  deps: AdminRoutesDeps,
): Promise<void> {
  const { service, folders, adapters, emFactory, requireAdmin } = deps;
  const requireVisibleAsset = createRequireVisibleAsset(deps.visibility);

  // — POST /assets (multipart upload) -----------------------------------------
  app.post(
    '/api/v1/admin/assets',
    { preHandler: requireAdmin('assets.write') },
    async (req: FastifyRequest, reply: FastifyReply) => {
      // Confirm we're handling a multipart request.
      if (!req.isMultipart()) {
        throw new HttpError(
          400,
          ERROR_CODES.ASSET_UPLOAD_NO_FILE,
          'Upload requires multipart/form-data with a `file` part.',
        );
      }

      // Collect non-file fields once; @fastify/multipart streams parts.
      let folderId: string | null = null;
      let label: string | null = null;
      let visibility: 'public' | 'private' = 'public';
      let asset: Awaited<ReturnType<typeof service.upload>> | null = null;

      try {
        for await (const part of req.parts()) {
          if (part.type === 'file') {
            if (asset) {
              // A later file part is ignored (see `isExtraFilePart`); drain it.
              part.file.resume();
              continue;
            }
            asset = await service.upload({
              filename: part.filename ?? 'unknown',
              declaredMime: part.mimetype ?? 'application/octet-stream',
              stream: part.file,
              // @fastify/multipart does not provide a guaranteed size.
              declaredSize: 0,
              folderId,
              label,
              visibility,
            });
          } else if (part.fieldname === 'folderId') {
            folderId = (part.value as string | null) || null;
          } else if (part.fieldname === 'label') {
            label = (part.value as string | null) || null;
          } else if (part.fieldname === 'visibility') {
            const v = part.value as string;
            if (v !== 'public' && v !== 'private') {
              throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, `visibility must be public|private; got "${v}".`);
            }
            visibility = v;
          }
        }
      } catch (err) {
        if (!(asset && isExtraFilePart(err))) throw err;
      }

      if (!asset) {
        throw new HttpError(
          400,
          ERROR_CODES.ASSET_UPLOAD_NO_FILE,
          'Multipart body did not include a `file` part.',
        );
      }
      reply.status(201);
      return { data: asset };
    },
  );

  // — POST /assets/:id/replace (multipart) — feature 156 ---------------------
  // Replace the file in place: same id, same storage key, same URLs. The
  // optional `expectedContentVersion` field is read before the file part
  // (specs/156-asset-stable-url/contracts/admin-api.md §2).
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/assets/:id/replace',
    { preHandler: [requireAdmin('assets.write'), requireVisibleAsset] },
    async (req, reply) => {
      if (!req.isMultipart()) {
        throw new HttpError(
          400,
          ERROR_CODES.ASSET_UPLOAD_NO_FILE,
          'Replace requires multipart/form-data with a `file` part.',
        );
      }
      let expectedContentVersion: string | undefined;
      let detail: Awaited<ReturnType<typeof service.replaceFromRoute>> | null = null;
      const parts = req.parts()[Symbol.asyncIterator]();
      // The parts after the file, read once its bytes are staged and before the
      // swap commits: a guard field there arrived too late to guard anything and
      // is refused; a second file part ends the request and is ignored.
      const readRest = async (): Promise<void> => {
        for (;;) {
          let next: IteratorResult<Multipart>;
          try {
            next = await parts.next();
          } catch (err) {
            if (isExtraFilePart(err)) return;
            throw err;
          }
          if (next.done) return;
          const part = next.value;
          if (part.type === 'file') {
            part.file.resume();
          } else if (part.fieldname === 'expectedContentVersion' && String(part.value ?? '').trim() !== '') {
            throw new HttpError(
              400,
              ERROR_CODES.VALIDATION_FAILED,
              'expectedContentVersion must be sent before the file part; it arrived after it, so nothing was replaced.',
            );
          }
        }
      };
      for (;;) {
        const next = await parts.next();
        if (next.done) break;
        const part = next.value;
        if (part.type === 'file') {
          detail = await service.replaceFromRoute({
            assetId: req.params.id,
            filename: part.filename ?? 'unknown',
            declaredMime: part.mimetype ?? 'application/octet-stream',
            stream: part.file,
            // @fastify/multipart does not provide a guaranteed size.
            declaredSize: 0,
            ...(expectedContentVersion !== undefined ? { expectedContentVersion } : {}),
            afterStaged: readRest,
          });
          break;
        } else if (part.fieldname === 'expectedContentVersion') {
          const value = String(part.value ?? '').trim();
          expectedContentVersion = value.length > 0 ? value : undefined;
        }
      }
      if (!detail) {
        throw new HttpError(
          400,
          ERROR_CODES.ASSET_UPLOAD_NO_FILE,
          'Multipart body did not include a `file` part.',
        );
      }
      reply.status(200);
      return { data: detail };
    },
  );

  // — POST /assets/:id/previous-version/restore — feature 156 ---------------
  // Both versions are required: the restore names the file it replaces and the
  // file it brings back (specs/156-asset-stable-url/contracts/admin-api.md §2).
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/assets/:id/previous-version/restore',
    { preHandler: [requireAdmin('assets.write'), requireVisibleAsset] },
    async (req) => {
      const body = restorePreviousAssetVersionRequestSchema.parse(req.body);
      const detail = await service.restorePreviousVersion({
        assetId: req.params.id,
        expectedContentVersion: body.expectedContentVersion,
        expectedPreviousContentVersion: body.expectedPreviousContentVersion,
      });
      return { data: detail };
    },
  );

  // — PUT / DELETE /assets/:id/permalink — feature 156 ------------------------
  // The shape is judged by `validateAssetPermalink` in the service, so the body
  // schema only bounds it (specs/156-asset-stable-url/contracts/admin-api.md §2).
  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/assets/:id/permalink',
    { preHandler: [requireAdmin('assets.write'), requireVisibleAsset] },
    async (req) => {
      const body = setAssetPermalinkRequestSchema.parse(req.body);
      const detail = await service.setPermalink(req.params.id, {
        permalink: body.permalink,
        ...(body.confirmReuse !== undefined ? { confirmReuse: body.confirmReuse } : {}),
      });
      return { data: detail };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/assets/:id/permalink',
    { preHandler: [requireAdmin('assets.write'), requireVisibleAsset] },
    async (req) => {
      const detail = await service.removePermalink(req.params.id);
      return { data: detail };
    },
  );

  // — GET /assets (paginated list) -------------------------------------------
  app.get(
    '/api/v1/admin/assets',
    {
      preHandler: requireAdmin('assets.read'),
    },
    async (req: FastifyRequest) => {
      const parsed = listAssetsQuerySchema.parse(req.query);
      const out = await service.listAssets({
        folderId: parsed.folderId ?? null,
        ...(parsed.q !== undefined ? { q: parsed.q } : {}),
        ...(parsed.mime !== undefined ? { mime: parsed.mime } : {}),
        ...(parsed.visibility !== undefined ? { visibility: parsed.visibility } : {}),
        includeDeleted: parsed.includeDeleted,
        ...(parsed.cursor !== undefined ? { cursor: parsed.cursor } : {}),
        limit: parsed.limit,
      });
      return out;
    },
  );

  // — GET /assets/:id --------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/assets/:id',
    { preHandler: [requireAdmin('assets.read'), requireVisibleAsset] },
    async (req) => {
      const detail = await service.getAsset(req.params.id);
      return { data: detail };
    },
  );

  // — GET /assets/:id/url ----------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/assets/:id/url',
    { preHandler: [requireAdmin('assets.read'), requireVisibleAsset] },
    async (req) => {
      const resolved = await service.resolveUrl(req.params.id);
      return {
        data: {
          url: resolved.url,
          expiresAt: resolved.expiresAt ? resolved.expiresAt.toISOString() : null,
        },
      };
    },
  );

  // — DELETE /assets/:id (soft-delete + reference protection) ---------------
  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/assets/:id',
    { preHandler: [requireAdmin('assets.write'), requireVisibleAsset] },
    async (req) => {
      const out = await service.softDelete(req.params.id);
      return {
        data: {
          deletedAt: out.deletedAt.toISOString(),
          purgeAfterAt: out.purgeAfterAt.toISOString(),
        },
      };
    },
  );

  // — POST /assets/:id/restore ----------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/assets/:id/restore',
    { preHandler: [requireAdmin('assets.write'), requireVisibleAsset] },
    async (req) => {
      const detail = await service.restore(req.params.id);
      return { data: detail };
    },
  );

  // — POST /assets/:id/move --------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/assets/:id/move',
    { preHandler: [requireAdmin('assets.write'), requireVisibleAsset] },
    async (req) => {
      const body = moveAssetRequestSchema.parse(req.body);
      const detail = await service.move(req.params.id, body.folderId ?? null);
      return { data: detail };
    },
  );

  // — POST /assets/move-many -------------------------------------------------
  app.post(
    '/api/v1/admin/assets/move-many',
    { preHandler: requireAdmin('assets.write') },
    async (req: FastifyRequest) => {
      const body = moveManyAssetsRequestSchema.parse(req.body);
      const out = await service.moveMany(body.assetIds, body.folderId ?? null);
      return { data: out };
    },
  );

  // — Storage administration -------------------------------------------------
  app.post(
    '/api/v1/admin/assets/storage/self-check',
    { preHandler: requireAdmin('assets.write') },
    async () => {
      const adapter = await adapters.getActive();
      const result = await adapter.selfCheck();
      return {
        data: { adapter: adapter.code, ...result },
      };
    },
  );

  app.get(
    '/api/v1/admin/assets/storage/state',
    { preHandler: requireAdmin('assets.read') },
    async () => {
      const adapter = await adapters.getActive().catch((err) => {
        return {
          code: 'local' as const,
          // Surface the misconfig as a not-ok self-check rather than 500.
          async selfCheck(): Promise<{ ok: false; reason: string }> {
            return { ok: false, reason: err instanceof Error ? err.message : String(err) };
          },
        };
      });
      const result = await adapter.selfCheck();
      const em = emFactory();
      const pendingCleanupCount = await em.count(Asset, { pendingCleanup: true });
      const softDeletedCount = await em.count(Asset, { deletedAt: { $ne: null } });
      return {
        data: {
          activeAdapter: adapter.code,
          selfCheck: result,
          pendingCleanupCount,
          softDeletedCount,
        },
      };
    },
  );

  // — Folders ----------------------------------------------------------------
  app.get(
    '/api/v1/admin/assets/folders',
    { preHandler: requireAdmin('assets.read') },
    async () => ({ data: await folders.listFolderTree() }),
  );

  app.post(
    '/api/v1/admin/assets/folders',
    { preHandler: requireAdmin('assets.write') },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = createFolderRequestSchema.parse(req.body);
      const f = await folders.createFolder(body);
      reply.status(201);
      return { data: f };
    },
  );

  app.patch<{ Params: { folderId: string } }>(
    '/api/v1/admin/assets/folders/:folderId',
    { preHandler: requireAdmin('assets.write') },
    async (req) => {
      const body = patchFolderRequestSchema.parse(req.body);
      const f = await folders.patchFolder(req.params.folderId, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
      });
      return { data: f };
    },
  );

  // Feature 156, owner ruling S4: named by the folder delete confirmation.
  app.get<{ Params: { folderId: string } }>(
    '/api/v1/admin/assets/folders/:folderId/permalink-count',
    { preHandler: requireAdmin('assets.read') },
    async (req) => ({
      data: { permalinkedAssets: await folders.countPermalinkedAssets(req.params.folderId) },
    }),
  );

  app.delete<{ Params: { folderId: string } }>(
    '/api/v1/admin/assets/folders/:folderId',
    { preHandler: requireAdmin('assets.write') },
    async (req) => {
      const body = deleteFolderRequestSchema.parse(req.body ?? {});
      const out = await folders.deleteFolder(req.params.folderId, body.ifNonEmpty);
      return { data: out };
    },
  );

  // — PATCH /assets/:id ------------------------------------------------------
  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/assets/:id',
    { preHandler: [requireAdmin('assets.write'), requireVisibleAsset] },
    async (req) => {
      const patch = patchAssetRequestSchema.parse(req.body);
      const detail = await service.patchAsset(req.params.id, {
        ...(patch.filename !== undefined ? { filename: patch.filename } : {}),
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.mimeType !== undefined ? { mimeType: patch.mimeType } : {}),
        ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
        ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
      });
      return { data: detail };
    },
  );
}
