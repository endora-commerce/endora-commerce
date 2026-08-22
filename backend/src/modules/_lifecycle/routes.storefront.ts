import type { FastifyInstance } from 'fastify';
import {
  StorefrontModulePresenceResponseSchema,
  type StorefrontModulePresenceResponse,
} from '@endora-commerce/contracts';
import { effectiveState } from '../../kernel/lifecycle/effective-state.js';

/**
 * The storefront's presence projection — feature 073, FR-030 / FR-035.
 *
 * Owned by `_lifecycle` because `_lifecycle` is non-deactivatable. The
 * storefront's most-called endpoint is `GET /api/v1/i18n/config`, resolved on
 * every page in `getServerContext()`, but it belongs to `languages` — a
 * deactivatable module — so hanging presence off it would make presence depend
 * on something that can be switched off. `shop-info` is owned by `settings`
 * (non-deactivatable) but is not called on every request.
 *
 * Only `{ id, present }`: the storefront has no use for the two axes. "Not
 * installed here" and "the operator switched it off" are the same fact to a
 * buyer, and giving the storefront the distinction would only create a second
 * place where the conjunction could be recomputed differently.
 *
 * Absence is **projected, never inferred from a 503.** Nearly every storefront
 * fetch already swallows errors into defaults, so gating the API alone yields
 * silent defaults rather than absence — the storefront would keep rendering an
 * empty module surface, which is precisely what Constitution XVII forbids.
 *
 * Public: the response says which capabilities a storefront renders, which is
 * already observable from the pages themselves.
 */
export function registerModulePresenceStorefrontRoutes(app: FastifyInstance): void {
  app.get(
    '/api/v1/storefront/module-presence',
    { schema: { response: { 200: StorefrontModulePresenceResponseSchema } } },
    async (): Promise<StorefrontModulePresenceResponse> => ({
      modules: effectiveState
        .all()
        .map((state) => ({
          id: state.moduleId,
          present: state.platformAvailable && state.operatorActivated,
        })),
    }),
  );
}
