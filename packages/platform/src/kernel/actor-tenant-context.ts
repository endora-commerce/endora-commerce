import type { FastifyRequest } from 'fastify';
import type {
  Actor,
  AdminTenantScope,
  AdminTenantScopePort,
  CustomerRollupScopePort,
} from '@endora-commerce/contracts';
import {
  resolveTenantContext,
  systemTenantContext,
  type AdminScopeInput,
} from '../tenancy/resolve-tenant-context.js';
import type { TenantContext } from '../tenancy/tenant-context.js';
import type { KernelContainer } from './container.js';
import { ModuleDisabledError } from './lifecycle/plugin-helpers.js';

/**
 * The actor → tenant-context mapping every composition gets (Principle XI).
 *
 * ## Why it is the platform's
 *
 * `registerRequestScopeHook` establishes the ambient `TenantContext` of each
 * request from whatever mapping it is handed. The hook was always the
 * platform's; the mapping used to be a composition root's to supply. An
 * instance has no composition root of its own — its entry point is the
 * operator's file and calls `composeApp({ deploymentRoot })` — so a mapping
 * that only a root can write is one an instance does not have.
 *
 * So the mapping is here, and it is built from what the composition
 * registered rather than from what a root remembered to write. The actor is
 * `request.actor`, whose declaration is this package's
 * (`../http/request-actor.ts`). The three module-owned answers it needs are
 * read from the container **by name, per request**:
 *
 *  - `customerRollupScopePort` (`customer_accounts`) — whether a customer login
 *    widens from its organization to that organization's subtree;
 *  - `organizationTreeService` (`organizations`) — the traversal that port
 *    takes as an argument;
 *  - `adminTenantScopePort` (`organizations`) — the organizations an admin's
 *    role lets them reach.
 *
 * None of the three is imported: a name is a string and the shapes are
 * `@endora-commerce/contracts`', so nothing here reaches a module (D-52/D-53).
 *
 * ## It fails closed, and that is the property rather than a detail
 *
 * A name nobody registered is not an error and is never a widening:
 *
 *  - a **customer** stays confined to its own organization — the roll-up is the
 *    only thing lost;
 *  - an **admin** is confined to **no** organization (an empty allowed set), so
 *    organization-scoped reads come back empty and anything gated on a
 *    platform-wide admin refuses. Global data is untouched, which is what keeps
 *    the module-management screen reachable in a composition missing the port.
 *
 * A name that *is* registered and whose owner is absent answers
 * `ModuleDisabledError`, and the two arms treat it differently, on purpose:
 *
 *  - on the **customer** arm it leaves the hook and the request answers 503 —
 *    refused, not widened. Nothing here catches it;
 *  - on the **admin** arm the context is the same as for an unregistered port
 *    — **no** organization — and the refusal is deferred to the first
 *    tenant-scoped read rather than raised here. See {@link adminScopeOrNone}
 *    for why that one arm does not refuse in the hook. It never widens.
 *
 * ## Which actor
 *
 * `request.actor` **when the mapping is asked**, and it is asked twice for a
 * request whose gate accepts a different actor from the ambient one: once by
 * the scope hook in `onRequest`, and again when `auth`'s admin guard has put
 * the admin session on a request that also carries a customer one
 * (`scopeRequestToActor` in `./request-scope-hook.ts`). The mapping does not
 * know or care which call it is — a context is always what the request's
 * current actor may reach.
 *
 * System scope is what remains for a request that identifies nobody: anonymous
 * traffic, whose guest-owned rows are scoped by their own token, and an API key
 * bound to no organization, whose surface is global data.
 */

/** What the mapping asks of a composition; each answer may be absent. */
export interface ActorTenantScopeSources {
  /** `customer_accounts`' roll-up decision. */
  customerRollupScope(): CustomerRollupScopePort | undefined;
  /**
   * `organizations`' tree traversal: an organization and everything beneath it.
   *
   * `undefined` says the composition has no traversal. Anything else must be
   * safe to hand over **unasked**: the mapping obtains it for every customer
   * and only a roll-up account ever calls it, so an owner that is absent has
   * to refuse at `subtreeIds`, not here.
   */
  organizationSubtree(): { subtreeIds(organizationId: string): Promise<string[]> } | undefined;
  /** `organizations`' answer for the reach of an admin. */
  adminTenantScope(): AdminTenantScopePort | undefined;
}

export type BuildTenantContext = (request: FastifyRequest) => Promise<TenantContext>;

/**
 * `request.actor`, or `undefined` in a composition that mounts no auth plugin
 * and therefore decorated nothing (see the note in `../http/request-actor.ts`).
 */
function actorOf(request: FastifyRequest): Actor | undefined {
  return (request as { actor?: Actor }).actor;
}

export function actorTenantContext(sources: ActorTenantScopeSources): BuildTenantContext {
  return async (request) => {
    const actor = actorOf(request);

    if (actor?.kind === 'customer') {
      const organizationId =
        actor.organizationId && actor.organizationId.length > 0 ? actor.organizationId : null;
      // Server-derived from the account, never from the request. Both halves
      // have to be present to widen; either missing leaves the customer where
      // it started.
      const rollup = sources.customerRollupScope();
      const tree = sources.organizationSubtree();
      const subtree =
        rollup !== undefined && tree !== undefined
          ? await rollup.resolveSubtreeIds(actor.customerAccountId, organizationId, (id) =>
              tree.subtreeIds(id),
            )
          : undefined;
      return resolveTenantContext({
        kind: 'customer',
        customerAccountId: actor.customerAccountId,
        organizationId,
        impersonatorAdminUserId: actor.impersonatorAdminUserId,
        ...(subtree !== undefined && subtree.length > 0
          ? { rollupSubtreeOrganizationIds: subtree }
          : {}),
      });
    }

    if (actor?.kind === 'admin') {
      const scope = await adminScopeOrNone(sources, actor.adminUserId);
      return resolveTenantContext({ kind: 'admin', adminUserId: actor.adminUserId }, scope);
    }

    // A bound key is pinned to its organization and service account; an
    // unbound one keeps the system scope its global-data surface needs.
    if (actor?.kind === 'api_key') {
      return resolveTenantContext({
        kind: 'api_key',
        apiKeyId: actor.apiKeyId,
        organizationId: actor.organizationId ?? null,
        customerAccountId: actor.customerAccountId ?? null,
      });
    }

    return systemTenantContext(`actor:${actor?.kind ?? 'none'}`);
  };
}

/** An admin who reaches no organization: the answer to every unanswered question. */
const NO_ORGANIZATION: AdminTenantScope = { allowAll: false, allowedOrganizationIds: [] };

/**
 * The same, for a question a module **refused** rather than one nobody was
 * there to ask: the refusal rides along and the tenant guard raises it on the
 * first tenant-scoped read (`TenantContext.scopeUnresolved`).
 */
export function unresolvedAdminScope(refusal: Error): AdminScopeInput {
  return { ...NO_ORGANIZATION, unresolved: refusal };
}

/**
 * The reach of an admin, or **no organization** when nothing can say.
 *
 * Two ways the question goes unanswered, and one answer for both: the port is
 * not registered in this composition, or it is registered and a module it
 * depends on is absent — `organizations` itself, or `admin_users` /
 * `admin_roles`, which its implementation reads the role through. An
 * unanswered question about an admin's reach is answered with the empty set,
 * never with "all".
 *
 * ## Why this is a `catch` around a gated port, which the composition rules
 * otherwise refuse
 *
 * A `catch` that absorbs `ModuleDisabledError` normally turns a fail-closed
 * seam into a fail-open one: the caller answers "no data" where the truth is
 * "this capability is off". Here the direction is the opposite. The degrade is
 * the **most confined** context an admin can hold, so absorbing the presence
 * answer cannot show anybody a row they would otherwise have been refused.
 *
 * And refusing instead would be wrong, because this hook runs before **every**
 * route. A 503 from it takes down the surfaces an operator needs precisely
 * when a module is absent — the admin module-presence projection and the
 * command-palette registry — which read global data and must keep answering
 * with a module off. An admin locked out of the screen that says which module
 * is missing cannot repair the state that locked them out.
 *
 * ## The presence answer is deferred, not swallowed
 *
 * "No organization" alone would be safe and untrue: an admin order list would
 * come back empty where the fact is that a module is off, which is the lie the
 * rule against these catches exists to prevent. So the caught error is carried
 * on the context ({@link unresolvedAdminScope}) and the tenant guard throws it
 * the first time the request builds a tenant predicate. A route over global
 * data builds none and answers; a route over organization data answers the 503
 * `MODULE_DISABLED` it would have answered had the hook refused — only later,
 * and only where it is true.
 *
 * The degrade cannot live in the owner's implementation, where a degrade
 * normally belongs: with `organizations` absent the gate refuses before any
 * implementation runs. It is narrow — `ModuleDisabledError` and nothing else;
 * any other failure of the port still fails the request.
 */
async function adminScopeOrNone(
  sources: ActorTenantScopeSources,
  adminUserId: string,
): Promise<AdminScopeInput> {
  return adminScopeOrUnresolved(async () => {
    const port = sources.adminTenantScope();
    if (port === undefined) return NO_ORGANIZATION;
    return port.resolveForAdmin(adminUserId);
  });
}

/**
 * The degrade itself, as the one function every composition root runs: ask for
 * an admin's scope, and answer {@link unresolvedAdminScope} when the asking is
 * refused because a module is absent.
 *
 * `resolve` must do the **whole** asking inside the callback — reading the
 * port off the container as well as calling it — because a gated port refuses
 * at resolution, before any method runs, and a read made outside would escape
 * the catch. Narrow on purpose: `ModuleDisabledError` and nothing else.
 *
 * It is exported for the test harness, whose mapping is its own and whose admin
 * arm must degrade exactly as this one does; a second hand-written `catch` is
 * how the two come to disagree about which errors are a presence answer.
 */
export async function adminScopeOrUnresolved(
  resolve: () => Promise<AdminScopeInput>,
): Promise<AdminScopeInput> {
  try {
    return await resolve();
  } catch (error) {
    if (error instanceof ModuleDisabledError) return unresolvedAdminScope(error);
    throw error;
  }
}

/**
 * The sources, read off a composed container.
 *
 * `hasRegistration` first and the cradle second: resolving an unregistered name
 * throws, and "this composition has no such module" is an answer here rather
 * than a failure. A **registered** name is resolved on every call, so a gated
 * port keeps answering for its owner's current state and its refusal reaches
 * the caller.
 *
 * The tree traversal is the one whose cradle read is **deferred to its use**.
 * The mapping takes it for every customer and hands it to the roll-up port as a
 * callback, which only a roll-up account invokes. Resolving it up front would
 * make a gated `organizationTreeService` refuse every signed-in customer while
 * its owner is absent, where the only request that needs the tree is the one
 * that walks it. Whether the name is registered is still answered eagerly:
 * that is what decides between "no traversal here" and "ask when needed".
 */
export function containerTenantScopeSources(container: KernelContainer): ActorTenantScopeSources {
  const read = <T>(name: string): T | undefined =>
    container.hasRegistration(name)
      ? (container.cradle as unknown as Record<string, T>)[name]
      : undefined;
  return {
    customerRollupScope: () => read<CustomerRollupScopePort>('customerRollupScopePort'),
    organizationSubtree: () =>
      container.hasRegistration('organizationTreeService')
        ? {
            subtreeIds: async (organizationId: string) =>
              (
                read<{ subtreeIds(organizationId: string): Promise<string[]> }>(
                  'organizationTreeService',
                ) as { subtreeIds(organizationId: string): Promise<string[]> }
              ).subtreeIds(organizationId),
          }
        : undefined,
    adminTenantScope: () => read<AdminTenantScopePort>('adminTenantScopePort'),
  };
}

/**
 * Why a context is wider than its actor may hold, or `undefined` when it is not.
 *
 *  - a **customer** may hold `single-org` or `allowed-set` (the roll-up) and
 *    nothing else: `system` and `all` both cross every organization;
 *  - an **admin** may hold `all` — that is what a platform administrator is —
 *    or `allowed-set`, and never `system`, which would also drop the admin as
 *    the recorded actor;
 *  - an **API key bound to an organization** is held to the customer's rule. An
 *    unbound key is not an identified tenant and keeps system scope.
 *
 * Anonymous traffic and a request with no actor are not judged here.
 */
function wideningFor(actor: Actor | undefined, tenant: TenantContext): string | undefined {
  // `null` as well as `undefined`: a composition may decorate the slot and
  // never fill it.
  if (actor === undefined || actor === null) return undefined;
  const crossesEveryOrganization = tenant.mode === 'system' || tenant.mode === 'all';
  if (actor.kind === 'customer' && crossesEveryOrganization) return 'a customer';
  if (actor.kind === 'admin' && tenant.mode === 'system') return 'an admin';
  if (actor.kind === 'api_key' && actor.organizationId && crossesEveryOrganization) {
    return 'an API key bound to an organization';
  }
  return undefined;
}

/**
 * Refuse a mapping that hands an identified actor a context wider than that
 * kind of actor may hold ({@link wideningFor}).
 *
 * `composeApp` accepts a deployment's own mapping, and a mapping is a function
 * somebody can write wrongly — or stub while wiring something else. A customer
 * in a context that crosses every organization reads all of them and nothing
 * downstream can tell, so the shapes that must never leave this seam are
 * checked where every mapping passes through it, the default included.
 *
 * It is a check on the **mode**, not on which organizations an `allowed-set`
 * names: whether a set is the right one is the mapping's own question.
 *
 * The refusal is an error out of the scope hook, so the request fails before
 * any handler runs.
 */
export function refusingWiderScopeThanTheActorMayHold(
  build: BuildTenantContext,
): BuildTenantContext {
  return async (request) => {
    const tenant = await build(request);
    const who = wideningFor(actorOf(request), tenant);
    if (who !== undefined) {
      throw new Error(
        `the tenant-context mapping answered a \`${tenant.mode}\` scope for a request that ` +
          `identifies ${who}, which would let it read across every organization. Such a ` +
          'request is confined to what its actor may reach (Principle XI).',
      );
    }
    return tenant;
  };
}

/** What {@link tenantContextMappingFor} reports while it is being assembled. */
export interface TenantContextMappingOptions {
  /** Called once, at assembly, for a state an operator should hear about. */
  readonly warn?: (message: string) => void;
}

/**
 * The mapping a composition runs with: the caller's own when it supplied one,
 * the default over this container otherwise — and the refusal above around
 * whichever it is.
 *
 * One function so that `composeApp` has a single expression to get wrong, and
 * so that expression can be asserted without opening a database.
 *
 * **It warns when the default will confine every admin to nothing.** With no
 * `adminTenantScopePort` in the composition the admin arm answers the empty set
 * for everybody, the platform administrator included. That is the safe answer
 * and a silent one, and the composition it is most likely to happen in is a
 * partial upgrade: this package updated and `@endora-commerce/mod-organizations`
 * left at a version that does not register the port. Call this after every
 * module has registered — `composeApp` does, past the contribution window.
 */
export function tenantContextMappingFor(
  container: KernelContainer,
  supplied?: BuildTenantContext,
  options: TenantContextMappingOptions = {},
): BuildTenantContext {
  if (supplied === undefined && !container.hasRegistration('adminTenantScopePort')) {
    options.warn?.(
      "[tenancy] no module in this composition registers 'adminTenantScopePort', so every " +
        'admin request is confined to no organization — organization-scoped screens will be ' +
        'empty for every administrator. `@endora-commerce/mod-organizations` registers it; if ' +
        'that package is installed it is older than this platform. Upgrade all ' +
        '`@endora-commerce/*` packages together.',
    );
  }
  return refusingWiderScopeThanTheActorMayHold(
    supplied ?? actorTenantContext(containerTenantScopeSources(container)),
  );
}
