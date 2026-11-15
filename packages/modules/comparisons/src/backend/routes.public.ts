import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ERROR_CODES,
  type CustomerAccountReadPort,
  type DocumentRenderInput,
  type DocumentRenderResult,
  type OrganizationDetailsPort,
  comparisonAddProductInputSchema,
  comparisonSetDisplayModeInputSchema,
  requestScopeLanguage,
  storefrontPagePathFor,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { productAudienceOf } from '@endora-commerce/platform/http';
import {
  getResolvedChannel,
  rethrowIfModuleDisabled,
  SettingNotRegistered,
  SettingOutOfScopeForChannel,
  type SettingsReadPort,
} from '@endora-commerce/platform/kernel';
import { buildComparisonDocumentData } from './document/comparison-document-data.js';
import { COMPARISON_DOCUMENT_TYPE } from './document/comparison-document-type.js';
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
import { customerActor } from './request-actor.js';
import { buyerViewerOf, languageTagOf } from './buyer-viewer.js';

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
  /**
   * `specs/152-compare-pdf-template/` — the document-template path of the
   * export. Absent, or `isPresent()` false: the fixed layout (R-11).
   */
  documentTemplates?: {
    isPresent(): boolean;
    render(input: DocumentRenderInput): Promise<DocumentRenderResult>;
  };
  /** What the template path reads to fill its merge fields and share link. */
  documentContext?: {
    customerAccounts: Pick<CustomerAccountReadPort, 'findById'>;
    organizations: Pick<OrganizationDetailsPort, 'findById'>;
    settings: SettingsReadPort;
  };
}

/** `?hideEmptyRows=` — the storefront's *Hide empty rows* switch (FR-020). */
const pdfQuerySchema = z.object({
  hideEmptyRows: z.enum(['true', 'false']).optional(),
});

/**
 * The PDF's language (FR-032, owner Q7): the channel content language the whole
 * `Accept-Language` header asks for, through `requestScopeLanguage` — the tags in
 * descending `q`, each matched against the channel's languages (exactly, then by base
 * language), the first one the channel offers winning, else the channel's default.
 *
 * Issue #1011 — a content language, not a message-bundle one
 * (`request.responseLanguage()`): it picks the template's language, the channel's name and
 * the share page's language prefix, all of which exist per channel language, and it has to
 * agree with the language the comparison view's product names were read in
 * (`buyerViewerOf`). It used to strip `;q` without sorting by it, so `en;q=0.2, pl;q=0.9`
 * exported an English PDF.
 */
export function pickExportLanguage(
  acceptLanguage: string | readonly string[] | undefined,
  channel: { id: string; defaultLanguage: string; languages?: readonly string[] },
): string {
  return requestScopeLanguage(channel, acceptLanguage);
}

async function storefrontUrlOf(settings: SettingsReadPort, channelId: string): Promise<string | null> {
  try {
    return await settings.get('sales_channels.storefront_url', channelId, z.string());
  } catch (error) {
    // The two conditions that mean "not configured here", and no others.
    if (error instanceof SettingNotRegistered || error instanceof SettingOutOfScopeForChannel) return null;
    throw error;
  }
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
    return {
      data: await comparisonService.buildOwnerView(
        comparison,
        channel.id,
        buyerViewerOf(request),
        // Owner decision CMP-1 = A — `/me` is the owner's own comparison.
        'owner',
      ),
    };
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
        languageTagOf(request),
      );
    } catch (err) {
      throw translate(err);
    }
    reply.header('cache-control', 'no-store');
    return {
      data: await comparisonService.buildOwnerView(
        comparison,
        channel.id,
        buyerViewerOf(request),
        // Owner decision CMP-1 = A — `/me` is the owner's own comparison.
        'owner',
      ),
    };
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
      return {
        data: await comparisonService.buildOwnerView(
          comparison,
          channel.id,
          buyerViewerOf(request),
          // Owner decision CMP-1 = A — `/me` is the owner's own comparison.
          'owner',
        ),
      };
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
    return {
      data: await comparisonService.buildOwnerView(
        comparison,
        channel.id,
        buyerViewerOf(request),
        // Owner decision CMP-1 = A — `/me` is the owner's own comparison.
        'owner',
      ),
    };
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
      const view = await comparisonService.buildOwnerView(
        comparison,
        channel.id,
        buyerViewerOf(request),
        // Owner decision CMP-1 = A — `/me` is the owner's own comparison.
        'owner',
      );
      if (view.products.length === 0) {
        throw new HttpError(
          409,
          ERROR_CODES.COMPARISON_EMPTY,
          'Cannot export an empty comparison.',
        );
      }
      const { hideEmptyRows } = pdfQuerySchema.parse(request.query ?? {});
      const templates = deps.documentTemplates;
      let bytes: Buffer | Uint8Array;
      if (templates && deps.documentContext && templates.isPresent()) {
        // The template path (FR-030). Presence is asked before the port is
        // resolved, and the only `catch` re-throws a switched-off module first.
        const language = pickExportLanguage(request.headers['accept-language'], channel);
        const context = deps.documentContext;
        const customer = customerActor(request);
        const account = customer ? await context.customerAccounts.findById(customer.customerAccountId) : null;
        const organization = account ? await context.organizations.findById(account.organizationId) : null;
        const data = buildComparisonDocumentData({
          view,
          channelName: channel.name[language] ?? channel.name['en-US'] ?? Object.values(channel.name)[0] ?? channel.code,
          customerName: account ? `${account.firstName} ${account.lastName}`.trim() || account.email : null,
          organizationName: organization?.name ?? null,
          storefrontUrl: await storefrontUrlOf(context.settings, channel.id),
          // Feature 167 — the share page in the document's language.
          pagePath: (path) => storefrontPagePathFor({ path, channel, requestedLanguage: language }),
          hideEmptyRows: hideEmptyRows === 'true',
          now: new Date(),
        });
        try {
          const result = await templates.render({
            documentType: COMPARISON_DOCUMENT_TYPE,
            salesChannelId: channel.id,
            language,
            data,
          });
          bytes = result.bytes;
          reply.header('content-language', result.language);
        } catch (error) {
          rethrowIfModuleDisabled(error);
          request.log.error({ err: error, comparisonId: comparison.id }, 'comparison PDF template render failed');
          throw new HttpError(503, ERROR_CODES.PDF_GENERATION_FAILED, 'PDF generation failed.');
        }
      } else {
        try {
          bytes = await pdfRenderer.render(view);
        } catch {
          throw new HttpError(
            503,
            ERROR_CODES.PDF_GENERATION_FAILED,
            'PDF generation failed.',
          );
        }
      }
      const shortToken = comparison.shareToken.slice(0, 8);
      reply.header('content-type', 'application/pdf');
      reply.header(
        'content-disposition',
        `attachment; filename="comparison-${shortToken}.pdf"`,
      );
      reply.header('cache-control', 'no-store');
      return reply.send(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
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
  const customer = customerActor(request);
  if (customer !== null) {
    return {
      kind: 'customer',
      customerAccountId: customer.customerAccountId,
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
