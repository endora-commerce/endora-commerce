import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { getResolvedChannel } from '../../kernel/sales-channels/sales-channel-resolver.middleware.js';
import type { ComparisonOwner, ComparisonService } from './services/comparison-service.js';
import { readAnonymousToken } from './services/anonymous-token-cookie.js';

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
      const view = await comparisonService.buildOwnerView(comparison, channel.id);
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
  if (request.actor.kind === 'customer') {
    return {
      kind: 'customer',
      customerAccountId: request.actor.customerAccountId,
    };
  }
  const token = readAnonymousToken(request);
  return token ? { kind: 'anonymous', anonymousToken: token } : null;
}
