// Public file-serving route for the Assets Library — feature 013, reworked by
// feature 156 (specs/156-asset-stable-url/ contracts/file-serving.md, research
// R-9 – R-12a, owner ruling P2).
//
// Identifier forms:
//   /assets/file/<asset id>             — the stable file URL
//   /assets/file/<permalink, 1+ segments> — an operator-chosen alias, matched
//                                           case-insensitively
//
// What it answers is decided by `services/file-response.ts`; in short:
//   private assets  → a valid HMAC signature (?token=&exp=) is checked first, on
//                     every backend: without one, 404 by id and by permalink,
//                     identical to an identifier that resolves to nothing (#542)
//   soft-deleted    → 410 ASSET_GONE (after the signature check)
//   cloud assets    → a `no-store` redirect: to the time-limited URL when
//                     private (signed with the stored type and the policy's
//                     disposition, #815), to the stable bucket URL when public
//   local, public   → bare URL `public, no-cache`; `?v=<current>` immutable for a
//                     year; a stale `v` redirects to the current one
//   every response  → `X-Content-Type-Options: nosniff` and a restrictive
//                     Content-Security-Policy; only displayable media is served
//                     `inline`; every answer that is not the file is `no-store`
//   missing file    → 404 ASSET_FILE_MISSING

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, isAssetIdShaped, validateAssetPermalink } from '@endora-commerce/contracts';

import { HttpError } from '@endora-commerce/platform/http';
import { Asset } from './entities/asset.entity.js';
import { LocalFsStorageAdapter } from './services/storage/local-fs-adapter.js';
import type { AdapterRegistry } from './services/storage/adapter-registry.js';
import type { AssetsLibraryService } from './services/assets-library.service.js';
import type { HmacSigner } from './services/hmac.js';
import { SANDBOX_CSP } from './services/content-policy.js';
import {
  decideFileResponse,
  type FileDecision,
  type IdentifierForm,
} from './services/file-response.js';

export interface PublicRoutesDeps {
  service: AssetsLibraryService;
  adapters: AdapterRegistry;
  emFactory: () => EntityManager;
  /** Provider so tests that never serve files don't pay env-var cost. */
  signer: () => HmacSigner;
}

type FileQuery = { token?: string; exp?: string; download?: string; v?: string };

function applyHeaders(reply: FastifyReply, decision: FileDecision): void {
  for (const [name, value] of Object.entries(decision.headers)) reply.header(name, value);
}

export async function registerAssetsLibraryPublicRoutes(
  app: FastifyInstance,
  deps: PublicRoutesDeps,
): Promise<void> {
  /** The asset an identifier names: an id when it has an id's shape, a permalink otherwise. */
  async function resolve(identifier: string): Promise<{ row: Asset | null; form: IdentifierForm }> {
    const em = deps.emFactory();
    if (isAssetIdShaped(identifier)) {
      return { row: await em.findOne(Asset, { id: identifier }), form: 'id' };
    }
    // Every stored permalink passed this rule, so a name that fails it — a NUL
    // byte Postgres would refuse, characters outside the class, more than 200
    // characters — names nothing: answer the unused name's 404 without a query.
    if (!validateAssetPermalink(identifier).ok) return { row: null, form: 'permalink' };
    const hits = await em.execute<Array<{ id: string }>>(
      'select id::text as id from assets where lower(permalink) = lower(?) limit 1',
      [identifier],
    );
    const id = hits[0]?.id;
    return { row: id ? await em.findOne(Asset, { id }) : null, form: 'permalink' };
  }

  async function serveFile(
    identifier: string,
    req: FastifyRequest<{ Querystring: FileQuery }>,
    reply: FastifyReply,
  ): Promise<unknown> {
    const { row, form } = await resolve(identifier);
    const query = req.query ?? {};
    let signatureValid = false;
    if (row && row.visibility === 'private') {
      signatureValid = deps.signer().verify({
        assetId: row.id,
        token: String(query.token ?? ''),
        exp: Number(query.exp),
        nowSec: Math.floor(Date.now() / 1000),
      });
    }
    const ifNoneMatch = req.headers['if-none-match'];
    const decision = decideFileResponse({
      row,
      form,
      query: {
        ...(query.token !== undefined ? { token: String(query.token) } : {}),
        ...(query.exp !== undefined ? { exp: String(query.exp) } : {}),
        ...(query.download !== undefined ? { download: String(query.download) } : {}),
        ...(query.v !== undefined ? { v: String(query.v) } : {}),
      },
      ...(typeof ifNoneMatch === 'string' ? { ifNoneMatch } : {}),
      signatureValid,
    });

    applyHeaders(reply, decision);
    switch (decision.status) {
      case 404:
      case 410:
        // The headers are on the reply already; the error envelope keeps them.
        throw new HttpError(decision.status, decision.body.code, decision.body.message);
      case 302: {
        const target = decision.location;
        let url: string;
        if (target.kind === 'url') {
          url = target.url;
        } else if (target.kind === 'private-signed') {
          url = (await deps.service.resolveUrl((row as Asset).id, { download: target.download })).url;
        } else {
          const asset = row as Asset;
          const adapter = await deps.adapters.getForBackend(asset.storageBackend);
          const stable = await adapter.resolveUrl({
            locator: asset.storageLocator || asset.storageUrl,
            visibility: 'public',
          });
          url = target.version !== undefined
            ? `${stable.url}${stable.url.includes('?') ? '&' : '?'}v=${encodeURIComponent(target.version)}`
            : stable.url;
        }
        return reply.redirect(url, 302);
      }
      case 304:
        return reply.status(304).send();
      case 200: {
        const asset = row as Asset;
        const adapter = await deps.adapters.getForBackend('local');
        if (!(adapter instanceof LocalFsStorageAdapter)) {
          throw new HttpError(500, ERROR_CODES.INTERNAL, 'Local-FS adapter is not currently active.');
        }
        let stream;
        try {
          stream = await adapter.open({ locator: asset.storageLocator || asset.storageUrl });
        } catch {
          reply.header('Content-Security-Policy', SANDBOX_CSP);
          reply.header('Cache-Control', 'no-store');
          reply.removeHeader('Content-Disposition');
          reply.removeHeader('Content-Length');
          reply.removeHeader('ETag');
          throw new HttpError(404, ERROR_CODES.ASSET_FILE_MISSING, 'Underlying file is missing.');
        }
        return reply.send(stream);
      }
    }
  }

  // One segment: an asset id or a one-segment permalink.
  app.get<{ Params: { assetId: string }; Querystring: FileQuery }>(
    '/assets/file/:assetId',
    { config: { streamingResponse: true } },
    async (req, reply) => serveFile(req.params.assetId, req, reply),
  );

  // Two or more segments: a permalink only.
  app.get<{ Params: { '*': string }; Querystring: FileQuery }>(
    '/assets/file/*',
    { config: { streamingResponse: true } },
    async (req, reply) => serveFile(req.params['*'], req, reply),
  );
}
