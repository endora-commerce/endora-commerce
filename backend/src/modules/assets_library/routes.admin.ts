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
import {
  ERROR_CODES,
  patchAssetRequestSchema,
  listAssetsQuerySchema,
} from '@b2b/contracts';

import { HttpError } from '../../http/error-envelope.js';
import type { AssetsLibraryService } from './services/assets-library.service.js';
import type { RequireAdminFactory } from './plugin.js';

export interface AdminRoutesDeps {
  service: AssetsLibraryService;
  requireAdmin: RequireAdminFactory;
}

export async function registerAssetsLibraryAdminRoutes(
  app: FastifyInstance,
  deps: AdminRoutesDeps,
): Promise<void> {
  const { service, requireAdmin } = deps;

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
