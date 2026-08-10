import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Kernel port — the admin guard (feature 072, D-32).
 *
 * Before this file the repository carried **17 byte-identical declarations** of
 * `RequireAdminFactory`, one per module that happened to need it, and 53 files
 * imported `catalog`'s copy — an infrastructure dependency on a domain module.
 * This is the one declaration; every route surface imports it from here.
 *
 * The kernel owns the **type**. The `auth` module owns the **implementation**
 * (`modules/auth/require-admin.ts`) because promoting an admin actor needs the
 * auth plugin's per-request decorations, and checking a permission needs
 * `admin_roles` — which `auth`'s manifest declares as a dependency.
 */
export type RequireAdminFactory = (
  permission?: string,
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * The admin gate that succeeds when the actor holds **any** of the listed
 * permission codes. Lives beside the single-permission factory so both shapes
 * have one declaration.
 */
export type RequireAdminAnyFactory = (
  codes: readonly string[],
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * The slice of `admin_roles`' `PermissionService` the guard needs. Declared
 * structurally so the kernel does not import a module's service class.
 */
export interface AdminPermissionChecker {
  hasPermission(adminUserId: string, code: string): Promise<boolean>;
}
