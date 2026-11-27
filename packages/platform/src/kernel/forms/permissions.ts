import type { FieldWriteForbiddenReason } from '@endora-commerce/contracts';
import type { CommandActor } from '../../commands/command.js';
import type { AdminPermissionChecker } from '../ports/require-admin.js';
import { getCurrentPlatformScope } from '../scope.js';

/**
 * Who may change a guarded field (`specs/193-admin-form-extensions/` FR-043,
 * research R-12) — one answer for the field-rule check and `fieldSlotHook`.
 */

/**
 * `admin_roles`' checker as the current platform scope resolves it
 * (`permissionService`), so a Command running in a request asks the request's
 * container. `undefined` — not registered, or its owner switched off — fails
 * a guarded write closed.
 */
export function ambientPermissionChecker(): AdminPermissionChecker | undefined {
  const scope = getCurrentPlatformScope();
  if (scope === undefined) return undefined;
  try {
    return (scope.cradle as unknown as { permissionService?: AdminPermissionChecker }).permissionService;
  } catch {
    return undefined;
  }
}

/**
 * Why `actor` may not change a field guarded by `permission`, or `null`.
 *
 * - An administrator (impersonating or not) is asked through the checker.
 * - The system actor holds no permissions and is exempt, as it is from
 *   `requireAdmin`. An **unbound** API key acts in the system scope and is
 *   therefore exempt too (feature 062's trusted system scope).
 * - A **bound** API key (`api_key`) is refused: the Command Bus carries
 *   neither the key's id nor its scopes, so the scope a write needs cannot be
 *   asked (T026, R-12).
 * - A buyer acting for themselves is not bound (D-300.3).
 */
export async function forbiddenReason(
  actor: CommandActor,
  permission: string,
  checker: () => AdminPermissionChecker | undefined,
): Promise<FieldWriteForbiddenReason | null> {
  if (actor.actorAdminUserId !== null) {
    const resolved = checker();
    if (resolved === undefined) return 'missing-permission';
    return (await resolved.hasPermission(actor.actorAdminUserId, permission)) ? null : 'missing-permission';
  }
  if (actor.kind === 'api_key') return 'api-key-scopes-unresolved';
  return null;
}
