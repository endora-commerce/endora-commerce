// Public file-serving route for the Assets Library — feature 013 / US1.
// Used by the storefront for assets stored on the local-FS adapter.
// Cloud adapters (S3 / GCS) bypass this route entirely — their public URLs
// point at the bucket directly and their private URLs are signed by the
// vendor SDK; the storefront fetches them without touching this code path.
//
// Behaviour:
//   public assets  → no auth, long Cache-Control
//   private assets → require valid HMAC token (?token=&exp=)
//   soft-deleted   → 410 ASSET_GONE (so still-live storefront caches degrade gracefully)
//   missing file   → 404 ASSET_FILE_MISSING

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';

import { HttpError } from '../../http/error-envelope.js';
import { Asset } from './entities/asset.entity.js';
import { LocalFsStorageAdapter } from './services/storage/local-fs-adapter.js';
import type { AdapterRegistry } from './services/storage/adapter-registry.js';
import type { AssetsLibraryService } from './services/assets-library.service.js';
import type { HmacSigner } from './services/hmac.js';

export interface PublicRoutesDeps {
  service: AssetsLibraryService;
  adapters: AdapterRegistry;
  emFactory: () => EntityManager;
  /** Provider so tests that never serve files don't pay env-var cost. */
  signer: () => HmacSigner;
}

export async function registerAssetsLibraryPublicRoutes(
  app: FastifyInstance,
  deps: PublicRoutesDeps,
): Promise<void> {
  app.get<{
    Params: { assetId: string };
    Querystring: { token?: string; exp?: string; download?: string };
  }>(
    '/assets/file/:assetId',
    async (req, reply: FastifyReply) => {
      const em = deps.emFactory();
      const a = await em.findOne(Asset, { id: req.params.assetId });
      if (!a) {
        throw new HttpError(404, ERROR_CODES.ASSET_NOT_FOUND, 'Asset not found.');
      }
      if (a.deletedAt) {
        throw new HttpError(410, ERROR_CODES.ASSET_GONE, 'Asset has been deleted.');
      }

      // This route only serves bytes from the local-FS adapter. Cloud
      // assets are always reached via the bucket URL or signed URL — they
      // never hit this endpoint.
      if (a.storageBackend !== 'local') {
        // Redirect to the resolved URL so a misconfigured client falls back
        // to the canonical serving path.
        const resolved = await deps.service.resolveUrl(a.id);
        reply.redirect(resolved.url, 302);
        return;
      }

      // Visibility / token check.
      if (a.visibility === 'private') {
        const signer = deps.signer();
        const exp = Number(req.query.exp);
        const token = String(req.query.token ?? '');
        const ok = signer.verify({
          assetId: a.id,
          token,
          exp,
          nowSec: Math.floor(Date.now() / 1000),
        });
        if (!ok) {
          throw new HttpError(403, ERROR_CODES.ASSET_ACCESS_DENIED, 'Access denied.');
        }
      }

      const adapter = await deps.adapters.getForBackend('local');
      if (!(adapter instanceof LocalFsStorageAdapter)) {
        throw new HttpError(
          500,
          ERROR_CODES.INTERNAL,
          'Local-FS adapter is not currently active.',
        );
      }

      // ETag / 304 short-circuit.
      const etag = `"${a.id}-${Math.floor(a.updatedAt.getTime() / 1000)}"`;
      const ifNoneMatch = req.headers['if-none-match'];
      if (typeof ifNoneMatch === 'string' && ifNoneMatch === etag) {
        return reply.status(304).send();
      }

      // Stream open. open() throws on missing file → 404 ASSET_FILE_MISSING.
      let stream;
      try {
        stream = await adapter.open({ locator: a.storageLocator || a.storageUrl });
      } catch {
        throw new HttpError(404, ERROR_CODES.ASSET_FILE_MISSING, 'Underlying file is missing.');
      }

      // Standard headers.
      reply.header('Content-Type', a.mimeType);
      // sizeBytes is mapped as bigint at the DB layer; coerce to string for
      // the Content-Length header (Node's HTTP layer rejects bigint values).
      // Only set it when the recorded size is meaningful — a stale/legacy `0`
      // (uploads that never captured a byte count) would otherwise tell the
      // browser the body is empty and produce a broken/blank image. Omitting
      // the header lets Fastify stream the file to EOF.
      if (Number(a.sizeBytes) > 0) {
        reply.header('Content-Length', String(a.sizeBytes));
      }
      reply.header('ETag', etag);
      reply.header(
        'Cache-Control',
        a.visibility === 'public'
          ? 'public, max-age=31536000, immutable'
          : 'private, no-store, max-age=0',
      );
      // Public assets are embedded by the storefront and admin, which run on a
      // different origin than the backend. Helmet's default
      // `Cross-Origin-Resource-Policy: same-origin` would block those
      // cross-origin <img> loads, so relax it to `cross-origin` for public
      // assets (private assets keep the stricter default).
      if (a.visibility === 'public') {
        reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      }
      const dispoMode = req.query.download === '1' ? 'attachment' : 'inline';
      const safeName = a.filename.replace(/[\r\n";]/g, '_');
      reply.header('Content-Disposition', `${dispoMode}; filename="${safeName}"`);
      // Fastify will pipe a Readable through to the response.
      return reply.send(stream);
    },
  );
}
