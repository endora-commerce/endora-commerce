import type { FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  scopeRequestToActor,
  type AdminPermissionChecker,
  type RequireAdminAnyFactory,
  type RequireAdminFactory,
} from '@endora-commerce/platform/kernel';
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

/**
 * The admin this route accepts, with the request **scoped to that admin**.
 *
 * Two steps and they are one decision. A browser may hold an admin session and
 * a customer session at once, and the plugin's `onRequest` hook makes the
 * customer the ambient actor — which is the right answer for a storefront
 * route and the wrong one here. Promotion puts the admin on the request; the
 * platform then derives the request's tenant context from the actor the gate
 * accepted, so an admin route is never authorized as the admin and scoped as
 * the customer. The route decides, not which cookies happen to be present.
 *
 * `scopeRequestToActor` does nothing when the context was already derived from
 * this actor — every request carrying the admin session alone. When it rejects,
 * so does the guard: the request is refused rather than served in the scope of
 * the session this route does not accept.
 */
async function resolveAdminActor(request: FastifyRequest): Promise<AdminActorSlice | null> {
  // `promoteAdminActor` dereferences `request.actor`. In production it is a
  // decorated getter that always answers; a composition root that mounts a
  // route without an actor resolver would otherwise turn a 401 into a 500.
  const carrier = request as FastifyRequest & { actor?: AdminActorSlice };
  if (carrier.actor !== undefined) promoteAdminActor(request);
  const actor = carrier.actor;
  if (actor?.kind !== 'admin') return null;
  await scopeRequestToActor(request);
  return actor;
}

function adminSessionRequired(): HttpError {
  return new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
}

/**
 * Refuse a session whose account may no longer act — deactivated, deleted or
 * gone — as **not signed in**.
 *
 * Every write that withdraws an account also revokes its sessions, but that is
 * a step each of them has to remember, and a session row can outlive one that
 * forgot: the bootstrap CLI, a direct database edit, a write added later. This
 * is the check that does not depend on any of them. Before it, a route gated on
 * the session alone answered such a session in full, and a permission-gated
 * one answered 403 — "you lack a permission" — to somebody who is not an
 * administrator any more.
 *
 * 401 rather than 403 on purpose: the Admin UI signs out on a 401, which is
 * exactly what should happen to this browser.
 */
async function assertActiveAccount(
  permissionService: AdminPermissionChecker,
  adminUserId: string,
): Promise<void> {
  if (!(await permissionService.isActiveAdministrator(adminUserId))) {
    throw adminSessionRequired();
  }
}

/**
 * Gate a route on an admin session, optionally holding one permission code.
 *
 * The account check costs a read, so it is made where it can change the
 * answer: always on a route with no permission code, and on a permission-gated
 * route only once the permission check has said no — a granted permission
 * already proves an active account, and a refused one is then told apart as
 * 401 (no longer an administrator) or 403 (an administrator without the code).
 */
export function createRequireAdmin({ permissionService }: RequireAdminDeps): RequireAdminFactory {
  return (permission?: string) =>
    async (request): Promise<void> => {
      const actor = await resolveAdminActor(request);
      if (!actor) throw adminSessionRequired();
      if (!permission) {
        await assertActiveAccount(permissionService, actor.adminUserId);
        return;
      }
      const ok = await permissionService.hasPermission(actor.adminUserId, permission);
      if (!ok) {
        await assertActiveAccount(permissionService, actor.adminUserId);
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
      const actor = await resolveAdminActor(request);
      if (!actor) throw adminSessionRequired();
      for (const code of codes) {
        if (await permissionService.hasPermission(actor.adminUserId, code)) return;
      }
      await assertActiveAccount(permissionService, actor.adminUserId);
      throw new HttpError(
        403,
        ERROR_CODES.FORBIDDEN,
        `Missing permission: one of ${codes.join(', ')}.`,
      );
    };
}
