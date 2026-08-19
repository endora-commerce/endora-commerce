import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  ERROR_CODES,
  comparisonAddProductInputSchema,
  comparisonSetDisplayModeInputSchema,
} from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { productAudienceOf } from '../../http/product-audience.js';
import { getResolvedChannel } from '../../kernel/sales-channels/sales-channel-resolver.middleware.js';
import {
  ComparisonFullError,
  ComparisonNotFoundError,
  ProductNotFoundError,
  ProductNotInComparisonError,
  type ComparisonOwner,
  type ComparisonService,
} from './services/comparison-service.js';
import type { ComparisonPdfRenderer } from './services/comparison-pdf-renderer.js';
import {
  COMPARE_TOKEN_COOKIE,
  readAnonymousToken,
  writeAnonymousToken,
} from './services/anonymous-token-cookie.js';
import type { ShareTokenGenerator } from './services/share-token-generator.js';
import type { Comparison } from './entities/comparison.entity.js';

/**
 * Public HTTP surface — feature 007 / US1 (T027).
 *
 * Routes mounted under `/api/v1/comparisons/me*` (project convention is
 * `/api/v1/<module>/<resource>`; the contract README's `/public/`
 * prefix follows spec wording but the codebase strips it — same as
 * `catalog`, `search`, `sales_channels`).
 *
 *   - GET    /me                        — read; 204 when none exists
 *   - POST   /me/products               — add (creates on first call,
 *                                         mints `compare_token` cookie)
 *   - DELETE /me/products/:productId    — remove
 *   - PATCH  /me                        — update display mode
 *   - DELETE /me                        — hard-delete the comparison
 *
 * Owner resolution: authenticated customer wins over anonymous cookie.
 * On a write where neither is present, a fresh anonymous token is
 * minted and the `compare_token` cookie is set on the response (R-2).
 */

export interface ComparisonsPublicDeps {
  comparisonService: ComparisonService;
  tokens: ShareTokenGenerator;
  /** Optional — when omitted, `GET /me/pdf` is not mounted (foundation tests). */
  pdfRenderer?: ComparisonPdfRenderer;
}

export async function registerComparisonsPublicRoutes(
  app: FastifyInstance,
  deps: ComparisonsPublicDeps,
): Promise<void> {
  const { comparisonService, tokens, pdfRenderer } = deps;

  // -----------------------------------------------------------------
  // GET /me — read
  // -----------------------------------------------------------------

  app.get('/api/v1/comparisons/me', async (request, reply) => {
    const owner = readOwner(request);
    if (!owner) {
      reply.code(204);
      return null;
    }
    const comparison = await comparisonService.getForOwner(owner);
    if (!comparison) {
      reply.code(204);
      return null;
    }
    const channel = getResolvedChannel(request);
    reply.header('cache-control', 'no-store');
    return { data: await comparisonService.buildOwnerView(comparison, channel.id) };
  });

  // -----------------------------------------------------------------
  // POST /me/products — add (creates on first call)
  // -----------------------------------------------------------------

  app.post('/api/v1/comparisons/me/products', async (request, reply) => {
    const body = parse(comparisonAddProductInputSchema, request.body);
    const owner = ensureOwner(request, reply, tokens);
    const channel = getResolvedChannel(request);
    let comparison: Comparison;
    try {
      comparison = await comparisonService.addProduct(
        owner,
        channel.id,
        body.productId,
        productAudienceOf(request),
      );
    } catch (err) {
      throw translate(err);
    }
    reply.header('cache-control', 'no-store');
    return { data: await comparisonService.buildOwnerView(comparison, channel.id) };
  });

  // -----------------------------------------------------------------
  // DELETE /me/products/:productId — remove
  // -----------------------------------------------------------------

  app.delete<{ Params: { productId: string } }>(
    '/api/v1/comparisons/me/products/:productId',
    async (request, reply) => {
      const owner = readOwner(request);
      if (!owner) throw notFoundComparison();
      let comparison: Comparison;
      try {
        comparison = await comparisonService.removeProduct(
          owner,
          request.params.productId,
        );
      } catch (err) {
        throw translate(err);
      }
      const channel = getResolvedChannel(request);
      reply.header('cache-control', 'no-store');
      return { data: await comparisonService.buildOwnerView(comparison, channel.id) };
    },
  );

  // -----------------------------------------------------------------
  // PATCH /me — set display mode
  // -----------------------------------------------------------------

  app.patch('/api/v1/comparisons/me', async (request, reply) => {
    const body = parse(comparisonSetDisplayModeInputSchema, request.body);
    const owner = readOwner(request);
    if (!owner) throw notFoundComparison();
    let comparison: Comparison;
    try {
      comparison = await comparisonService.setDisplayMode(owner, body.displayMode);
    } catch (err) {
      throw translate(err);
    }
    const channel = getResolvedChannel(request);
    reply.header('cache-control', 'no-store');
    return { data: await comparisonService.buildOwnerView(comparison, channel.id) };
  });

  // -----------------------------------------------------------------
  // GET /me/pdf — owner-only export (US4)
  // -----------------------------------------------------------------

  if (pdfRenderer) {
    app.get('/api/v1/comparisons/me/pdf', { config: { streamingResponse: true } }, async (request, reply) => {
      const owner = readOwner(request);
      if (!owner) throw notFoundComparison();
      const comparison = await comparisonService.getForOwner(owner);
      if (!comparison) throw notFoundComparison();
      const channel = getResolvedChannel(request);
      const view = await comparisonService.buildOwnerView(comparison, channel.id);
      if (view.products.length === 0) {
        throw new HttpError(
          409,
          ERROR_CODES.COMPARISON_EMPTY,
          'Cannot export an empty comparison.',
        );
      }
      let bytes: Buffer;
      try {
        bytes = await pdfRenderer.render(view);
      } catch {
        throw new HttpError(
          503,
          ERROR_CODES.PDF_GENERATION_FAILED,
          'PDF generation failed.',
        );
      }
      const shortToken = comparison.shareToken.slice(0, 8);
      reply.header('content-type', 'application/pdf');
      reply.header(
        'content-disposition',
        `attachment; filename="comparison-${shortToken}.pdf"`,
      );
      reply.header('cache-control', 'no-store');
      return reply.send(bytes);
    });
  }

  // -----------------------------------------------------------------
  // DELETE /me — hard-delete
  // -----------------------------------------------------------------

  app.delete('/api/v1/comparisons/me', async (request, reply) => {
    const owner = readOwner(request);
    if (!owner) throw notFoundComparison();
    try {
      await comparisonService.deleteForOwner(owner);
    } catch (err) {
      throw translate(err);
    }
    reply.code(204);
    reply.header('cache-control', 'no-store');
    return null;
  });
}

// ---------------------------------------------------------------------------
// Owner resolution
// ---------------------------------------------------------------------------

/**
 * Read the caller's owner identity for a *read* path. Returns null when
 * the caller is anonymous and has no `compare_token` cookie. Read paths
 * never mint a fresh cookie — only writes do.
 */
function readOwner(request: FastifyRequest): ComparisonOwner | null {
  if (request.actor.kind === 'customer') {
    return {
      kind: 'customer',
      customerAccountId: request.actor.customerAccountId,
    };
  }
  const token = readAnonymousToken(request);
  if (token) return { kind: 'anonymous', anonymousToken: token };
  return null;
}

/**
 * Same as readOwner, but for *write* paths: when no identity is present,
 * mint a fresh anonymous token and set the `compare_token` cookie on the
 * response. Returns the owner for the just-minted identity so the
 * service can attach it to the new Comparison row.
 */
function ensureOwner(
  request: FastifyRequest,
  reply: FastifyReply,
  tokens: ShareTokenGenerator,
): ComparisonOwner {
  const existing = readOwner(request);
  if (existing) return existing;
  const token = tokens.generate();
  writeAnonymousToken(reply, token);
  return { kind: 'anonymous', anonymousToken: token };
}

// ---------------------------------------------------------------------------
// Error envelope translation
// ---------------------------------------------------------------------------

function translate(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof ComparisonFullError) {
    return new HttpError(409, ERROR_CODES.COMPARISON_FULL, err.message);
  }
  if (err instanceof ComparisonNotFoundError) {
    return notFoundComparison();
  }
  if (err instanceof ProductNotFoundError) {
    return new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, err.message);
  }
  if (err instanceof ProductNotInComparisonError) {
    return new HttpError(
      404,
      ERROR_CODES.PRODUCT_NOT_IN_COMPARISON,
      err.message,
    );
  }
  if (err instanceof Error) {
    return new HttpError(500, ERROR_CODES.INTERNAL, err.message);
  }
  return new HttpError(500, ERROR_CODES.INTERNAL, 'Unexpected error.');
}

function notFoundComparison(): HttpError {
  return new HttpError(
    404,
    ERROR_CODES.COMPARISON_NOT_FOUND,
    'Comparison not found.',
  );
}

// ---------------------------------------------------------------------------
// Tiny zod-parse helper that turns Zod errors into 422 with the project's
// error envelope.
// ---------------------------------------------------------------------------

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new HttpError(
      422,
      ERROR_CODES.VALIDATION_FAILED,
      'Validation failed.',
      parsed.error.issues.map((i) => ({
        path: i.path.map(String).join('.'),
        issue: i.message,
      })),
    );
  }
  return parsed.data;
}

// Re-export the cookie name so test-server / docs can reference it.
export { COMPARE_TOKEN_COOKIE };
