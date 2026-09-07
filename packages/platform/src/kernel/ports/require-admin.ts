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

/**
 * Kernel port — **actor promotion**, registered by `auth` under the container
 * name `promoteAdminActor`.
 *
 * The same split as the two factories above: the kernel owns the type, `auth`
 * owns the implementation, because promotion reads `request.adminActor` and
 * writes `request.actor` — two decorations that module's plugin applies and no
 * platform file may reason about.
 *
 * It is here rather than in `@endora-commerce/contracts` for the reason
 * {@link RequireCustomerGuard} is: the shape is a `FastifyRequest`, and that
 * package declares no dependency on Fastify. It is deliberately **not** on the
 * `./kernel` barrel — no module resolves it (the guards `auth` publishes are
 * what a route surface takes), so `host-package.md` §1.3 classifies it
 * *unreached* and publishing it would put a host-only name into the platform's
 * module-facing contract.
 *
 * **Why a port at all**, when `auth` also exports the function from its own
 * `./backend` subpath: `specs/117-instance-bring-up/` FR-030. The production
 * composition root called the exported function, and
 * `specs/110-instance-repository/` T118 moves that call site into
 * `@endora-commerce/platform`, where importing a module is D-52/D-53's
 * refusal. The container name is the spelling that survives the move, and it is
 * the drain condition `auth`'s own barrel and
 * `test/contract/kernel/harness-parity.test.ts` both named — *"actor promotion
 * published as a port, resolved from the container"*.
 *
 * `void` rather than a returned actor, because it mutates the request in place:
 * every caller reads `request.actor` afterwards, and a return value would be a
 * second answer to the question the decoration already answers.
 */
export type AdminActorPromotion = (req: FastifyRequest) => void;
