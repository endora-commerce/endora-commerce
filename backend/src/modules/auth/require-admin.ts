import type { FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type {
  AdminPermissionChecker,
  RequireAdminAnyFactory,
  RequireAdminFactory,
} from '../../kernel/ports/require-admin.js';
import { promoteAdminActor } from './plugin.js';

/**
 * The admin guard (feature 072, D-32). **One implementation**, shared by
 * production and the test harness.
 *
 * Before this file there were two. Production read `request.actor`, called
 * `promoteAdminActor` and checked `permissionService.hasPermission`
 * (`composition.ts`); the harness read `request.testActor` and took
 * `permissionService` as **optional**, so omitting it silently disabled every
 * permission check across 205 call sites in 60 modules. The harness happens to
 * pass a `PermissionService` at all 28 of its wiring sites, so the checks did
 * run — but nothing made them, and the two guards still differed in what they
 * read and in whether an admin session riding alongside a customer session was
 * promoted.
 *
 * `auth` owns this because promotion needs the auth plugin's per-request
 * decorations, and the permission check needs `admin_roles` — which `auth`'s
 * manifest now declares as a dependency. The kernel owns only the type.
 */

export interface RequireAdminDeps {
  /** `admin_roles`' `PermissionService`, narrowed to what the guard uses. */
  readonly permissionService: AdminPermissionChecker;
}

/** The actor slice the guard reads. Kept structural — no import of the actor union. */
interface AdminActorSlice {
  readonly kind: string;
  readonly adminUserId: string;
}

function resolveAdminActor(request: FastifyRequest): AdminActorSlice | null {
  // `promoteAdminActor` dereferences `request.actor`. In production it is a
  // decorated getter that always answers; a composition root that mounts a
  // route without an actor resolver would otherwise turn a 401 into a 500.
  const carrier = request as FastifyRequest & { actor?: AdminActorSlice };
  if (carrier.actor !== undefined) promoteAdminActor(request);
  const actor = carrier.actor;
  return actor?.kind === 'admin' ? actor : null;
}

/** Gate a route on an admin session, optionally holding one permission code. */
export function createRequireAdmin({ permissionService }: RequireAdminDeps): RequireAdminFactory {
  return (permission?: string) =>
    async (request): Promise<void> => {
      const actor = resolveAdminActor(request);
      if (!actor) {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
      }
      if (!permission) return;
      const ok = await permissionService.hasPermission(actor.adminUserId, permission);
      if (!ok) {
        throw new HttpError(403, ERROR_CODES.FORBIDDEN, `Missing permission: ${permission}.`);
      }
    };
}

/**
 * Gate a route on an admin session holding **any** of the listed codes.
 *
 * Lives here rather than in `http/` for the same reason as the single-code
 * factory: it needs `promoteAdminActor` and a permission checker, so keeping it
 * under `http/` made the HTTP layer import two domain modules — two of the five
 * infrastructure→module edges this feature removes.
 */
export function createRequireAdminAny({
  permissionService,
}: RequireAdminDeps): RequireAdminAnyFactory {
  return (codes) =>
    async (request): Promise<void> => {
      const actor = resolveAdminActor(request);
      if (!actor) {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
      }
      for (const code of codes) {
        if (await permissionService.hasPermission(actor.adminUserId, code)) return;
      }
      throw new HttpError(
        403,
        ERROR_CODES.FORBIDDEN,
        `Missing permission: one of ${codes.join(', ')}.`,
      );
    };
}
