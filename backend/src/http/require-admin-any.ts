import type { FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from './error-envelope.js';
import type { PermissionService } from '../modules/admin_roles/services/permission-service.js';

export type RequireAdminAnyFactory = (
  codes: readonly string[],
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * Admin gate that succeeds when the actor holds **any** of the listed
 * permission codes (or the bootstrap wildcard `*`).
 */
export function createRequireAdminAny(
  permissionService: PermissionService,
): RequireAdminAnyFactory {
  return (codes) => async (request, _reply) => {
    if (request.actor.kind !== 'admin') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
    }
    for (const code of codes) {
      if (await permissionService.hasPermission(request.actor.adminUserId, code)) {
        return;
      }
    }
    throw new HttpError(
      403,
      ERROR_CODES.FORBIDDEN,
      `Missing permission: one of ${codes.join(', ')}.`,
    );
  };
}
