import { getTenantContext, MissingTenantContextError, type TenantContext } from '../tenancy/index.js';
import type { CommandActor } from './command.js';

/**
 * Derive a {@link CommandActor} from the ambient TenantContext (feature 050).
 *
 * The actor is ALWAYS server-derived — a Command never accepts an actor from a
 * request body (Constitution Principle XI/XIII). Mapping:
 *  - impersonation present → real admin id + impersonated customer id;
 *  - admin actor           → admin id;
 *  - system actor          → null admin id (worker/escape-hatch);
 *  - customer (no impersonation) → null admin id, and the customer's own id on
 *    `actorCustomerAccountId` (a customer acting on their own; feature 170, R-21).
 *
 * Fail-closed: with no ambient context this throws {@link MissingTenantContextError},
 * so a Command can never run unscoped.
 */
export function resolveCommandActor(): CommandActor {
  const ctx = getTenantContext();
  if (!ctx) {
    throw new MissingTenantContextError('CommandBus.run requires an ambient TenantContext');
  }
  return actorFromContext(ctx);
}

/** Pure mapping, split out so it is trivially unit-testable without ALS. */
export function actorFromContext(ctx: TenantContext): CommandActor {
  if (ctx.impersonation) {
    return {
      actorAdminUserId: ctx.impersonation.realAdminUserId,
      impersonatedCustomerAccountId: ctx.impersonation.impersonatedCustomerAccountId,
      actorCustomerAccountId: null,
      kind: ctx.actor.kind,
    };
  }
  if (ctx.actor.kind === 'admin') {
    return {
      actorAdminUserId: ctx.actor.id ?? null,
      impersonatedCustomerAccountId: null,
      actorCustomerAccountId: null,
      kind: 'admin',
    };
  }
  if (ctx.actor.kind === 'customer') {
    // A customer acting for themselves — no acting admin id, and the account
    // is the actor.
    return {
      actorAdminUserId: null,
      impersonatedCustomerAccountId: null,
      actorCustomerAccountId: ctx.actor.id ?? ctx.customerAccountId ?? null,
      kind: 'customer',
    };
  }
  // system or api key — no acting admin id and no acting customer.
  return {
    actorAdminUserId: null,
    impersonatedCustomerAccountId: null,
    actorCustomerAccountId: null,
    kind: ctx.actor.kind,
  };
}
