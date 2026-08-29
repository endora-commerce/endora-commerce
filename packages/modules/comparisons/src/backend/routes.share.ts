import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { productAudienceOf } from '@endora-commerce/platform/http';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
import type { ComparisonOwner, ComparisonService } from './services/comparison-service.js';
import { readAnonymousToken } from './services/anonymous-token-cookie.js';
import { customerActor } from './request-actor.js';

/**
 * Public share-token endpoint — feature 007 / US2 / T040.
 *
 *   GET /api/v1/comparisons/share/:token
 *
 * Resolves the share token in O(1) via the UNIQUE index, projects the
 * comparison through the **recipient's** sales-channel context (so
 * prices and availability reflect the recipient's channel, not the
 * creator's — per data-model.md §3.2), and returns a typed response
 * with `meta.viewerIsOwner` so the storefront knows whether to render
 * owner-only affordances. No mutation surface; no auth.
 *
 * The recipient's **identity** decides the prices for the same reason their
 * channel does, and one step further: a signed-in recipient from another
 * organisation is quoted their own negotiated figures, an anonymous one the
 * channel's. The token names the products; it never carries the sender's
 * pricing identity, so a link cannot disclose what the sender pays. The view
 * says which of the two it is in `data.pricedFor`, because a reader who cannot
 * tell whose prices these are cannot act on either.
 */

export interface ComparisonsShareDeps {
  comparisonService: ComparisonService;
}

export async function registerComparisonsShareRoutes(
  app: FastifyInstance,
  deps: ComparisonsShareDeps,
): Promise<void> {
  const { comparisonService } = deps;

  app.get<{ Params: { token: string } }>(
    '/api/v1/comparisons/share/:token',
    async (request, reply) => {
      const token = request.params.token;
      if (!token || token.length < 8 || token.length > 32) {
        throw notFound();
      }
      const comparison = await comparisonService.findByShareToken(token);
      if (!comparison) throw notFound();
      const channel = getResolvedChannel(request);
      const view = await comparisonService.buildOwnerView(
        comparison,
        channel.id,
        { kind: 'buyer', audience: productAudienceOf(request) },
      );
      const viewerIsOwner = comparisonService.isOwnedBy(
        comparison,
        viewerIdentity(request),
      );
      reply.header('cache-control', 'no-store');
      // Strip `maxProducts` from the wire shape — the cap is irrelevant
      // to the recipient (they cannot mutate the comparison).
      const { maxProducts: _stripped, ...sharedView } = view;
      return {
        data: sharedView,
        meta: { viewerIsOwner },
      };
    },
  );
}

function notFound(): HttpError {
  return new HttpError(
    404,
    ERROR_CODES.COMPARISON_NOT_FOUND,
    'Comparison not found.',
  );
}

/**
 * Best-effort owner detection on a no-auth endpoint. Returns the owner
 * identity if one of the two paths resolves (authenticated customer or
 * `compare_token` cookie); otherwise null.
 */
function viewerIdentity(request: FastifyRequest): ComparisonOwner | null {
  const customer = customerActor(request);
  if (customer !== null) {
    return {
      kind: 'customer',
      customerAccountId: customer.customerAccountId,
    };
  }
  const token = readAnonymousToken(request);
  return token ? { kind: 'anonymous', anonymousToken: token } : null;
}
