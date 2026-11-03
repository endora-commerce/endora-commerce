import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import type { ReturnSavedViewActor } from './services/return-list-view-service.js';

/**
 * The saved-view actor for the return list, read from the request's ambient
 * tenant context (`specs/147-saved-views/` contract §4; #312): the admin, and
 * whether that admin reaches every organization — the "platform admin (for
 * saved views)" of the spec's *Vocabulary* (research R-7).
 *
 * Every list with saved views derives this the same way, and
 * `backend/test/integration/saved-list-views/rules-parity.test.ts` holds them
 * to it. It fails closed twice: no admin actor is a 401, never a write under
 * an empty owner id (threat model S-03); and an admin whose reach nobody could
 * resolve — no scope port composed, or a role that cannot be read — is in
 * `allowed-set` mode, so is not a platform admin.
 */
export function savedViewActor(): ReturnSavedViewActor {
  const ctx = getTenantContext();
  if (!ctx || ctx.actor.kind !== 'admin' || !ctx.actor.id) {
    throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
  }
  return { adminUserId: ctx.actor.id, isPlatformAdmin: ctx.mode === 'all' };
}
