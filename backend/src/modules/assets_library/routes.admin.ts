// Admin HTTP surface for the Assets Library — feature 013 / US1.
// Mounts under /api/v1/admin/assets/*.
//
// Routes implemented in this phase (US1):
//   POST   /api/v1/admin/assets             — multipart upload
//   GET    /api/v1/admin/assets             — list (folder filter + pagination)
//   GET    /api/v1/admin/assets/:id         — detail with references
//   GET    /api/v1/admin/assets/:id/url     — re-resolve URL on demand
//   PATCH  /api/v1/admin/assets/:id         — edit metadata + visibility flip
//
// Folder CRUD, soft-delete, restore, bulk move, and storage self-check
// land in subsequent user stories.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
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
} from '@endora-commerce/contracts';

import { HttpError } from '../../http/error-envelope.js';
import { Asset } from './entities/asset.entity.js';
import type { AssetsLibraryService } from './services/assets-library.service.js';
import type { FoldersService } from './services/folders.service.js';
import type { AdapterRegistry } from './services/storage/adapter-registry.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export interface AdminRoutesDeps {
  service: AssetsLibraryService;
  folders: FoldersService;
  adapters: AdapterRegistry;
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
}

export async function registerAssetsLibraryAdminRoutes(
  app: FastifyInstance,
  deps: AdminRoutesDeps,
): Promise<void> {
  const { service, folders, adapters, emFactory, requireAdmin } = deps;

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

      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (asset) {
            throw new HttpError(
              400,
              ERROR_CODES.ASSET_UPLOAD_NO_FILE,
              'Only one file per request is allowed.',
            );
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
    { preHandler: requireAdmin('assets.read') },
    async (req) => {
      const detail = await service.getAsset(req.params.id);
      return { data: detail };
    },
  );

  // — GET /assets/:id/url ----------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/assets/:id/url',
    { preHandler: requireAdmin('assets.read') },
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
    { preHandler: requireAdmin('assets.write') },
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
    { preHandler: requireAdmin('assets.write') },
    async (req) => {
      const detail = await service.restore(req.params.id);
      return { data: detail };
    },
  );

  // — POST /assets/:id/move --------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/assets/:id/move',
    { preHandler: requireAdmin('assets.write') },
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
    { preHandler: requireAdmin('assets.write') },
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
