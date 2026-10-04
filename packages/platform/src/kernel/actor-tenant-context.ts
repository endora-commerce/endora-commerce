import type { FastifyRequest } from 'fastify';
import type {
  Actor,
  AdminTenantScopePort,
  CustomerRollupScopePort,
} from '@endora-commerce/contracts';
import {
  resolveTenantContext,
  systemTenantContext,
} from '../tenancy/resolve-tenant-context.js';
import type { TenantContext } from '../tenancy/tenant-context.js';
import type { KernelContainer } from './container.js';

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
 * A name that *is* registered and whose owner an operator switched off throws
 * `ModuleDisabledError` out of the hook, which answers 503 — refused, not
 * widened. Nothing here catches it.
 *
 * System scope is what remains for a request that identifies nobody: anonymous
 * traffic, whose guest-owned rows are scoped by their own token, and an API key
 * bound to no organization, whose surface is global data.
 */

/** What the mapping asks of a composition; each answer may be absent. */
export interface ActorTenantScopeSources {
  /** `customer_accounts`' roll-up decision. */
  customerRollupScope(): CustomerRollupScopePort | undefined;
  /** `organizations`' tree traversal: an organization and everything beneath it. */
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
      const port = sources.adminTenantScope();
      // No port, no organization: an unanswered question about an admin's reach
      // is answered with the empty set, never with "all".
      const scope =
        port === undefined
          ? { allowAll: false as const, allowedOrganizationIds: [] }
          : await port.resolveForAdmin(actor.adminUserId);
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

/**
 * The sources, read off a composed container.
 *
 * `hasRegistration` first and the cradle second: resolving an unregistered name
 * throws, and "this composition has no such module" is an answer here rather
 * than a failure. A **registered** name is resolved on every call, so a gated
 * port keeps answering for its owner's current state and its refusal reaches
 * the caller.
 */
export function containerTenantScopeSources(container: KernelContainer): ActorTenantScopeSources {
  const read = <T>(name: string): T | undefined =>
    container.hasRegistration(name)
      ? (container.cradle as unknown as Record<string, T>)[name]
      : undefined;
  return {
    customerRollupScope: () => read<CustomerRollupScopePort>('customerRollupScopePort'),
    organizationSubtree: () =>
      read<{ subtreeIds(organizationId: string): Promise<string[]> }>('organizationTreeService'),
    adminTenantScope: () => read<AdminTenantScopePort>('adminTenantScopePort'),
  };
}

/**
 * Refuse a mapping that answers an identified actor with a system context.
 *
 * `composeApp` accepts a deployment's own mapping, and a mapping is a function
 * somebody can write wrongly — or stub while wiring something else. A customer
 * or an admin in system scope reads across every organization and nothing
 * downstream can tell, so the one shape that must never leave this seam is
 * checked where every mapping passes through it, the default included.
 *
 * The refusal is an error out of the scope hook, so the request fails before
 * any handler runs.
 */
export function refusingSystemScopeForIdentifiedActors(
  build: BuildTenantContext,
): BuildTenantContext {
  return async (request) => {
    const tenant = await build(request);
    const kind = actorOf(request)?.kind;
    if (tenant.mode === 'system' && (kind === 'customer' || kind === 'admin')) {
      throw new Error(
        `the tenant-context mapping answered a system scope for a ${kind} request, which would ` +
          'let it read across every organization. A request that identifies a customer or an ' +
          'admin is confined to what that actor may reach (Principle XI); system scope is for ' +
          'executions with no such actor.',
      );
    }
    return tenant;
  };
}

/**
 * The mapping a composition runs with: the caller's own when it supplied one,
 * the default over this container otherwise — and the refusal above around
 * whichever it is.
 *
 * One function so that `composeApp` has a single expression to get wrong, and
 * so that expression can be asserted without opening a database.
 */
export function tenantContextMappingFor(
  container: KernelContainer,
  supplied?: BuildTenantContext,
): BuildTenantContext {
  return refusingSystemScopeForIdentifiedActors(
    supplied ?? actorTenantContext(containerTenantScopeSources(container)),
  );
}
